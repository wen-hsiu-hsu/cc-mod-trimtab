import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import { configCommand, firstUse, LANGUAGE, loadConfig, nextExpiry, onLine, pick, resolve, type ConfigIO, type Lang, type Resolved, type Specs } from './config'
import { MERGE_OPS, applyActions, changesNote, distillPrompt, latestProgress, mergePrompt, parseActions } from './distill'
import type { Rejected } from './distill'
import { FILE_PREFIX, INDEX_CAP, INDEX_FILE, indexEntries, joinLive, listed, notesOf, readStore, renderMemory, renderRule, splitLive, storeOf, updateIndex, withActiveDay } from './notes'
import type { Notes, RepoStore } from './notes'
import { PROGRESS_FILE, progressForPrompt, renderProgress, withExclude } from './progress'
import { PROMOTE_DESCRIPTION, PROMOTE_SCHEMA, PROMOTE_TOOL, applyPlaced, markAsked, promoteItems, promoteReport, promoteText, readReport } from './promote'
import { lastAnchor, transcriptOf, userTextOf } from './transcript'
import type { Row } from './transcript'

const COMMAND = 'project-memory'
const TOOL = 'mcp__project-memory__mark_in_project'
const NOTES_MODEL = 'sonnet'
const DISTILL_MAX_TOKENS = 4000
const DISTILL_TIMEOUT_MS = 3 * 60_000
// Besides every N prompts: after idling, and at a /clear, once this many prompts are new.
const END_MIN_TURNS = 5

const pending = atom({ plugin: 'project-memory', key: 'pending' } as const, null)
const promoted = atom({ plugin: 'project-memory', key: 'promoted' } as const, false)
const onUntil = atom({ plugin: 'project-memory', key: 'onUntil' } as const, {})
const now = atom({ plugin: 'project-memory', key: 'now' } as const, 0)

// Redraws the time left of a feature switched on for a while.
const TICK_MS = 30_000

type Config = { isDistillOn: boolean; every: number; minTokens: number; idleMs: number; isPromoteOn: boolean; lang: Lang }
type Last = { at: number; why: string; changes: string[]; rejected: Rejected; error?: string }
type Mark = { turn: number; anchor?: string }
// The conversation as it stood when a /clear ended it: the distill runs after the session moved on.
type Snapshot = { sid: string; turns: number; rows: readonly Row[] }

const clamp = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback

export function configOf(options: Record<string, unknown>): Config {
  return {
    isDistillOn: options.distill === true,
    every: clamp(options.distill_every, 30, 5, 200),
    minTokens: clamp(options.min_context_k, 30, 0, 1000) * 1000,
    // 0: no distill on idling.
    idleMs: clamp(options.idle_minutes, 10, 0, 120) * 60_000,
    isPromoteOn: options.promote !== false,
    lang: options.language === 'zh-TW' ? 'zh-TW' : 'en',
  }
}

const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
const dirOf = (p: string) => slash(p).replace(/\/[^/]*$/, '')
const encodeProject = (p: string) => slash(p).replace(/[^A-Za-z0-9]/g, '-')

// Local "YYYY-MM-DD HH:mm".
export function localStamp(ms: number) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)

  return d.toISOString().slice(0, 16).replace('T', ' ')
}

// The repository the notes belong to: the main working tree's root, so worktrees share them.
async function workspace($: EngineInterface): Promise<string> {
  return slash((await $.session.repo())?.root ?? (await $.session.root()))
}

// The built-in memory folder: where the context loaded MEMORY.md from, else where Claude Code keeps it.
// Asked once per repository: the breakdown is not free.
const dirs = new Map<string, string>()

async function memoryDir($: EngineInterface): Promise<string> {
  const root = await workspace($)
  const known = dirs.get(root)
  if (known !== undefined) return known
  const dir = await findMemoryDir($, root)
  dirs.set(root, dir)

  return dir
}

async function findMemoryDir($: EngineInterface, root: string): Promise<string> {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const auto = usage.context.breakdown?.memoryFiles.find(f => f.type === 'AutoMem' && slash(f.path).endsWith(`/${INDEX_FILE}`))
    if (auto !== undefined) {
      return dirOf(auto.path)
    }
  } catch {
    // Fall back to the computed folder.
  }
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = custom ? slash(custom) : `${slash((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '')}/.claude`

  return `${home}/projects/${encodeProject(root)}/memory`
}

async function readText($: EngineInterface, path: string): Promise<string> {
  try {
    return await $.fs.read(path)
  } catch {
    return ''
  }
}

const repoKey = async ($: EngineInterface) => `repo:${await workspace($)}`
const lastKey = async ($: EngineInterface) => `last:${await workspace($)}`
const today = async ($: EngineInterface) => localStamp(await $.clock.now()).slice(0, 10)

async function loadStore($: EngineInterface): Promise<RepoStore> {
  return readStore(await $.store.get(await repoKey($)))
}

// Counts the day toward staleness: a memory goes stale over days the repository was worked on.
let notedDay = ''

async function noteActiveDay($: EngineInterface): Promise<void> {
  const key = `${await workspace($)}|${await today($)}`
  if (key === notedDay) return
  const store = await loadStore($)
  const days = withActiveDay(store.activeDays, await today($))
  if (days !== undefined) await $.store.set(await repoKey($), { ...store, activeDays: days })
  notedDay = key
}

// This mod's files in the memory folder, by name.
async function ownFiles($: EngineInterface, dir: string): Promise<{ file: string; text: string }[]> {
  let entries: { name: string; kind: string }[] = []
  try {
    entries = await $.fs.list(dir)
  } catch {
    return []
  }
  const files: { file: string; text: string }[] = []
  for (const entry of entries) {
    if (entry.kind === 'file' && entry.name.startsWith(FILE_PREFIX) && entry.name.endsWith('.md')) {
      files.push({ file: entry.name, text: await readText($, `${dir}/${entry.name}`) })
    }
  }

  return files
}

// Each memory and rule file's paths that are no longer in the repository.
async function gonePaths($: EngineInterface, notes: Notes, root: string): Promise<Map<string, string[]>> {
  const gone = new Map<string, string[]>()
  for (const item of [...notes.memory, ...notes.rules]) {
    if (item.file === undefined || item.paths.length === 0) continue
    const missing: string[] = []
    for (const p of item.paths) {
      if (!(await $.fs.exists(`${root}/${p}`).catch(() => true))) missing.push(p)
    }
    if (missing.length > 0) gone.set(item.file, missing)
  }

  return gone
}

// Writes what changed: each changed file, files no longer in the notes deleted, this mod's lines of
// MEMORY.md, the store. The asks and active days are read again unless given: a prompt may have
// recorded one while the distill ran.
async function saveNotes($: EngineInterface, lang: Lang, dir: string, before: readonly { file: string; text: string }[], notes: Notes, asked?: RepoStore['asked']): Promise<void> {
  const old = new Map(before.map(f => [f.file, f.text]))
  const kept = new Set<string>()
  for (const m of notes.memory) {
    kept.add(m.file)
    const text = renderMemory(m, lang)
    if (old.get(m.file) !== text) await $.fs.write(`${dir}/${m.file}`, text)
  }
  for (const r of notes.rules) {
    if (r.file === undefined) continue
    kept.add(r.file)
    const text = renderRule(r, lang)
    if (old.get(r.file) !== text) await $.fs.write(`${dir}/${r.file}`, text)
  }
  for (const file of old.keys()) {
    if (!kept.has(file)) await $.process.run(['rm', '-f', `${dir}/${file}`], { timeoutMs: 5000 })
  }
  const store = await loadStore($)
  const indexPath = `${dir}/${INDEX_FILE}`
  const index = await readText($, indexPath)
  const next = updateIndex(index, indexEntries(notes, store.activeDays))
  if (next !== index) await $.fs.write(indexPath, next)
  await $.store.set(await repoKey($), storeOf(notes, asked ?? store.asked, store.activeDays))
}

// `.claude/progress.md` in the repository, kept out of git through `.git/info/exclude`.
async function saveProgress($: EngineInterface, root: string, text: string): Promise<void> {
  await $.fs.write(`${root}/${PROGRESS_FILE}`, text)
  const exclude = `${root}/.git/info/exclude`
  if ((await $.fs.stat(`${root}/.git`).catch(() => undefined))?.kind !== 'dir') return
  const added = withExclude(await readText($, exclude))
  if (added !== undefined) await $.fs.write(exclude, added)
}

async function ask($: EngineInterface, system: string, prompt: string) {
  return $.model.complete({ model: NOTES_MODEL, effort: 'low', maxTokens: DISTILL_MAX_TOKENS, timeoutMs: DISTILL_TIMEOUT_MS, system, prompt })
}

// Past the index cap: one more request that may only merge and invalidate. Its result, or the
// notes as they were when it fails (the index then keeps the most recently confirmed).
async function mergeOver(
  $: EngineInterface,
  lang: Lang,
  notes: Notes,
  activeDays: readonly string[],
  day: string,
  sid: string,
  taken: ReadonlySet<string>,
): Promise<{ notes: Notes; changes: string[] }> {
  const count = listed(notes, activeDays).length
  if (count <= INDEX_CAP) return { notes, changes: [] }
  const { live, dead } = splitLive(notes)
  const r = await ask($, mergePrompt(live, activeDays, count, INDEX_CAP, lang), 'Output ACTIONS as the system prompt instructs.')
  if (!r.isAnswered) {
    $.ui.log(`project-memory: merge failed: ${r.reason}`, { to: 'debug' })

    return { notes, changes: [] }
  }
  const { actions } = parseActions(r.text, live, '', MERGE_OPS, lang)
  const merged = applyActions(actions, live, day, sid, taken, lang)

  return { notes: joinLive(merged.notes, dead, day), changes: merged.changes.map(c => pick(lang, { en: `Merged: ${c}`, 'zh-TW': `合併：${c}` })) }
}

let running = false
// After a failed automatic distill, wait this many prompts before the next try, so an outage
// does not cost a request every turn.
const RETRY_TURNS = 5
let retryAt = 0

// Distills the conversation since the last distill into the memory folder and the progress file.
// snap: a conversation that already ended (/clear); otherwise the session's own. Returns what to
// tell the person.
async function distill($: EngineInterface, lang: Lang, why: string, snap?: Snapshot): Promise<string> {
  if (running) return pick(lang, { en: 'A distill is running; try again shortly.', 'zh-TW': '整理中，稍後再試。' })
  const sid = snap?.sid ?? (await $.session.id())
  const markKey = `distill:${sid}`
  const mark = (await $.store.get(markKey)) as Mark | undefined
  const turns = snap?.turns ?? (await $.session.turns())
  if (turns <= (mark?.turn ?? 0)) return pick(lang, { en: 'No new conversation since the last distill.', 'zh-TW': '上次整理後沒有新的對話。' })
  running = true
  const lk = await lastKey($)
  const started = await $.clock.now()
  const fail = async (error: string) => {
    $.ui.log(`project-memory: distill failed (${why}): ${error}`, { to: 'debug' })
    if (snap === undefined) retryAt = turns + RETRY_TURNS
    await $.store.set(lk, { at: started, why, changes: [], rejected: { count: 0, samples: [] }, error } satisfies Last)

    return pick(lang, { en: `Distill failed: ${error}`, 'zh-TW': `整理失敗：${error}` })
  }
  try {
    const rows = snap?.rows ?? ((await $.session.messages()) as readonly Row[])
    const transcript = transcriptOf(rows, mark?.anchor)
    const dir = await memoryDir($)
    const root = await workspace($)
    const files = await ownFiles($, dir)
    const store = await loadStore($)
    const { live, dead } = splitLive(notesOf(files, store))
    const day = localStamp(started).slice(0, 10)
    const r = await ask(
      $,
      distillPrompt(transcript.found ? mark?.anchor : undefined, live, store.activeDays, progressForPrompt(await readText($, `${root}/${PROGRESS_FILE}`)), await gonePaths($, live, root), lang),
      `=== TRANSCRIPT ===\n${transcript.text || '(no new conversation)'}\n=== END OF TRANSCRIPT ===\n\nOutput ACTIONS as the system prompt instructs.`,
    )
    if (!r.isAnswered) {
      return await fail(r.reason === 'api-error' ? `api-error ${r.status ?? ''} ${r.error}` : r.reason)
    }
    const { actions, rejected } = parseActions(r.text, live, userTextOf(rows), undefined, lang)
    const now = await $.clock.now()
    // Someone changed the files meanwhile: the numbers no longer match; distill the same stretch next time.
    const again = await ownFiles($, dir)
    if (again.length !== files.length || again.some((f, i) => f.file !== files[i]?.file || f.text !== files[i]?.text)) {
      return await fail(pick(lang, { en: 'the memory files were changed during the distill; the same stretch is distilled next time', 'zh-TW': '整理期間記憶檔被改過，下次重新整理同一段' }))
    }
    const taken = new Set((await $.fs.list(dir).catch(() => [])).map(entry => entry.name))
    const applied = applyActions(actions, live, day, sid, taken, lang)
    const merged = await mergeOver($, lang, joinLive(applied.notes, dead, day), store.activeDays, day, sid, taken)
    const changes = [...applied.changes, ...merged.changes]
    await saveNotes($, lang, dir, files, merged.notes)
    const progress = latestProgress(actions)
    if (progress !== undefined) await saveProgress($, root, renderProgress({ ...progress, session: sid, at: now }, localStamp(now), lang))
    const anchor = lastAnchor(rows)
    await $.store.set(markKey, { turn: turns, ...(anchor ? { anchor } : {}) } satisfies Mark)
    await $.store.set(lk, { at: now, why, changes, rejected } satisfies Last)
    $.ui.log(`project-memory: distill done (${why}): ${changes.length} change(s), ${rejected.count} line(s) dropped${progress ? ', progress updated' : ''}`, { to: 'debug' })
    if (changes.length > 0) {
      await update($, pending, p => ({ changes: [...(p?.changes ?? []), ...changes], dir }))
      $.ui.toast(pick(lang, { en: `project-memory: ${changes.length} change(s) to the memory (${dir})`, 'zh-TW': `project-memory：記憶有 ${changes.length} 項變動（${dir}）` }))
    }

    return statusLines(lang, changes, rejected, progress !== undefined, dir)
  } catch (error) {
    return await fail(String(error))
  } finally {
    running = false
  }
}

let expiry: Timer | undefined
let ticker: Timer | undefined

async function tick($: EngineInterface): Promise<void> {
  const at = await $.clock.now()
  await update($, now, () => at)
}

// Takes new settings: the idle timer and the band follow them, and the end of a feature switched
// on for a while reads them again.
async function settle($: EngineInterface, resolved: Resolved, options: PluginOptions, take: (config: Config) => void): Promise<void> {
  const config = configOf(resolved.values)
  take(config)
  if (!config.isDistillOn) {
    idle?.cancel()
    idle = undefined
  }
  await update($, onUntil, () => resolved.until)
  await tick($)
  const at = nextExpiry(resolved)
  const delay = at === undefined ? 0 : Math.max(0, at - (await $.clock.now()))
  // No await from here on: two settles at once must not leave a timer nobody can cancel.
  expiry?.cancel()
  ticker?.cancel()
  expiry = at === undefined ? undefined : $.clock.after(delay, () => void reload($, options, take).catch(() => undefined))
  ticker = at === undefined ? undefined : $.clock.every(TICK_MS, () => void tick($))
}

async function reload($: EngineInterface, options: PluginOptions, take: (config: Config) => void): Promise<void> {
  await settle($, await loadConfig(configIO($), COMMAND, SPECS, options), options, take)
}

// Idle long enough with enough new prompts: distill now, while the person is away.
let idle: Timer | undefined

async function onIdle($: EngineInterface, lang: Lang, idleMs: number): Promise<void> {
  idle = undefined
  if (running) return
  const mark = (await $.store.get(`distill:${await $.session.id()}`)) as Mark | undefined
  const turns = await $.session.turns()
  if (turns - (mark?.turn ?? 0) < END_MIN_TURNS || turns < retryAt) return
  await autoDistill($, lang, pick(lang, { en: `idle for ${idleMs / 60_000} minutes`, 'zh-TW': `閒置 ${idleMs / 60_000} 分鐘` }))
}

// A distill this mod starts on its own: the first one in a session says what it costs.
async function autoDistill($: EngineInterface, lang: Lang, why: string, snap?: Snapshot): Promise<string> {
  if (await firstUse(configIO($), 'distill')) {
    $.ui.toast(
      pick(lang, {
        en: `${COMMAND}: automatic distilling now sends new conversation to Sonnet (${why}); turn off: /${COMMAND} off`,
        'zh-TW': `${COMMAND}：自動整理開始把新增的對話送給 Sonnet（${why}）；關閉：/${COMMAND} off`,
      }),
    )
  }

  return distill($, lang, why, snap)
}

function statusLines(lang: Lang, changes: readonly string[], rejected: Rejected, isProgress: boolean, dir: string) {
  return [
    changes.length > 0 ? pick(lang, { en: `${changes.length} change(s) to the memory (${dir}):`, 'zh-TW': `記憶有 ${changes.length} 項變動（${dir}）：` }) : pick(lang, { en: 'No change to the memory.', 'zh-TW': '記憶沒有變動。' }),
    ...changes.map(c => `- ${c}`),
    ...(isProgress ? [pick(lang, { en: `Updated ${PROGRESS_FILE}.`, 'zh-TW': `已更新 ${PROGRESS_FILE}。` })] : []),
    ...(rejected.count > 0
      ? [pick(lang, { en: `Dropped ${rejected.count} invalid output line(s):`, 'zh-TW': `丟棄 ${rejected.count} 行無效輸出：` }), ...rejected.samples.map(s => `- ${s}`)]
      : []),
  ].join('\n')
}

async function statusText($: EngineInterface, config: Config): Promise<string> {
  const lang = config.lang
  const last = (await $.store.get(await lastKey($))) as Last | undefined
  const mark = (await $.store.get(`distill:${await $.session.id()}`)) as Mark | undefined
  const since = (await $.session.turns()) - (mark?.turn ?? 0)
  const store = await loadStore($)
  const dir = await memoryDir($)
  const notes = notesOf(await ownFiles($, dir), store)
  const { live, dead } = splitLive(notes)

  const idleText = config.idleMs > 0 ? pick(lang, { en: `idle for ${config.idleMs / 60_000} minutes or `, 'zh-TW': `閒置 ${config.idleMs / 60_000} 分鐘或 `}) : ''
  const enabled = pick(lang, {
    en: `on (every ${config.every} messages with context over ${config.minTokens / 1000}k; ${idleText}${END_MIN_TURNS}+ messages at /clear; ${since} since the last)`,
    'zh-TW': `開（每 ${config.every} 則且 context ${config.minTokens / 1000}k 以上；${idleText}/clear 時有 ${END_MIN_TURNS} 則以上；距上次 ${since} 則）`,
  })
  const counts = pick(lang, {
    en: `${live.memory.length} memories, ${live.rules.filter(r => r.file !== undefined).length} rules, ${notes.procedures.length} procedures, ${dead.memory.length + dead.rules.length} invalidated; MEMORY.md lists ${Math.min(INDEX_CAP, listed(notes, store.activeDays).length)}/${INDEX_CAP} (${dir})`,
    'zh-TW': `記憶 ${live.memory.length} 條、規則 ${live.rules.filter(r => r.file !== undefined).length} 條、流程 ${notes.procedures.length} 個、失效 ${dead.memory.length + dead.rules.length} 條；MEMORY.md 列出 ${Math.min(INDEX_CAP, listed(notes, store.activeDays).length)}／${INDEX_CAP} 條（${dir}）`,
  })

  return [
    pick(lang, { en: `Automatic distill: ${config.isDistillOn ? enabled : 'off'}`, 'zh-TW': `自動整理：${config.isDistillOn ? enabled : '關'}` }),
    counts,
    last === undefined
      ? pick(lang, { en: 'Not distilled yet.', 'zh-TW': '還沒整理過。' })
      : pick(lang, {
          en: `Last distill: ${localStamp(last.at)} (${last.why})${last.error ? ` failed: ${last.error}` : `, ${last.changes.length} change(s)`}`,
          'zh-TW': `上次整理：${localStamp(last.at)}（${last.why}）${last.error ? `失敗：${last.error}` : `，${last.changes.length} 項變動`}`,
        }),
  ].join('\n')
}

export const SPECS: Specs = {
  distill: {
    category: 'cost',
    type: 'boolean',
    default: false,
    repo: 'only-false',
    toggle: { on: true, off: false },
    description: {
      en: 'Distill memory and progress with Sonnet every so many messages, when idle, or at /clear',
      'zh-TW': '每隔一定則數、閒置或 /clear 時用 Sonnet 整理記憶與進度',
    },
  },
  distill_every: {
    category: 'cost',
    type: 'number',
    default: 30,
    repo: 'only-higher',
    min: 5,
    max: 200,
    description: { en: 'Distill when this many user messages have come since the last distill', 'zh-TW': '距離上次整理的使用者訊息達到這個數量時整理' },
  },
  min_context_k: {
    category: 'cost',
    type: 'number',
    default: 30,
    repo: 'only-higher',
    min: 0,
    max: 1000,
    description: { en: 'Below this many k of context, skip the every-N-messages distill', 'zh-TW': 'context 少於幾 k 不做「每幾則」的整理' },
  },
  idle_minutes: {
    category: 'cost',
    type: 'number',
    default: 10,
    repo: 'never',
    min: 0,
    max: 120,
    description: {
      en: 'Minutes of idling after the last answer before a distill; 0 means no distill when idle',
      'zh-TW': '最後一次回答後閒置幾分鐘整理一次；0 表示閒置時不整理',
    },
  },
  promote: {
    category: 'plain',
    type: 'boolean',
    default: true,
    repo: 'any',
    description: {
      en: 'A rule confirmed in 3 sessions is proposed to you before it goes into CLAUDE.md; a procedure becomes a project skill',
      'zh-TW': '被 3 個 session 證實的規則先問你再寫進 CLAUDE.md，流程做成專案 skill',
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

function usage(lang: Lang): string {
  return [
    pick(lang, {
      en: `Usage: /${COMMAND} run (distill), /${COMMAND} status, /${COMMAND} set <key> <value> [--session|--local|--repo], /${COMMAND} unset <key>`,
      'zh-TW': `用法：/${COMMAND} run（整理）、/${COMMAND} status、/${COMMAND} set <key> <value> [--session|--local|--repo]、/${COMMAND} unset <key>`,
    }),
    pick(lang, {
      en: `Automatic distill: /${COMMAND} on [duration, default 2h] turns it on for a while, /${COMMAND} off turns it off`,
      'zh-TW': `自動整理：/${COMMAND} on [時長，預設 2h] 臨時開啟、/${COMMAND} off 關閉`,
    }),
  ].join('\n')
}

export const register: Register = (on, options) => {
  // Re-read at session start, after `/project-memory set|on|off` and when a feature switched on for
  // a while runs out; `/config` changes reload the module.
  let config = configOf(resolve(SPECS, { options, user: {}, repo: {}, local: {}, session: {} }).values)
  const take = (next: Config) => {
    config = next
  }
  on('session.start', async ($, e, next) => {
    try {
      await reload($, options, take)
    } catch (error) {
      $.ui.log(`session.start: settings not read: ${String(error)}`, { to: 'debug' })
    }
    try {
      await $.command.register({
        name: COMMAND,
        description: pick(config.lang, { en: 'Distill this conversation into project memory and progress (run), or view and change settings', 'zh-TW': '整理這段對話的專案記憶與進度（run），或看、改設定' }),
        argumentHint: pick(config.lang, {
          en: 'run | on [duration] | off | status | set <key> <value> | unset <key>',
          'zh-TW': 'run | on [時長] | off | status | set <key> <value> | unset <key>',
        }),
      })
    } catch (error) {
      $.ui.log(`session.start: /${COMMAND} not registered: ${String(error)}`, { to: 'debug' })
      $.ui.toast(pick(config.lang, { en: `${COMMAND}: /${COMMAND} was not registered (${String(error)})`, 'zh-TW': `${COMMAND}：/${COMMAND} 指令沒有註冊成功（${String(error)}）` }))
    }
    if (config.isPromoteOn) {
      await $.tool.register({ name: PROMOTE_TOOL, description: PROMOTE_DESCRIPTION, inputSchema: PROMOTE_SCHEMA })
    }
    await noteActiveDay($).catch(() => undefined)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => {
    const sub = e.args.trim().split(/\s+/)[0] ?? ''
    if (sub === 'run') {
      return { text: `${await distill($, config.lang, pick(config.lang, { en: 'manual', 'zh-TW': '手動' }))}\n\n${await statusText($, config)}` }
    }
    const text = await configCommand(configIO($), COMMAND, SPECS, options, e.args, resolved => void settle($, resolved, options, take).catch(error => $.ui.log(`settle: ${String(error)}`, { to: 'debug' })))
    if (text === undefined) {
      return { text: usage(config.lang) }
    }

    return { text: sub === 'status' ? `${await statusText($, config)}\n\n${text}` : text }
  })

  // Every N prompts of the person, once the context is large enough to be worth it; and an idle
  // timer from each answer. The distill runs on a timer of its own, so the turn's dispatch is not held.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    try {
      if (!config.isDistillOn || e.agentId !== undefined || e.reason !== 'answer') return result
      idle?.cancel()
      idle = config.idleMs > 0 ? $.clock.after(config.idleMs, () => void onIdle($, config.lang, config.idleMs)) : undefined
      if (running) return result
      const mark = (await $.store.get(`distill:${await $.session.id()}`)) as Mark | undefined
      const turns = await $.session.turns()
      if (turns - (mark?.turn ?? 0) < config.every || turns < retryAt) return result
      if (((await $.session.usage()).context.tokens ?? 0) < config.minTokens) return result
      $.clock.after(0, () => void autoDistill($, config.lang, pick(config.lang, { en: `every ${config.every} messages`, 'zh-TW': `每 ${config.every} 則` })))
    } catch (error) {
      $.ui.log(`project-memory: turn.complete: ${String(error)}`, { to: 'debug' })
    }

    return result
  }).catch(($, e, next) => next(e))

  // A /clear ends the conversation while the process goes on: take it now (the hook has about
  // 1.5 s) and distill it after. An exit leaves no time for that; the idle timer covers most of it.
  on('session.end', async ($, e, next) => {
    idle?.cancel()
    idle = undefined
    expiry?.cancel()
    ticker?.cancel()
    await update($, onUntil, () => ({})).catch(() => undefined)
    try {
      if (config.isDistillOn && e.reason === 'clear' && !running) {
        const mark = (await $.store.get(`distill:${e.sessionId}`)) as Mark | undefined
        const turns = await $.session.turns()
        if (turns - (mark?.turn ?? 0) >= END_MIN_TURNS) {
          const snap: Snapshot = { sid: e.sessionId, turns, rows: (await $.session.messages()) as readonly Row[] }
          $.clock.after(0, () => void autoDistill($, config.lang, '/clear', snap))
        }
      }
    } catch (error) {
      $.ui.log(`project-memory: session.end: ${String(error)}`, { to: 'debug' })
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // The person's next prompt carries the latest changes, and once per session the rules and
  // procedures due to go into the repository. State changes only once the prompt went in.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e)
    idle?.cancel()
    idle = undefined
    const context: string[] = []
    const queued = await read($, pending)
    if (queued !== null && queued.changes.length > 0) context.push(changesNote(queued.changes, queued.dir))
    const now = await $.clock.now()
    let due: ReturnType<typeof promoteItems> = []
    if (config.isPromoteOn && !(await read($, promoted))) {
      const store = await loadStore($)
      due = promoteItems(notesOf(await ownFiles($, await memoryDir($)), store), store.asked, now)
      if (due.length > 0) context.push(promoteText(due, TOOL, config.lang))
    }
    const submitted = await (context.length === 0 ? next(e) : next({ ...e, context: [...(e.context ?? []), ...context] }))
    if (submitted.drop !== undefined) return submitted
    try {
      if (queued !== null) await update($, pending, () => null)
      if (config.isPromoteOn) await update($, promoted, () => true)
      if (due.length > 0) {
        const fresh = await loadStore($)
        await $.store.set(await repoKey($), { ...fresh, asked: markAsked(fresh.asked, due, now) })
      }
      await noteActiveDay($)
    } catch (error) {
      $.ui.log(`project-memory: prompt.submit after next: ${String(error)}`, { to: 'debug' })
    }

    return submitted
  }).catch(($, e, next) => next(e))

  // While the distill is on for a while, one dim line with the time left; the bands beneath under it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const line = onLine(COMMAND, await read($, onUntil), Math.max(await read($, now), await $.clock.now()))
    if (e.props.hasSurvey || line === '') {
      return next(e)
    }
    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">
          {line}
        </Text>
        {below}
      </Box>
    )
  })

  // Claude reports where it put a rule or procedure: record it, and drop the rule's own memory file.
  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as { items?: unknown }
    const dir = await memoryDir($)
    const files = await ownFiles($, dir)
    const store = await loadStore($)
    const notes = notesOf(files, store)
    const { placed, failed } = readReport(input.items, notes, config.lang)
    if (placed.length > 0) {
      const asked = { ...store.asked }
      for (const p of placed) delete asked[`${p.kind === 'rule' ? 'r' : 'p'}:${p.name}`]
      await saveNotes($, config.lang, dir, files, applyPlaced(notes, placed), asked)
    }

    return { result: promoteReport(placed, failed) }
  }).catch(($, e, next) => next(e))
}
