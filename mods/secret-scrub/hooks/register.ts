import type { EngineInterface, Register } from 'claude-code'

import { configCommand, LANGUAGE, loadConfig, pick, resolve, type ConfigIO, type Lang, type Resolved, type Specs } from './config'
import { scrubHistory } from './history'
import { bypassPattern, compilePatterns, scrub, summarize, type ScrubOptions } from './scrub'

const MOD = 'secret-scrub'
const HISTORY = 'history'

export const SPECS: Specs = {
  // Not from the repo file: a committed pattern that backtracks without end would hang every prompt.
  custom_rules: {
    category: 'protect',
    type: 'list',
    default: [],
    repo: 'never',
    description: {
      en: 'Extra regular expressions to mask; a match is replaced whole by the mask; only in the user settings file or the local file',
      'zh-TW': '另外要遮蔽的正規表示式，符合的整段換成遮蔽標記；只能放在使用者設定檔或 local 檔案',
    },
  },
  allow: {
    category: 'protect',
    type: 'list',
    default: [],
    repo: 'never',
    description: {
      en: 'Values not to mask (regular expressions that must match the whole value, e.g. a fake test token); only in the user settings file or the local file',
      'zh-TW': '不遮蔽的值（正規表示式，要整段符合，例如測試用的假 token）；只能放在使用者設定檔或 local 檔案',
    },
  },
  bypass_marker: {
    category: 'protect',
    type: 'string',
    default: '#noscrub',
    repo: 'never',
    description: {
      en: 'A prompt containing this marker is sent as typed (the marker itself is removed)',
      'zh-TW': 'prompt 含這個標記時原樣送出（標記本身會移除）',
    },
  },
  language: LANGUAGE,
}

// The settings, compiled once per change.
type Scrubbing = { bypass: RegExp; marker: string; options: ScrubOptions; bad: string[]; lang: Lang }

export function scrubbingOf(resolved: Resolved): Scrubbing {
  const marker = (resolved.values.bypass_marker as string).trim() || '#noscrub'
  const rules = compilePatterns(resolved.values.custom_rules as readonly string[], 'g')
  // Whole values only: a short pattern must not let through a real secret that contains it.
  const allow = compilePatterns((resolved.values.allow as readonly string[]).map(pattern => `^(?:${pattern})$`), '')

  return {
    bypass: bypassPattern(marker),
    marker,
    options: { rules: rules.patterns, allow: allow.patterns },
    bad: [...rules.bad, ...allow.bad],
    lang: resolved.lang,
  }
}

// Claude Code appends to history.jsonl shortly after a prompt is submitted; rewrite after that.
const REWRITE_DELAY_MS = 3000
// `$.fs.read` refuses larger files.
const MAX_READ = 4 * 1024 * 1024
const LOCK_TRIES = 10
const LOCK_WAIT_MS = 100

async function configDir($: EngineInterface): Promise<string> {
  const dir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (dir !== undefined && dir !== '') {
    return dir.replace(/\/$/, '')
  }

  return `${await $.env.get('HOME')}/.claude`
}

// proper-lockfile's convention (a `<file>.lock` directory), so an append that takes the same lock
// waits for the rewrite; mkdir fails while someone else holds it.
async function withLock<T>($: EngineInterface, lang: Lang, path: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${path}.lock`
  for (let i = 0; ; i++) {
    if ((await $.process.run(['mkdir', lock], { timeoutMs: 3000 })).exitCode === 0) {
      break
    }
    if (i + 1 >= LOCK_TRIES) {
      throw new Error(pick(lang, { en: `${lock} is held by another process`, 'zh-TW': `${lock} 被占用` }))
    }
    await $.clock.sleep(LOCK_WAIT_MS)
  }
  try {
    return await fn()
  } finally {
    await $.process.run(['rmdir', lock], { timeoutMs: 3000 })
  }
}

// Writes `text` beside `path` and renames it over, unless `path` changed since it was read; an
// append landing in between would otherwise be lost. Returns false when it changed.
async function replaceIfUnchanged(
  $: EngineInterface,
  lang: Lang,
  path: string,
  seen: { size: number; mtimeMs: number },
  text: string,
): Promise<boolean> {
  const staging = `${path}.secret-scrub-staging`
  await $.fs.write(staging, text)
  const now = await $.fs.stat(path)
  if (now.size !== seen.size || now.mtimeMs !== seen.mtimeMs) {
    await $.process.run(['rm', '-f', staging], { timeoutMs: 3000 })

    return false
  }
  const moved = await $.process.run(['mv', '-f', staging, path], { timeoutMs: 3000 })
  if (moved.exitCode !== 0) {
    throw new Error(pick(lang, { en: `mv failed: ${moved.stderr.trim()}`, 'zh-TW': `mv 失敗：${moved.stderr.trim()}` }))
  }

  return true
}

// Pastes are shared by hash across sessions; a file is rewritten only when it held a secret.
async function scrubPastes($: EngineInterface, dir: string, hashes: string[], scrubbing: Scrubbing): Promise<number> {
  let count = 0
  for (const hash of hashes) {
    const path = `${dir}/paste-cache/${hash}.txt`
    if (!(await $.fs.exists(path))) {
      continue
    }
    const { text, labels } = scrub(await $.fs.read(path), scrubbing.options)
    if (labels.length > 0) {
      await $.fs.write(path, text)
      count += labels.length
    }
  }

  return count
}

// Masks secrets left in history.jsonl (and the pastes it points to): one session's lines, or every
// line when `sessionId` is undefined. Resolves the number of secrets masked.
async function scrubHistoryFile($: EngineInterface, scrubbing: Scrubbing, sessionId?: string): Promise<number> {
  const dir = await configDir($)
  const path = `${dir}/history.jsonl`
  if (!(await $.fs.exists(path))) {
    return 0
  }

  const lang = scrubbing.lang
  const masked = await withLock($, lang, path, async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const seen = await $.fs.stat(path)
      if (seen.isLink || seen.kind !== 'file') {
        throw new Error(pick(lang, { en: 'history.jsonl is not a regular file', 'zh-TW': 'history.jsonl 不是一般檔案' }))
      }
      if (seen.size > MAX_READ) {
        throw new Error(pick(lang, { en: 'history.jsonl is over 4 MiB and cannot be read', 'zh-TW': 'history.jsonl 超過 4 MiB，無法讀取' }))
      }
      const result = scrubHistory(await $.fs.read(path), sessionId, scrubbing.bypass, scrubbing.options)
      const pastes = await scrubPastes($, dir, result.pasteHashes, scrubbing)
      if (result.lines === 0 || (await replaceIfUnchanged($, lang, path, seen, result.text))) {
        return result.labels.length + pastes
      }
    }
    throw new Error(pick(lang, { en: 'history.jsonl keeps being written to; try again later', 'zh-TW': 'history.jsonl 一直在寫入，稍後再試' }))
  })

  if (masked > 0) {
    $.ui.log(`secret-scrub: masked ${masked} secret(s) in history.jsonl`, { to: 'debug' })
  }

  return masked
}

async function scrubSessionHistory($: EngineInterface, scrubbing: Scrubbing): Promise<void> {
  try {
    await scrubHistoryFile($, scrubbing, await $.session.id())
  } catch (error) {
    $.ui.toast(
      pick(scrubbing.lang, {
        en: `secret-scrub: the prompt history was not masked (${String(error)}); you can run /${MOD} ${HISTORY}`,
        'zh-TW': `secret-scrub：輸入框歷史未能遮蔽（${String(error)}），可執行 /${MOD} ${HISTORY}`,
      }),
      { timeoutMs: 8000 },
    )
  }
}

// --- configIO: the same block in every mod (scripts/check-copies.sh) ---
function configIO($: EngineInterface): ConfigIO {
  return {
    read: async path => {
      try {
        return await $.fs.read(path)
      } catch {
        return ''
      }
    },
    write: (path, text) => $.fs.write(path, text),
    isDir: async path => (await $.fs.stat(path).catch(() => undefined))?.kind === 'dir',
    configDir: async () => (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`,
    root: () => $.session.root(),
    repoRoot: async () => (await $.session.repo())?.root,
    sessionId: () => $.session.id(),
    now: () => $.clock.now(),
    storeGet: key => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
  }
}
// --- end configIO ---

export const register: Register = (on, options) => {
  // Re-read at session start and after `/secret-scrub set`; `/config` changes reload the module.
  let scrubbing = scrubbingOf(resolve(SPECS, { options, user: {}, repo: {}, local: {}, session: {} }))
  const apply = (resolved: Resolved) => {
    scrubbing = scrubbingOf(resolved)
  }

  on('session.start', async ($, e, next) => {
    try {
      apply(await loadConfig(configIO($), MOD, SPECS, options))
    } catch (error) {
      $.ui.log(`session.start: settings not read: ${String(error)}`, { to: 'debug' })
    }
    const lang = scrubbing.lang
    try {
      await $.command.register({
        name: MOD,
        description: pick(lang, {
          en: 'Mask secrets that any session left in the prompt history (history.jsonl) (history), or view and change settings',
          'zh-TW': '遮蔽輸入框歷史（history.jsonl）裡所有 session 留下的密鑰（history），或看、改設定',
        }),
        argumentHint: 'history | status | set <key> <value> | unset <key>',
      })
    } catch (error) {
      $.ui.log(`session.start: /${MOD} not registered: ${String(error)}`, { to: 'debug' })
      $.ui.toast(pick(lang, { en: `${MOD}: /${MOD} was not registered (${String(error)})`, 'zh-TW': `${MOD}：/${MOD} 指令沒有註冊成功（${String(error)}）` }))
    }
    if (scrubbing.bad.length > 0) {
      $.ui.toast(
        pick(lang, {
          en: `${MOD}: ${scrubbing.bad.length} custom rule(s) are not valid regular expressions and are not used (/${MOD} status)`,
          'zh-TW': `${MOD}：${scrubbing.bad.length} 條自訂規則不是有效的正規表示式，沒有採用（/${MOD} status）`,
        }),
      )
    }

    return next(e)
  })

  on('command.run', { command: MOD }, async ($, e) => {
    if (e.args.trim().split(/\s+/)[0] !== HISTORY) {
      const text = await configCommand(configIO($), MOD, SPECS, options, e.args, apply)
      const lang = scrubbing.lang
      const bad =
        scrubbing.bad.length > 0
          ? pick(lang, {
              en: `\nInvalid regular expressions, not used: ${scrubbing.bad.join(', ')}`,
              'zh-TW': `\n無效、沒有採用的正規表示式：${scrubbing.bad.join('、')}`,
            })
          : ''
      const usage = pick(lang, {
        en: `Usage: /${MOD} ${HISTORY}, /${MOD} status, /${MOD} set <key> <value> [--session|--local|--repo], /${MOD} unset <key>`,
        'zh-TW': `用法：/${MOD} ${HISTORY}、/${MOD} status、/${MOD} set <key> <value> [--session|--local|--repo]、/${MOD} unset <key>`,
      })

      return { text: text === undefined ? usage : `${text}${bad}` }
    }
    const lang = scrubbing.lang
    try {
      const masked = await scrubHistoryFile($, scrubbing)

      return {
        text:
          masked > 0
            ? pick(lang, { en: `secret-scrub: masked ${masked} secret(s) in the prompt history.`, 'zh-TW': `secret-scrub：已遮蔽輸入框歷史中的 ${masked} 個密鑰。` })
            : pick(lang, { en: 'secret-scrub: no secrets found in the prompt history.', 'zh-TW': 'secret-scrub：輸入框歷史中沒有找到密鑰。' }),
      }
    } catch (error) {
      return { text: pick(lang, { en: `secret-scrub: masking the prompt history failed (${String(error)}).`, 'zh-TW': `secret-scrub：遮蔽輸入框歷史失敗（${String(error)}）。` }) }
    }
  })

  // A prompt whose secrets were masked on the way in still sits in history.jsonl as typed.
  on('session.end', async ($, e, next) => {
    try {
      await scrubHistoryFile($, scrubbing, e.sessionId)
    } catch (error) {
      $.ui.log(`secret-scrub: history rewrite failed: ${String(error)}`, { to: 'debug' })
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (scrubbing.bypass.test(e.text)) {
      $.ui.toast(pick(scrubbing.lang, { en: `secret-scrub: this prompt is sent as typed, per ${scrubbing.marker}`, 'zh-TW': `secret-scrub：此 prompt 依 ${scrubbing.marker} 原樣送出` }))

      return next({ ...e, text: e.text.replace(scrubbing.bypass, '$1').trim() })
    }

    const { text, labels } = scrub(e.text, scrubbing.options)
    if (labels.length === 0) {
      return next(e)
    }

    $.ui.toast(
      pick(scrubbing.lang, {
        en: `secret-scrub: masked ${labels.length} secret(s) (${summarize(labels)})`,
        'zh-TW': `secret-scrub：已遮蔽 ${labels.length} 個密鑰（${summarize(labels)}）`,
      }),
      { timeoutMs: 8000 },
    )

    const submitted = await next({ ...e, text })
    // Nothing may throw past `next`: the catch below would send the prompt again.
    try {
      const current = scrubbing
      $.clock.after(REWRITE_DELAY_MS, () => void scrubSessionHistory($, current))
    } catch (error) {
      $.ui.log(`secret-scrub: history rewrite not scheduled: ${String(error)}`, { to: 'debug' })
    }

    return submitted
  }).catch(async ($, e, next) => {
    if (next.called) {
      return next(e)
    }
    // A failing scrubber must not send secrets unchecked: hold the prompt back and put it in the
    // prompt box again, where #noscrub can send it as typed.
    if (typeof e.text === 'string' && (e.origin === undefined || e.origin.kind === 'composer')) {
      await $.prompt.fill({ text: e.text, mode: 'replace' })
    }

    return {
      drop: pick(scrubbing.lang, {
        en: `secret-scrub: the check failed; the prompt was not sent and is back in the prompt box; add ${scrubbing.marker} to send it when you are sure it holds no secret`,
        'zh-TW': `secret-scrub：檢查失敗，prompt 未送出並已放回輸入框；確定不含密鑰時加上 ${scrubbing.marker} 再送出`,
      }),
    }
  })
}
