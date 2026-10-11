import type { EngineInterface, Register } from 'claude-code'

import {
  cleanRemovals,
  CD_SCRIPT,
  describe,
  listed,
  lostChanges,
  MIGRATION_LISTERS,
  parseRm,
  RM_SCRIPT,
  size,
  type Preview,
} from './preview'
import {
  badSubject,
  cleanDryRun,
  commitSubject,
  discardScope,
  droppedStash,
  gitCalls,
  gitRisks,
  PROTECTED_BRANCHES,
  pushTargets,
  shellRisks,
  stripAttribution,
  type GitCall,
  type Risk,
} from './rules'
import { configCommand, LANGUAGE, loadConfig, pick, resolve, type ConfigIO, type Lang, type Resolved, type Specs } from './config'

const MOD = 'tool-guard'
const ALLOW = 'allow'
const ALLOW_WINDOW_MS = 10 * 60 * 1000
// The rule a command is blocked under when the guard itself failed to check it.
const CHECK_FAILED = 'check-failed'
// What a failed check still blocks; every other command runs as usual.
const GUARDED = /\b(?:git|rm|migrate)\b|db:migrate/

const PANE = 'tool-guard'
// A hook has 10 s of its own time, but time inside a `$` call is free, so the hold waits on a
// short `sleep` process until a button sets the decision.
const POLL_SECONDS = '0.25'
const HOLD_LIMIT_MS = 10 * 60 * 1000
const TIMEOUT_MS = 15_000

type Answer = 'proceed' | 'cancel'

// A command waiting on the person: what it would change and, once pressed, their answer.
type Hold = { command: string; previews: Preview[]; answer?: Answer }

// --- measuring --------------------------------------------------------------------------

async function run($: EngineInterface, argv: string[], cwd?: string) {
  return $.process.run(argv, { ...(cwd ? { cwd } : {}), timeoutMs: TIMEOUT_MS })
}

// The absolute folder a command runs in: undefined for the session's, null when it cannot
// be told (`cd -`, a folder that does not exist).
async function resolveDir($: EngineInterface, dir: string | undefined): Promise<string | undefined | null> {
  if (dir === undefined) {
    return undefined
  }
  if (dir === '-') {
    return null
  }
  const ran = await run($, ['bash', '-c', CD_SCRIPT, 'tool-guard', dir])
  const out = ran.stdout.trim()

  return ran.exitCode === 0 && out !== '' ? out : null
}

async function currentBranch($: EngineInterface, cwd?: string): Promise<string | undefined> {
  const ran = await run($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd)

  return ran.exitCode === 0 ? ran.stdout.trim() : undefined
}

// What a force push drops: per target branch, the commits there that the pushed source
// lacks, as of the last fetch. Undefined when it drops none from an unprotected branch.
async function previewPush($: EngineInterface, lang: Lang, risk: Risk & { call: GitCall }, cwd?: string): Promise<Preview | undefined> {
  const dropped: string[] = []
  const notes: string[] = []
  let isProtected = false
  const refs: string[] = []
  for (const target of pushTargets(risk.call.args)) {
    const branch = target.branch ?? (await currentBranch($, cwd))
    if (!branch) {
      notes.push(pick(lang, { en: 'Cannot tell the current branch.', 'zh-TW': '無法判斷目前的分支。' }))
      continue
    }
    isProtected ||= PROTECTED_BRANCHES.includes(branch)
    const ref = `${target.remote}/${branch}`
    refs.push(ref)
    const known = await run($, ['git', 'rev-parse', '--verify', '--quiet', ref], cwd)
    if (known.exitCode !== 0) {
      notes.push(
        pick(lang, {
          en: `There is no ${ref} locally, so the commits it would overwrite cannot be listed; run git fetch first.`,
          'zh-TW': `本機沒有 ${ref}，無法列出會被蓋掉的 commit；先 git fetch 再看。`,
        }),
      )
      continue
    }
    const log = await run($, ['git', 'log', '--oneline', '--no-decorate', `${target.source}..${ref}`], cwd)
    dropped.push(...log.stdout.split('\n').filter(line => line !== ''))
  }
  if (dropped.length === 0 && notes.length === 0 && !isProtected) {
    return undefined
  }
  const where = refs.join(lang === 'zh-TW' ? '、' : ', ') || pick(lang, { en: 'the remote branch', 'zh-TW': '遠端分支' })

  return {
    rule: 'force-push',
    label: risk.label,
    summary:
      dropped.length > 0
        ? pick(lang, { en: `Overwrites ${dropped.length} commit(s) on ${where}`, 'zh-TW': `蓋掉 ${where} 上的 ${dropped.length} 個 commit` })
        : isProtected
          ? pick(lang, { en: `Rewrites the protected ${where}`, 'zh-TW': `改寫受保護的 ${where}` })
          : pick(lang, { en: `Force push to ${where}`, 'zh-TW': `force push 到 ${where}` }),
    ...listed(dropped),
    note: [...notes, pick(lang, { en: 'The list reflects the remote as of the last fetch.', 'zh-TW': '清單依上次 fetch 的遠端狀態。' })].join(' '),
  }
}

async function previewDiscard($: EngineInterface, lang: Lang, risk: Risk & { call: GitCall }, cwd?: string): Promise<Preview | undefined> {
  if (risk.call.sub === 'clean') {
    const ran = await run($, ['git', ...cleanDryRun(risk.call.args)], cwd)
    if (ran.exitCode !== 0) {
      return {
        rule: 'discard',
        label: risk.label,
        summary: pick(lang, { en: 'Cannot dry-run git clean -n', 'zh-TW': '無法試跑 git clean -n' }),
        lines: [],
        more: 0,
        note: ran.stderr.trim().slice(0, 200),
      }
    }
    const removed = cleanRemovals(ran.stdout)

    return removed.length === 0
      ? undefined
      : {
          rule: 'discard',
          label: risk.label,
          summary: pick(lang, { en: `Deletes ${removed.length} untracked path(s)`, 'zh-TW': `刪除 ${removed.length} 個未追蹤的路徑` }),
          ...listed(removed),
          note: pick(lang, {
            en: 'The list comes from git clean -n; untracked files are not in git, so deleting them cannot be undone.',
            'zh-TW': '清單來自 git clean -n；未追蹤的檔案不在 git 裡，刪了無法復原。',
          }),
        }
  }

  const scope = discardScope(risk.call)
  const status = await run($, ['git', 'status', '--porcelain', '--', ...scope.paths], cwd)
  if (status.exitCode !== 0) {
    return {
      rule: 'discard',
      label: risk.label,
      summary: pick(lang, { en: 'Cannot read git status', 'zh-TW': '無法讀取 git status' }),
      lines: [],
      more: 0,
      note: status.stderr.trim().slice(0, 200),
    }
  }
  const lost = lostChanges(status.stdout, scope.isStagedLost)
  if (lost.length === 0) {
    return undefined
  }
  const stat = await run($, ['git', 'diff', '--shortstat', ...(scope.isStagedLost ? ['HEAD'] : []), '--', ...scope.paths], cwd)

  return {
    rule: 'discard',
    label: risk.label,
    summary: pick(lang, { en: `Discards uncommitted changes in ${lost.length} file(s)`, 'zh-TW': `丟掉 ${lost.length} 個檔案未 commit 的改動` }),
    ...listed(lost),
    note: [
      stat.stdout.trim(),
      pick(lang, { en: 'Uncommitted changes cannot be recovered; save them with git stash or a commit first.', 'zh-TW': '未 commit 的改動無法復原，先用 git stash 或 commit 保存。' }),
    ]
      .filter(part => part !== '')
      .join(pick(lang, { en: '. ', 'zh-TW': '。' })),
  }
}

async function previewStash($: EngineInterface, lang: Lang, risk: Risk & { call: GitCall }, cwd?: string): Promise<Preview | undefined> {
  const list = await run($, ['git', 'stash', 'list'], cwd)
  const stashes = list.stdout.split('\n').filter(line => line !== '')
  if (stashes.length === 0) {
    return undefined
  }
  const ref = droppedStash(risk.call)
  if (ref === undefined) {
    return {
      rule: 'stash-drop',
      label: risk.label,
      summary: pick(lang, { en: `Permanently deletes all ${stashes.length} stash(es)`, 'zh-TW': `永久刪除全部 ${stashes.length} 個 stash` }),
      ...listed(stashes),
    }
  }
  const show = await run($, ['git', 'stash', 'show', '--stat', ref], cwd)
  const entry = stashes.find(line => line.startsWith(`${ref}:`))

  return {
    rule: 'stash-drop',
    label: risk.label,
    summary: pick(lang, { en: `Permanently deletes ${entry ?? ref}`, 'zh-TW': `永久刪除 ${entry ?? ref}` }),
    ...listed(show.stdout.split('\n').filter(line => line.trim() !== '')),
  }
}

async function previewRm(
  $: EngineInterface,
  lang: Lang,
  risk: Risk & { rule: 'rm' },
  skips: readonly string[],
  cwd?: string,
): Promise<Preview | undefined> {
  if (risk.targets.length === 0) {
    return undefined
  }
  const ran = await run($, ['bash', '-c', RM_SCRIPT, 'tool-guard', skips.join('\n'), ...risk.targets], cwd)
  if (ran.exitCode !== 0) {
    return {
      rule: 'rm',
      label: risk.label,
      summary: pick(lang, { en: 'Cannot estimate the files to be deleted', 'zh-TW': '無法估算會刪除的檔案' }),
      lines: [],
      more: 0,
      note: ran.stderr.trim().slice(0, 200),
    }
  }
  const measured = parseRm(ran.stdout)
  // Nothing matches, everything is under a temp folder, or only empty folders go.
  if (measured.paths === 0 || measured.files === 0) {
    return undefined
  }

  return {
    rule: 'rm',
    label: risk.label,
    summary: pick(lang, {
      en: `Deletes ${measured.files} file(s) (about ${size(measured.bytes)})`,
      'zh-TW': `刪除 ${measured.files} 個檔案（約 ${size(measured.bytes)}）`,
    }),
    lines: measured.listed,
    more: Math.max(0, measured.files - measured.listed.length),
    note: pick(lang, { en: `Paths: ${risk.targets.join(' ')}`, 'zh-TW': `路徑：${risk.targets.join(' ')}` }),
  }
}

async function previewMigrate($: EngineInterface, lang: Lang, risk: Risk & { rule: 'migrate' }, cwd?: string): Promise<Preview | undefined> {
  const lister = MIGRATION_LISTERS[risk.tool]
  if (lister === undefined) {
    return {
      rule: 'migrate',
      label: risk.label,
      summary: pick(lang, { en: 'Runs a migration', 'zh-TW': '執行 migration' }),
      lines: [],
      more: 0,
      note: pick(lang, { en: 'The pending migrations of this tool cannot be listed.', 'zh-TW': '無法列出這個工具待執行的 migration。' }),
    }
  }
  const ran = await run($, lister.argv, cwd)
  if (ran.exitCode !== 0) {
    return {
      rule: 'migrate',
      label: risk.label,
      summary: pick(lang, { en: 'Runs a migration', 'zh-TW': '執行 migration' }),
      lines: [],
      more: 0,
      note: pick(lang, {
        en: `Cannot list the pending migrations (${lister.argv.join(' ')} failed).`,
        'zh-TW': `無法列出待執行的 migration（${lister.argv.join(' ')} 失敗）。`,
      }),
    }
  }
  const pending = ran.stdout.split('\n').filter(lister.isPending).map(lister.strip)

  return pending.length === 0
    ? undefined
    : {
        rule: 'migrate',
        label: risk.label,
        summary: pick(lang, { en: `Applies ${pending.length} pending migration(s)`, 'zh-TW': `套用 ${pending.length} 個待執行的 migration` }),
        ...listed(pending),
        note: pick(lang, { en: `The list comes from ${lister.argv.join(' ')}.`, 'zh-TW': `清單來自 ${lister.argv.join(' ')}。` }),
      }
}

// What the risk would change, or undefined when it would change nothing worth asking about.
// A measurement that fails is shown as such and still asks.
async function previewOf($: EngineInterface, lang: Lang, risk: Risk, skips: readonly string[]): Promise<Preview | undefined> {
  const where = 'call' in risk ? risk.call.dir : risk.dir
  const cwd = await resolveDir($, where)
  if (cwd === null) {
    return {
      rule: risk.rule,
      label: risk.label,
      summary: pick(lang, { en: `Cannot estimate (directory ${where} not found)`, 'zh-TW': `無法估算（找不到目錄 ${where}）` }),
      lines: [],
      more: 0,
    }
  }
  try {
    switch (risk.rule) {
      case 'force-push':
        return await previewPush($, lang, risk, cwd)
      case 'discard':
        return await previewDiscard($, lang, risk, cwd)
      case 'stash-drop':
        return await previewStash($, lang, risk, cwd)
      case 'no-verify':
        return {
          rule: risk.rule,
          label: risk.label,
          summary: pick(lang, {
            en: 'Skips the checks of git hooks (pre-commit, commit-msg, pre-push)',
            'zh-TW': '略過 git hooks（pre-commit、commit-msg、pre-push）的檢查',
          }),
          lines: [],
          more: 0,
        }
      case 'rm':
        return await previewRm($, lang, risk, skips, cwd)
      case 'migrate':
        return await previewMigrate($, lang, risk, cwd)
    }
  } catch (error) {
    return {
      rule: risk.rule,
      label: risk.label,
      summary: pick(lang, { en: 'Cannot estimate the impact', 'zh-TW': '無法估算影響範圍' }),
      lines: [],
      more: 0,
      note: String(error).slice(0, 200),
    }
  }
}

// --- holding ----------------------------------------------------------------------------

// Waits for the person's answer to `hold`; the pane is already up.
async function waitForAnswer($: EngineInterface, hold: Hold, signal: AbortSignal): Promise<Answer | 'timeout' | 'interrupted'> {
  const startedAt = await $.clock.now()
  while (hold.answer === undefined) {
    if (signal.aborted) {
      return 'interrupted'
    }
    if ((await $.clock.now()) - startedAt > HOLD_LIMIT_MS) {
      return 'timeout'
    }
    await $.process.run(['sleep', POLL_SECONDS], { timeoutMs: 5000 })
  }

  return hold.answer
}

type Asked = { answer: Answer | 'dismissed'; reply?: string }

// Asks in the engine's own question dialog, which fits any width: the fallback for a pane the
// surface will not place. Cancel comes first, so a dialog that settles by default refuses.
async function askAnswer($: EngineInterface, lang: Lang, previews: Preview[]): Promise<Asked> {
  const cancel = pick(lang, { en: 'Cancel', 'zh-TW': '取消' })
  const run = pick(lang, { en: 'Run', 'zh-TW': '執行' })
  let choice: string
  try {
    choice = await $.ui.ask(`${describe(previews, lang)}\n\n${pick(lang, { en: 'Run this command?', 'zh-TW': '要執行這個指令嗎？' })}`, {
      options: [cancel, run],
      header: 'tool-guard',
    })
  } catch {
    return { answer: 'dismissed' }
  }
  if (choice === run) {
    return { answer: 'proceed' }
  }

  return choice === cancel || choice === '' ? { answer: 'cancel' } : { answer: 'cancel', reply: choice }
}

function paneRows(previews: Preview[]): number {
  const body = previews.reduce((sum, p) => sum + 1 + p.lines.length + (p.more > 0 ? 1 : 0) + (p.note ? 1 : 0), 0)

  return Math.min(24, 6 + body)
}

export const SPECS: Specs = {
  commit_format: {
    category: 'protect',
    type: 'boolean',
    default: false,
    repo: 'only-true',
    description: {
      en: 'Check the commit subject format; a subject that does not match is blocked and Claude is asked to fix it',
      'zh-TW': '檢查 commit 標題格式，不符合就擋下請 Claude 改',
    },
  },
  commit_pattern: {
    category: 'plain',
    type: 'string',
    default: '',
    repo: 'any',
    description: {
      en: 'Regular expression a commit subject must match; empty means `<emoji> type(scope)!: description` (Conventional Commits)',
      'zh-TW': 'commit 標題要符合的正規表示式；空白時用 `<emoji> type(scope)!: 描述`（Conventional Commits）',
    },
  },
  strip_attribution: {
    category: 'plain',
    type: 'boolean',
    default: true,
    repo: 'any',
    description: { en: "Remove Claude's Co-Authored-By trailer from commit messages", 'zh-TW': '從 commit 訊息移除 Claude 的 Co-Authored-By 署名' },
  },
  rm_skip_paths: {
    category: 'protect',
    type: 'list',
    default: [],
    repo: 'never',
    description: {
      en: 'Folders rm is not checked in (besides temp folders); only in the user settings file or the local file',
      'zh-TW': 'rm 不檢查的資料夾（暫存資料夾之外再加的）；只能放在使用者設定檔或 local 檔案',
    },
  },
  language: LANGUAGE,
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

// The setting `commit_pattern` as a RegExp; undefined for the built-in format or a pattern that does not compile.
export function subjectPattern(pattern: string): RegExp | undefined {
  if (pattern.trim() === '') {
    return undefined
  }
  try {
    return new RegExp(pattern)
  } catch {
    return undefined
  }
}

export const register: Register = (on, options) => {
  // Re-read at session start and after `/tool-guard set`; `/config` changes reload the module.
  let config: Resolved = resolve(SPECS, { options, user: {}, repo: {}, local: {}, session: {} })
  const apply = (resolved: Resolved) => {
    config = resolved
  }
  // One allowance the person grants with /tool-guard allow, for the rules last blocked.
  let lastBlocked: string[] | undefined
  let allowance: { rules: string[]; until: number } | undefined
  let isInteractive = true
  // The command the pane shows. One at a time: a second risky call waits for the first.
  let held: Hold | undefined

  // Spends the allowance when it covers every rule and has not expired.
  function takeAllowance(rules: string[], now: number): boolean {
    if (!allowance || now > allowance.until || !rules.every(rule => allowance?.rules.includes(rule))) {
      return false
    }
    allowance = undefined

    return true
  }

  function denial(rules: string[], reason: string): { deny: string } {
    lastBlocked = rules

    return {
      deny:
        `tool-guard: ${reason}\n` +
        pick(config.lang, {
          en: `If you are sure it should run, first explain why to the user and ask them to type /${MOD} ${ALLOW}, then run the same command again.`,
          'zh-TW': `若確定要執行，請先向使用者說明原因並請他輸入 /${MOD} ${ALLOW}，再重新執行同一個指令。`,
        }),
    }
  }

  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    try {
      apply(await loadConfig(configIO($), MOD, SPECS, options))
    } catch (error) {
      $.ui.log(`session.start: settings not read: ${String(error)}`, { to: 'debug' })
    }
    const lang = config.lang
    try {
      await $.command.register({
        name: MOD,
        description: pick(lang, {
          en: 'Allow the next command of the same kind that tool-guard blocked (allow, valid for 10 minutes), or view and change settings',
          'zh-TW': '允許下一個被 tool-guard 擋下的同類指令（allow，10 分鐘內有效），或看、改設定',
        }),
        argumentHint: 'allow | status | set <key> <value> | unset <key>',
      })
    } catch (error) {
      $.ui.log(`session.start: /${MOD} not registered: ${String(error)}`, { to: 'debug' })
      $.ui.toast(pick(lang, { en: `${MOD}: /${MOD} was not registered (${String(error)})`, 'zh-TW': `${MOD}：/${MOD} 指令沒有註冊成功（${String(error)}）` }))
    }
    if (config.values.commit_pattern !== '' && subjectPattern(config.values.commit_pattern as string) === undefined) {
      $.ui.toast(
        pick(lang, {
          en: `${MOD}: commit_pattern is not a valid regular expression; the built-in format is used`,
          'zh-TW': `${MOD}：commit_pattern 不是有效的正規表示式，改用內建格式`,
        }),
      )
    }

    return next(e)
  })

  on('command.run', { command: MOD }, async ($, e) => {
    if (e.args.trim().split(/\s+/)[0] !== ALLOW) {
      const text = await configCommand(configIO($), MOD, SPECS, options, e.args, apply)

      const usage = pick(config.lang, {
        en: `Usage: /${MOD} ${ALLOW}, /${MOD} status, /${MOD} set <key> <value> [--session|--local|--repo], /${MOD} unset <key>`,
        'zh-TW': `用法：/${MOD} ${ALLOW}、/${MOD} status、/${MOD} set <key> <value> [--session|--local|--repo]、/${MOD} unset <key>`,
      })

      return { text: text ?? usage }
    }
    if (lastBlocked === undefined) {
      return { text: pick(config.lang, { en: 'tool-guard has not blocked any command yet.', 'zh-TW': 'tool-guard 目前沒有擋下任何指令。' }) }
    }
    allowance = { rules: lastBlocked, until: (await $.clock.now()) + ALLOW_WINDOW_MS }
    const names = lastBlocked.join(config.lang === 'zh-TW' ? '、' : ', ')

    return {
      text: pick(config.lang, {
        en: `The user allowed the next command that tool-guard blocks under the rule(s) "${names}" (valid for 10 minutes); you can run it again.`,
        'zh-TW': `使用者已允許下一個被 tool-guard 以「${names}」規則擋下的指令（10 分鐘內有效），可以重新執行。`,
      }),
    }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const calls = gitCalls(e.command)
    const risks = [...calls.flatMap(gitRisks), ...shellRisks(e.command)]
    if (calls.length === 0 && risks.length === 0) {
      return next(e)
    }

    // A malformed commit subject is Claude's to fix, not the person's to approve.
    const lang = config.lang
    const pattern = subjectPattern(config.values.commit_pattern as string)
    for (const call of config.values.commit_format === true ? calls : []) {
      const subject = call.sub === 'commit' ? commitSubject(e.command, call.args) : undefined
      if (subject !== undefined && badSubject(subject, pattern) && !takeAllowance(['subject'], await $.clock.now())) {
        $.ui.toast(pick(lang, { en: 'tool-guard blocked: commit subject format', 'zh-TW': 'tool-guard 擋下：commit 標題格式' }))

        return denial(
          ['subject'],
          pattern === undefined
            ? pick(lang, {
                en:
                  `The commit subject "${subject}" does not follow Conventional Commits. ` +
                  'Format: `<emoji> <type>(<scope>): <description>`; emoji and scope are optional, e.g. `✨ feat(claude): add tool-guard`.',
                'zh-TW':
                  `commit 標題「${subject}」不符合 Conventional Commits。` +
                  '格式：`<emoji> <type>(<scope>): <描述>`，emoji 與 scope 可省略，例如 `✨ feat(claude): 新增 tool-guard`。',
              })
            : pick(lang, {
                en: `The commit subject "${subject}" does not match the format set for this repo: \`${pattern.source}\`.`,
                'zh-TW': `commit 標題「${subject}」不符合這個 repo 設定的格式 \`${pattern.source}\`。`,
              }),
        )
      }
    }

    const previews: Preview[] = []
    for (const risk of risks) {
      const preview = await previewOf($, lang, risk, config.values.rm_skip_paths as readonly string[])
      if (preview) {
        previews.push(preview)
      }
    }
    const rules = [...new Set(previews.map(preview => preview.rule))]

    if (previews.length > 0 && takeAllowance(rules, await $.clock.now())) {
      $.ui.toast(
        pick(lang, {
          en: `tool-guard: let through as the user allowed (${rules.join(', ')})`,
          'zh-TW': `tool-guard：依使用者允許放行（${rules.join('、')}）`,
        }),
      )
    } else if (previews.length > 0) {
      // One hold at a time; `held` is claimed with no await between the check and the claim.
      while (held !== undefined) {
        if (next.signal.aborted) {
          return {
            deny: pick(lang, {
              en: 'tool-guard: the turn was interrupted and the command did not run. Do not retry unless the user asks.',
              'zh-TW': 'tool-guard: 回合已中斷，指令沒有執行。除非使用者要求，不要重試。',
            }),
          }
        }
        await $.process.run(['sleep', POLL_SECONDS], { timeoutMs: 5000 })
      }
      const hold: Hold = { command: e.command, previews }
      held = hold
      $.ui.invalidate('ui.render')
      let answer: Asked['answer'] | 'timeout' | 'interrupted' | 'unplaced' = 'unplaced'
      let reply: string | undefined
      try {
        if (isInteractive) {
          const opened = await $.ui.open({ id: PANE, title: 'tool-guard', focus: true, rows: paneRows(previews) })
          if (opened.isPlaced) {
            answer = await waitForAnswer($, hold, next.signal)
          } else {
            $.ui.log(`tool-guard: pane not placed (${opened.reason}), asking in a dialog instead`, { to: 'debug' })
            await $.ui.close({ id: PANE }).catch(() => undefined)
            ;({ answer, reply } = await askAnswer($, lang, previews))
          }
        }
      } finally {
        // Close this call's pane before releasing the hold, so the next call's pane is not
        // the one closed. An unplaced pane is closed too, so it never shows up later.
        await $.ui.close({ id: PANE }).catch(() => undefined)
        if (held === hold) {
          held = undefined
        }
        $.ui.invalidate('ui.render')
      }

      const what = describe(previews, lang)
      if (answer === 'unplaced') {
        $.ui.toast(pick(lang, { en: `tool-guard blocked: ${rules.join(', ')}`, 'zh-TW': `tool-guard 擋下：${rules.join('、')}` }))

        return denial(
          rules,
          pick(lang, {
            en: `This command would have the following effects; it is blocked because this is a non-interactive session and the user cannot be asked:\n${what}`,
            'zh-TW': `這個指令會造成以下影響，因為是非互動模式、無法詢問使用者，所以先擋下：\n${what}`,
          }),
        )
      }
      if (answer !== 'proceed') {
        const why = {
          cancel: reply
            ? pick(lang, { en: `The user did not choose to run it and replied: "${reply}"`, 'zh-TW': `使用者沒有選擇執行，回覆：「${reply}」` })
            : pick(lang, { en: 'The user pressed Cancel', 'zh-TW': '使用者按了取消' }),
          timeout: pick(lang, { en: 'No answer within 10 minutes', 'zh-TW': '10 分鐘內沒有回應' }),
          interrupted: pick(lang, { en: 'The turn was interrupted', 'zh-TW': '回合已中斷' }),
          dismissed: pick(lang, { en: 'The user closed the question dialog', 'zh-TW': '使用者關閉了詢問對話框' }),
        }[answer]

        return {
          deny: pick(lang, {
            en: `tool-guard: ${why}, so the command did not run. It would have:\n${what}\nDo not retry unless the user asks.`,
            'zh-TW': `tool-guard: ${why}，指令沒有執行。它原本會：\n${what}\n除非使用者要求，不要重試。`,
          }),
        }
      }
      $.ui.toast(pick(lang, { en: 'tool-guard: confirmed by the user, running the command', 'zh-TW': 'tool-guard：使用者確認，執行指令' }))
    }

    const stripped = stripAttribution(e.command)
    if (config.values.strip_attribution === true && stripped.isChanged && calls.some(call => call.sub === 'commit')) {
      $.ui.toast(pick(lang, { en: 'tool-guard: removed the Claude trailer from the commit message', 'zh-TW': 'tool-guard：已從 commit 訊息移除 Claude 署名' }))

      return next({ ...e, command: stripped.command })
    }

    return next(e)
  }).catch(async ($, e, next) => {
    // A broken guard must not let a destructive command run unchecked: guarded commands wait
    // for /tool-guard allow, every other command runs as usual.
    if (next.called || !GUARDED.test(e.command)) {
      return next(e)
    }
    const lang = config.lang
    // A Bash call raised beneath one of this hook's own `$` calls: `$` rejects here, so it is
    // judged from `e` alone.
    if (next.error.kind === 're-entry') {
      return {
        deny: pick(lang, {
          en: 'tool-guard: this command was triggered while a check was running and cannot be checked, so it is blocked.',
          'zh-TW': 'tool-guard: 這個指令在檢查進行中被觸發，無法檢查，已擋下。',
        }),
      }
    }
    if (takeAllowance([CHECK_FAILED], await $.clock.now().catch(() => Infinity))) {
      $.ui.toast(pick(lang, { en: 'tool-guard: the check failed; let through as the user allowed', 'zh-TW': 'tool-guard：檢查失敗，依使用者允許放行' }))

      return next(e)
    }
    $.ui.toast(pick(lang, { en: 'tool-guard: the check failed; the command is blocked', 'zh-TW': 'tool-guard：檢查失敗，已擋下指令' }))

    return denial(
      [CHECK_FAILED],
      pick(lang, {
        en: `The check failed (${next.error.message ?? next.error.kind}); a command that has not been checked is always blocked.`,
        'zh-TW': `檢查失敗（${next.error.message ?? next.error.kind}），未經檢查的指令一律擋下。`,
      }),
    )
  })

  // A pane the person closes by hand is a Cancel.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person' && held && held.answer === undefined) {
      held.answer = 'cancel'
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e, next) => {
    const hold = held
    if (!hold) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    const lang = config.lang
    // The buttons answer the command this pane was drawn for, never whichever is held now.
    const answer = (choice: Answer) => () => {
      hold.answer ??= choice
    }

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
        <Text wrap="truncate-end">
          <Text dimColor>{pick(lang, { en: 'Command ', 'zh-TW': '指令 ' })}</Text>
          <Text bold>{hold.command.replace(/\s+/g, ' ')}</Text>
        </Text>
        {hold.previews.map((preview, i) => (
          <Box key={`p${i}`} flexDirection="column" marginTop={1}>
            <Text>
              <Text bold>{preview.label}</Text>
              <Text>  </Text>
              <Text bold color="red">
                {preview.summary}
              </Text>
            </Text>
            {preview.lines.map((line, j) => (
              <Text key={`l${j}`} wrap="truncate-end">
                {`  ${line}`}
              </Text>
            ))}
            {preview.more > 0 && <Text dimColor>{`  ${pick(lang, { en: `${preview.more} more`, 'zh-TW': `另有 ${preview.more} 項` })}`}</Text>}
            {preview.note && (
              <Text dimColor wrap="wrap">
                {preview.note}
              </Text>
            )}
          </Box>
        ))}
        <Box marginTop={1} gap={2}>
          <Button key="proceed" label={pick(lang, { en: 'Run', 'zh-TW': '執行' })} hotkey="1" plain onPress={answer('proceed')} />
          <Button key="cancel" label={pick(lang, { en: 'Cancel', 'zh-TW': '取消' })} hotkey="2" plain autoFocus onPress={answer('cancel')} />
          <Text dimColor>{pick(lang, { en: 'Claude is waiting for your answer', 'zh-TW': 'Claude 等待你回答' })}</Text>
        </Box>
      </Box>
    )
  })
}
