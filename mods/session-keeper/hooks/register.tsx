import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelForkResult, PluginOptions, Register, Timer } from 'claude-code'

import type { HandoffKind, Offer } from '../types'
import { configCommand, firstUse, LANGUAGE, loadConfig, nextExpiry, onLine, pick, resolve, type ConfigIO, type Lang, type Resolved, type Specs } from './config'
import {
  GATE_LOG_KEEP,
  GATE_SYSTEM,
  PROGRESS_FILE,
  QUIET_TOKENS,
  gateEntry,
  gateFloor,
  gatePrompt,
  gateStats,
  handoffConfig,
  handoffDraft,
  handoffPrompt,
  isColdAndLarge,
  parseProgress,
  parseVerdict,
  progressNote,
  progressTask,
  renderHandoff,
  thresholdOf,
  withExclude,
  withOffered,
} from './handoff'
import type { GateChoice, GateEntry, HandoffConfig, Offered } from './handoff'
import { KEEP_PROMPT, keepConfig, keepDueAt, skipReason } from './keep'
import type { KeepConfig } from './keep'
import { EMPTY, fmtTokens, record, segments, toolsKey, ttlFromTranscript } from './meter'

const meter = atom({ plugin: 'session-keeper', key: 'meter' } as const, EMPTY)
const now = atom({ plugin: 'session-keeper', key: 'now' } as const, 0)
const offer = atom({ plugin: 'session-keeper', key: 'offer' } as const, null)
const handing = atom({ plugin: 'session-keeper', key: 'handing' } as const, null)
const away = atom({ plugin: 'session-keeper', key: 'away' } as const, null)
const quiet = atom({ plugin: 'session-keeper', key: 'quiet' } as const, { sessionId: '', tokens: 0 })
const onUntil = atom({ plugin: 'session-keeper', key: 'onUntil' } as const, {})

// A handoff summary over a large context takes a while; past this the handoff gives up.
const HANDOFF_TIMEOUT_MS = 3 * 60_000

// One command per mod (`/<mod> <sub>`): a bare `/handoff` collides with the person's own commands and skills.
const COMMAND = 'session-keeper'

function usage(lang: Lang): string {
  return [
    pick(lang, {
      en: `Usage: /${COMMAND} handoff [goal], /${COMMAND} stats [days], /${COMMAND} status, /${COMMAND} set <key> <value>`,
      'zh-TW': `用法：/${COMMAND} handoff [目標]、/${COMMAND} stats [天數]、/${COMMAND} status、/${COMMAND} set <key> <value>`,
    }),
    pick(lang, {
      en: `Features that use the model: /${COMMAND} on <keep_warm|away_handoff|handoff_gate> [duration, default 2h], /${COMMAND} off <feature>`,
      'zh-TW': `用模型的功能：/${COMMAND} on <keep_warm|away_handoff|handoff_gate> [時長，預設 2h]、/${COMMAND} off <功能>`,
    }),
  ].join('\n')
}

const GATE_MODEL = 'haiku'
const GATE_TIMEOUT_MS = 8_000
const GATE_LOG_KEY = 'gate-log'

// Redraws the countdown while idle.
const TICK_MS = 15_000
// The TTL can change mid-session (usage overage drops it to 5m), so the transcript is read again after this long.
const TTL_RECHECK_MS = 10 * 60_000
const TONE_COLOR = { warn: 'yellow', hot: 'red' } as const
// Columns between the parts of the line.
const GAP = 2

async function tick($: EngineInterface): Promise<void> {
  const at = await $.clock.now()
  await update($, now, () => at)
}

// The keep timer lives in the module; its due time is derived from the meter in $.state,
// so a reload re-arms it from there.
type Keeper = {
  config: KeepConfig
  handoff: HandoffConfig
  lang: Lang
  timer: Timer | undefined
  // Runs out with the first feature switched on for a while.
  expiry: Timer | undefined
  apply: (resolved: Resolved) => void
  options: PluginOptions
}

// Takes new settings: the timers follow them, and the band counts down what is on for a while.
async function settle($: EngineInterface, keeper: Keeper, resolved: Resolved): Promise<void> {
  keeper.apply(resolved)
  await update($, onUntil, () => resolved.until)
  const at = nextExpiry(resolved)
  const delay = at === undefined ? 0 : Math.max(0, at - (await $.clock.now()))
  // No await between the cancel and the new timer: two settles at once must not leave one behind.
  keeper.expiry?.cancel()
  keeper.expiry = at === undefined ? undefined : $.clock.after(delay, () => void reload($, keeper).catch(() => undefined))
  await arm($, keeper)
}

async function reload($: EngineInterface, keeper: Keeper): Promise<void> {
  await settle($, keeper, await loadConfig(configIO($), COMMAND, SPECS, keeper.options))
}

// What each feature that uses a model does, for the toast the first time it does it in a session.
const NOTICE: Readonly<Record<string, { en: string; 'zh-TW': string }>> = {
  keep_warm: {
    en: 'keep-warm starts sending forks (main conversation model, each reads the whole cache once)',
    'zh-TW': '保持快取開始送 fork（主對話模型，每次讀一次整段快取）',
  },
  away_handoff: {
    en: 'the handoff offer on an expired cache is now active (the summary is written by a fork of the main conversation model)',
    'zh-TW': '快取過期提議交接開始作用（交接摘要由主對話模型 fork 寫）',
  },
  handoff_gate: {
    en: 'the new-task check now sends the prompt and the recent conversation to Haiku',
    'zh-TW': '新任務判斷開始把 prompt 與最近的對話送給 Haiku',
  },
}

// A notice that fails must not stop the feature's own work.
async function notice($: EngineInterface, lang: Lang, key: string): Promise<void> {
  try {
    if (await firstUse(configIO($), key)) {
      const what = NOTICE[key] === undefined ? key : pick(lang, NOTICE[key])
      $.ui.toast(pick(lang, { en: `session-keeper: ${what}; turn off: /${COMMAND} off ${key}`, 'zh-TW': `session-keeper：${what}；關閉：/${COMMAND} off ${key}` }))
    }
  } catch (error) {
    $.ui.log(`notice ${key}: ${String(error)}`, { to: 'debug' })
  }
}

async function arm($: EngineInterface, keeper: Keeper): Promise<void> {
  keeper.timer?.cancel()
  keeper.timer = undefined
  const due = keepDueAt(await read($, meter), keeper.config)
  if (due === null) {
    return
  }
  const delay = Math.max(0, due - (await $.clock.now()))
  keeper.timer = $.clock.after(delay, () => void keepWarm($, keeper))
}

// One tool-less fork over the main thread's transcript reads its cached prefix, which renews the entry.
// The last keep of an idle stretch writes the handoff summary instead: it reads the same warm
// cache, so a person coming back to a cold cache can hand off without re-writing it.
async function keepWarm($: EngineInterface, keeper: Keeper): Promise<void> {
  keeper.timer = undefined
  try {
    const before = await read($, meter)
    const sessionId = await $.session.id()
    const reason = skipReason(before, sessionId, await $.clock.now(), keeper.config)
    if (reason !== undefined) {
      $.ui.log(`keep warm skipped: ${reason}`, { to: 'debug' })

      return
    }
    const isLast = before.keeps + 1 >= keeper.config.maxKeeps
    const threshold = thresholdOf(await $.env.get('CLAUDE_CTX_GUARD_TOKENS'))
    const isSummary = isLast && keeper.handoff.isAwayOn && before.lastInput >= threshold
    await notice($, keeper.lang, isSummary ? 'away_handoff' : 'keep_warm')
    const result = await $.model.fork({ prompt: isSummary ? handoffPrompt('away', false, keeper.lang) : KEEP_PROMPT })
    const at = await $.clock.now()
    const keeps = before.keeps + 1
    // A request of the main thread in the meantime renewed the cache itself and reset the count.
    await update($, meter, m =>
      m.lastAt !== before.lastAt
        ? m
        : { ...m, keeps, ...(result.isAnswered ? { lastAt: at } : {}) },
    )
    await update($, now, () => at)
    const count = `${keeps}/${keeper.config.maxKeeps}`
    if (!result.isAnswered) {
      // Not re-armed: by the next due time the entry has lapsed anyway.
      $.ui.log(`keep warm ${count} failed: ${result.reason}`, { to: 'debug' })

      return
    }
    if (isSummary) {
      const after = await read($, meter)
      if (after.lastAt === at) {
        await update($, away, () => ({ sessionId, lastAt: at, text: result.text }))
      }
    }
    const { cache_read_input_tokens: hit, cache_creation_input_tokens: wrote } = result.usage
    const what = isSummary ? ', wrote the handoff summary' : ''
    $.ui.log(`keep warm ${count}: read ${fmtTokens(hit)}, wrote ${fmtTokens(wrote)}${what}`, { to: 'debug' })
    await arm($, keeper)
  } catch (error) {
    $.ui.log(`keep warm: ${String(error)}`, { to: 'debug' })
  }
}

// ---------- handoff ----------

const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

// Local "YYYY-MM-DD HH:mm".
function localStamp(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)

  return d.toISOString().slice(0, 16).replace('T', ' ')
}

// The main working tree's root, so worktrees share the progress file (as project-memory does).
async function workspace($: EngineInterface): Promise<string> {
  return slash((await $.session.repo())?.root ?? (await $.session.root()))
}

async function readText($: EngineInterface, path: string): Promise<string> {
  try {
    return await $.fs.read(path)
  } catch {
    return ''
  }
}

const offeredKey = (root: string) => `offered:${root}`

async function threshold($: EngineInterface): Promise<number> {
  return thresholdOf(await $.env.get('CLAUDE_CTX_GUARD_TOKENS'))
}

async function forkWithin($: EngineInterface, prompt: string, ms: number): Promise<ModelForkResult | undefined> {
  return new Promise(resolve => {
    const timer = $.clock.after(ms, () => resolve(undefined))
    $.model.fork({ prompt }).then(
      result => {
        timer.cancel()
        resolve(result)
      },
      () => {
        timer.cancel()
        resolve(undefined)
      },
    )
  })
}

async function logGate($: EngineInterface, entry: GateEntry): Promise<void> {
  const log = ((await $.store.get(GATE_LOG_KEY)) as GateEntry[] | undefined) ?? []
  await $.store.set(GATE_LOG_KEY, [...log, entry].slice(-GATE_LOG_KEEP))
}

// Writes the person's choice on the latest offered verdict of this prompt.
async function chooseGate($: EngineInterface, at: number, choice: GateChoice): Promise<void> {
  const log = ((await $.store.get(GATE_LOG_KEY)) as GateEntry[] | undefined) ?? []
  const i = log.findLastIndex(entry => entry.at === at && entry.verdict === 'new')
  if (i < 0) {
    return
  }
  await $.store.set(GATE_LOG_KEY, log.map((entry, j) => (j === i ? { ...entry, choice } : entry)))
}

// No new-task offer until the context grows past this one by QUIET_TOKENS.
async function quietDown($: EngineInterface, context: number): Promise<void> {
  const sessionId = await $.session.id()
  await update($, quiet, () => ({ sessionId, tokens: context + QUIET_TOKENS }))
}

// Asks the small model whether the prompt starts unrelated work; undefined when it cannot tell.
async function judge($: EngineInterface, lang: Lang, text: string): Promise<'new' | 'related' | undefined> {
  await notice($, lang, 'handoff_gate')
  const root = await workspace($)
  const parsed = parseProgress(await readText($, `${root}/${PROGRESS_FILE}`))
  const messages = (await $.session.messages()).slice(-40)
  const result = await $.model.complete({
    model: GATE_MODEL,
    effort: 'low',
    maxTokens: 8,
    timeoutMs: GATE_TIMEOUT_MS,
    system: GATE_SYSTEM,
    prompt: gatePrompt(text, messages, parsed === undefined ? undefined : progressTask(parsed.body)),
  })
  if (!result.isAnswered) {
    $.ui.log(`new-task gate: no verdict (${result.reason})`, { to: 'debug' })

    return undefined
  }

  return parseVerdict(result.text)
}

// Suggest mode: the prompt went in already; a "new" verdict puts the offer above the prompt.
async function suggest($: EngineInterface, lang: Lang, text: string, context: number, config: HandoffConfig): Promise<void> {
  try {
    const verdict = await judge($, lang, text)
    if (verdict === undefined) {
      return
    }
    const at = await $.clock.now()
    await logGate($, gateEntry(at, context, config.gate, verdict, text))
    $.ui.log(`new-task gate: ${verdict} at ${fmtTokens(context)}`, { to: 'debug' })
    if (verdict === 'new' && (await read($, handing)) === null) {
      await update($, offer, () => ({ kind: 'new-task', prompt: text, isHeld: false, context, at }))
    }
  } catch (error) {
    $.ui.log(`new-task gate: ${String(error)}`, { to: 'debug' })
  }
}

async function writeProgress($: EngineInterface, lang: Lang, summary: string, sessionId: string): Promise<number> {
  const root = await workspace($)
  const at = await $.clock.now()
  await $.fs.write(`${root}/${PROGRESS_FILE}`, renderHandoff(summary, sessionId, at, localStamp(at), lang))
  if ((await $.fs.stat(`${root}/.git`).catch(() => undefined))?.kind === 'dir') {
    const exclude = `${root}/.git/info/exclude`
    const added = withExclude(await readText($, exclude))
    if (added !== undefined) {
      await $.fs.write(exclude, added)
    }
  }

  return at
}

// Hands the work to a new session: summary into the progress file, `/clear`, then the draft in
// the prompt box for the person to review. Prompts typed meanwhile go into the draft.
// `isHeld`: the prompt never entered this session (block mode, cold cache); else it did and its
// answer, if still running, is stopped.
async function handOff(
  $: EngineInterface,
  lang: Lang,
  kind: HandoffKind,
  prompt: string,
  isHeld: boolean,
  turn: { id: string | undefined },
): Promise<void> {
  if ((await read($, handing)) !== null) {
    return
  }
  const startedAt = await $.clock.now()
  await update($, handing, () => ({ kind, startedAt, held: [] }))
  await update($, offer, () => null)
  let held: string[] = []
  // The prompt when it is not in this session (held, or its answer stopped): a failure gives it back.
  let giveBack = isHeld ? prompt : ''
  try {
    // The offer came while the answer to the new prompt still ran: stop it, it belongs to the new session.
    if (!isHeld && turn.id !== undefined) {
      await $.turn.abort({ turnId: turn.id })
      giveBack = prompt
    }
    const sessionId = await $.session.id()
    const m = await read($, meter)
    const saved = await read($, away)
    let summary = kind === 'away' && saved?.sessionId === sessionId && saved.lastAt === m.lastAt ? saved.text : undefined
    if (summary === undefined) {
      const result = await forkWithin($, handoffPrompt(kind, !isHeld, lang), HANDOFF_TIMEOUT_MS)
      if (result === undefined || !result.isAnswered) {
        const reason = result === undefined ? 'timeout' : result.reason
        $.ui.log(`handoff: no summary (${reason})`, { to: 'debug' })
        $.ui.toast(
          pick(lang, {
            en: `Handoff failed: no summary was produced (${reason}); staying in this session`,
            'zh-TW': `交接失敗：沒有產生摘要（${reason}），仍在這個 session`,
          }),
        )
        held = (await read($, handing))?.held ?? []
        await restoreBox($, giveBack, held)

        return
      }
      summary = result.text
    }
    const updated = await writeProgress($, lang, summary, sessionId)
    held = (await read($, handing))?.held ?? []
    await $.command.run({ command: 'clear', args: '' })
    // Prompts typed while /clear ran.
    held = [...held, ...((await read($, handing))?.held ?? []).filter(text => !held.includes(text))]
    const root = await workspace($)
    const fresh = await $.session.id()
    // The new session has the work in its draft (or chose other work): no progress note for it.
    await $.store.set(offeredKey(root), withOffered((await $.store.get(offeredKey(root))) as Offered | undefined, updated, fresh))
    const draft = handoffDraft(kind, summary, prompt, held, lang)
    const filled = await $.prompt.fill({ text: draft })
    $.ui.log(`handoff (${kind}): ${filled.isFilled ? 'draft filled' : `draft not filled (${filled.refusal ?? 'unknown'})`}`, { to: 'debug' })
    if (!filled.isFilled) {
      $.ui.toast(
        pick(lang, {
          en: `The handoff summary is in ${PROGRESS_FILE}; it could not be put in the prompt box`,
          'zh-TW': `交接摘要在 ${PROGRESS_FILE}，沒能放進輸入框`,
        }),
      )
    }
  } catch (error) {
    $.ui.log(`handoff: ${String(error)}`, { to: 'debug' })
    $.ui.toast(pick(lang, { en: 'Handoff failed; see the debug log', 'zh-TW': '交接失敗，見 debug log' }))
    await restoreBox($, giveBack, held.length > 0 ? held : ((await read($, handing))?.held ?? []))
  } finally {
    await update($, handing, () => null)
  }
}

// Gives back what a failed handoff held: the box gets the prompts, not lost.
async function restoreBox($: EngineInterface, prompt: string, held: readonly string[]): Promise<void> {
  const text = [prompt, ...held].filter(s => s.trim() !== '').join('\n\n')
  if (text !== '') {
    await $.prompt.fill({ text, mode: 'append' })
  }
}

// "Keep working here": a held prompt is sent now, as the person's own.
async function stay($: EngineInterface, current: Offer): Promise<void> {
  await update($, offer, () => null)
  if (current.kind === 'new-task') {
    await chooseGate($, current.at, 'stay')
    await quietDown($, current.context)
  }
  if (current.isHeld) {
    await $.prompt.submit({ text: current.prompt, asUser: true })
  }
}

export const SPECS: Specs = {
  keep_warm: {
    category: 'cost',
    type: 'boolean',
    default: false,
    repo: 'only-false',
    toggle: { on: true, off: false },
    description: {
      en: 'With a 1h cache and context over 30k, send a fork that only replies OK after idling, so the cache does not expire',
      'zh-TW': '1h 快取、context 超過 30k 時，閒置後送一次只回覆 OK 的 fork 讓快取不過期',
    },
  },
  idle_minutes: {
    category: 'cost',
    type: 'number',
    default: 55,
    repo: 'only-higher',
    min: 5,
    max: 59,
    description: { en: 'Minutes of idling after the cache was last used before a keep-warm is sent', 'zh-TW': '最後一次用到快取後閒置幾分鐘送出保持快取' },
  },
  max_keeps: {
    category: 'cost',
    type: 'number',
    default: 3,
    repo: 'only-lower',
    min: 1,
    max: 10,
    description: { en: 'Most keep-warms in one idle stretch', 'zh-TW': '同一段閒置最多保持幾次' },
  },
  handoff_gate: {
    category: 'cost',
    type: 'string',
    default: 'off',
    repo: 'never',
    choices: ['suggest', 'block', 'off'],
    toggle: { on: 'suggest', off: 'off' },
    description: {
      en: 'When context passes the threshold, Haiku judges whether a prompt is a new task: suggest only offers, block holds the prompt first, off does not judge',
      'zh-TW': 'context 超過門檻時用 Haiku 判斷新任務：suggest 只提議、block 先攔下、off 不判斷',
    },
  },
  away_handoff: {
    category: 'cost',
    type: 'boolean',
    default: false,
    repo: 'only-false',
    toggle: { on: true, off: false },
    description: {
      en: 'When the cache has expired and context is large, hold the prompt and offer a handoff; with a 1h TTL the last keep-warm writes the handoff summary instead',
      'zh-TW': '快取過期且 context 大時先攔下 prompt 提議交接；1h TTL 時最後一次保持快取改寫交接摘要',
    },
  },
  progress_resume: {
    category: 'plain',
    type: 'boolean',
    default: true,
    repo: 'any',
    description: {
      en: 'Attach a progress file under 24 hours old to the first prompt of a new session',
      'zh-TW': '新 session 的第一則 prompt 附上 24 小時內的進度檔',
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

export const register: Register = (on, options) => {
  // Re-read at session start, after `/session-keeper set|on|off` and when a feature switched on for
  // a while runs out; `/config` changes reload the module.
  const apply = (resolved: Resolved) => {
    keeper.config = keepConfig(resolved.values)
    keeper.handoff = handoffConfig(resolved.values)
    keeper.lang = resolved.lang
  }
  const keeper: Keeper = { config: keepConfig({}), handoff: handoffConfig({}), lang: 'en', timer: undefined, expiry: undefined, apply: () => undefined, options }
  apply(resolve(SPECS, { options, user: {}, repo: {}, local: {}, session: {} }))
  keeper.apply = apply
  keeper.options = options
  // The main thread's running turn, which a handoff from a suggest-mode offer stops.
  const turn: { id: string | undefined } = { id: undefined }
  // Sessions whose first prompt was checked for a progress note.
  const resumed = new Set<string>()

  on('session.start', async ($, e, next) => {
    $.clock.every(TICK_MS, () => void tick($))
    // A reload drops the module's timers: pick the idle stretch and the features on for a while up where they were.
    try {
      await reload($, keeper)
    } catch (error) {
      $.ui.log(`session.start: settings not read: ${String(error)}`, { to: 'debug' })
    }
    const lang = keeper.lang
    try {
      await $.command.register({
        name: COMMAND,
        description: pick(lang, {
          en: 'Hand off to a new session (the summary goes into the progress file, then /clear and the prompt box), or see the new-task check statistics',
          'zh-TW': '交接到新 session（摘要寫進進度檔，/clear 後放進輸入框），或看新任務判斷的統計',
        }),
        argumentHint: pick(lang, {
          en: 'handoff [goal] | stats [days] | on|off <feature> [duration] | status | set <key> <value> | unset <key>',
          'zh-TW': 'handoff [目標] | stats [天數] | on|off <功能> [時長] | status | set <key> <value> | unset <key>',
        }),
      })
    } catch (error) {
      // Another command of the same name wins; say so once, or the command just goes missing.
      $.ui.log(`session.start: /${COMMAND} not registered: ${String(error)}`, { to: 'debug' })
      $.ui.toast(pick(lang, { en: `session-keeper: /${COMMAND} was not registered (${String(error)})`, 'zh-TW': `session-keeper：/${COMMAND} 指令沒有註冊成功（${String(error)}）` }))
    }
    try {
      await arm($, keeper)
    } catch (error) {
      $.ui.log(`session.start: ${String(error)}`, { to: 'debug' })
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    keeper.timer?.cancel()
    keeper.timer = undefined
    keeper.expiry?.cancel()
    keeper.expiry = undefined
    await update($, onUntil, () => ({}))
    // An offer and a summary belong to the conversation that ended; a handoff's own /clear keeps its state.
    if ((await read($, handing)) === null) {
      await update($, offer, () => null)
      await update($, away, () => null)
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const usage = result.usage
    if (e.agentId !== undefined || usage === null) {
      return result
    }
    try {
      const sessionId = await $.session.id()
      const tools = await $.tool.list()
      const at = await $.clock.now()
      await update($, meter, current =>
        record(current.sessionId === sessionId ? current : { ...EMPTY, sessionId }, {
          at,
          model: usage.model,
          toolsKey: toolsKey(tools.map(tool => tool.name)),
          input: usage.input_tokens,
          output: usage.output_tokens,
          read: usage.cache_read_input_tokens,
          write: usage.cache_creation_input_tokens,
        }),
      )
      await update($, now, () => at)
      await arm($, keeper)
    } catch (error) {
      $.ui.log(`turn.step: ${String(error)}`, { to: 'debug' })
    }

    return result
  })


  on('turn.start', async ($, e, next) => {
    turn.id = e.turnId

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    turn.id = undefined

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const args = e.args.trim()
    const sub = args.split(/\s+/)[0] ?? ''
    const rest = args.slice(sub.length).trim()
    if (sub === 'stats') {
      const days = Math.max(1, Math.round(Number(rest) || 30))
      const log = ((await $.store.get(GATE_LOG_KEY)) as GateEntry[] | undefined) ?? []

      return { text: gateStats(log, await $.clock.now(), days, keeper.lang) }
    }
    if (sub !== 'handoff') {
      const text = await configCommand(configIO($), COMMAND, SPECS, options, args, resolved => void settle($, keeper, resolved).catch(error => $.ui.log(`settle: ${String(error)}`, { to: 'debug' })))

      return { text: text ?? usage(keeper.lang) }
    }
    if ((await read($, handing)) !== null) {
      return { text: pick(keeper.lang, { en: 'A handoff is already in progress', 'zh-TW': '交接已在進行中' }) }
    }
    // Not awaited: /clear waits for the session to be idle, which this command holds up.
    void handOff($, keeper.lang, 'manual', rest, true, { id: undefined })

    return {
      text: pick(keeper.lang, {
        en: "Handing off: once the summary is written it runs /clear and puts the summary in the new session's prompt box",
        'zh-TW': '交接中：產生摘要後會 /clear，並把摘要放進新 session 的輸入框',
      }),
    }
  })

  // Order-independent: the state is only read before `next`, and changed once the prompt went in.
  // A held prompt (block mode, cold cache) is answered here without `next`, which drops it.
  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (!isPerson) {
      return next(e)
    }
    const isSlash = e.text.trimStart().startsWith('/')
    const hasAttachments = (e.attachments?.length ?? 0) > 0
    const current = await read($, handing)
    if (current !== null && !isSlash) {
      if (e.text.trim() === '') {
        return {
          drop: pick(keeper.lang, {
            en: 'Handing off; attachments cannot go into the new session. Paste it again after the handoff.',
            'zh-TW': '交接中，附件帶不進新 session；交接完成後再貼一次',
          }),
        }
      }
      if (!current.held.some(text => text.trim() === e.text.trim())) {
        await update($, handing, h => (h === null ? h : { ...h, held: [...h.held, e.text] }))
      }

      return {
        drop: pick(keeper.lang, {
          en: "Handing off; this message is held and goes into the new session's prompt box with the rest.",
          'zh-TW': '交接中，這則先攔下，會一起放進新 session 的輸入框',
        }),
      }
    }
    if (isSlash || e.text.trim() === '') {
      return next(e)
    }

    let pending: Offer | null = null
    let submitted = e
    let context = 0
    let isGated = false
    let note: { text: string; root: string; updated: number } | undefined
    try {
      pending = await read($, offer)
      const sessionId = await $.session.id()
      const m = await read($, meter)
      const at = await $.clock.now()
      const limit = await threshold($)
      context = m.sessionId === sessionId ? m.lastInput : 0
      // A held offer answered by typing on: the person keeps working here, with both prompts.
      if (pending?.isHeld) {
        submitted = { ...e, text: `${pending.prompt}\n\n${e.text}` }
      } else if (keeper.handoff.isAwayOn && !hasAttachments && isColdAndLarge(m, sessionId, at, limit)) {
        await update($, offer, () => ({ kind: 'away', prompt: e.text, isHeld: true, context, at }))
        await notice($, keeper.lang, 'away_handoff')

        return {
          drop: pick(keeper.lang, {
            en: `The cache has expired; continuing rewrites ${fmtTokens(m.nextTokens)}. Choose to hand off or stay above the prompt box.`,
            'zh-TW': `快取已過期，繼續要重寫 ${fmtTokens(m.nextTokens)}；在輸入框上方選擇交接或留下`,
          }),
        }
      } else if (keeper.handoff.gate === 'block' && !hasAttachments && context >= gateFloor(limit, await read($, quiet), sessionId)) {
        const verdict = await judge($, keeper.lang, e.text)
        if (verdict !== undefined) {
          await logGate($, gateEntry(at, context, keeper.handoff.gate, verdict, e.text))
        }
        if (verdict === 'new') {
          await update($, offer, () => ({ kind: 'new-task', prompt: e.text, isHeld: true, context, at }))

          return {
            drop: pick(keeper.lang, {
              en: 'This looks like an unrelated new task. Choose to hand off or stay above the prompt box.',
              'zh-TW': '這則看起來是無關的新任務；在輸入框上方選擇交接或留下',
            }),
          }
        }
      } else if (keeper.handoff.gate === 'suggest' && context >= gateFloor(limit, await read($, quiet), sessionId)) {
        isGated = true
      }
      if (keeper.handoff.isResumeOn && !resumed.has(sessionId)) {
        resumed.add(sessionId)
        const root = await workspace($)
        const text = await readText($, `${root}/${PROGRESS_FILE}`)
        const offered = (await $.store.get(offeredKey(root))) as Offered | undefined
        const body = text === '' ? undefined : progressNote(text, sessionId, at, offered)
        const updated = parseProgress(text)?.head.updated
        if (body !== undefined && updated !== undefined) {
          note = { text: body, root, updated }
        }
      }
    } catch (error) {
      $.ui.log(`prompt.submit: ${String(error)}`, { to: 'debug' })
    }

    const result = await next(note === undefined ? submitted : { ...submitted, context: [...(submitted.context ?? []), note.text] })
    if (result.drop !== undefined) {
      return result
    }
    try {
      if (pending !== null) {
        await update($, offer, () => null)
        if (pending.kind === 'new-task') {
          await chooseGate($, pending.at, pending.isHeld ? 'stay' : 'ignored')
          await quietDown($, pending.context)
        }
      }
      if (note !== undefined) {
        const key = offeredKey(note.root)
        const sessionId = await $.session.id()
        await $.store.set(key, withOffered((await $.store.get(key)) as Offered | undefined, note.updated, sessionId))
      }
      if (isGated && pending === null) {
        void suggest($, keeper.lang, e.text, context, keeper.handoff)
      }
    } catch (error) {
      $.ui.log(`prompt.submit: ${String(error)}`, { to: 'debug' })
    }

    return result
  }).catch(($, e, next) => next(e))

  // A compaction rewrites the prefix on purpose: its rebuild is not a miss.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await update($, meter, current => ({ ...current, expectRebuild: true }))
    }

    return result
  }).catch(($, e, next) => next(e))

  // The usage the engine hands over has no 5m/1h split; the transcript's records do.
  on('classic.Stop', async ($, e, next) => {
    const current = await read($, meter)
    const at = await $.clock.now()
    const isDue = current.ttl === null || at - current.ttlCheckedAt > TTL_RECHECK_MS
    if (e.agent_id === undefined && e.transcript_path !== '' && current.writeTokens > 0 && isDue) {
      const ttl = ttlFromTranscript(await $.fs.read(e.transcript_path))
      await update($, meter, m => ({ ...m, ttl: ttl ?? m.ttl, ttlCheckedAt: at }))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // The offer and the handoff's progress on every surface; the cache line on the desktop only (the
  // terminal has the status line for it). The bands of the plugins beneath are drawn under it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const pending = await read($, offer)
    const busy = await read($, handing)
    const isCacheLine = e.surface === 'desktop'
    const at = Math.max(await read($, now), await $.clock.now())
    const onText = onLine(COMMAND, await read($, onUntil), at)
    if (!isCacheLine && pending === null && busy === null && onText === '') {
      return next(e)
    }
    const below = await next(e)
    const current = await read($, meter)
    const { Box, Button, Text } = $.ui.resolve(e)

    // The desktop's proportional font packs ' · ' tight, so the parts are spaced by the layout instead.
    const parts = segments(current, at, keeper.config.maxKeeps).flatMap((part, i) => [
      ...(i > 0 ? [<Text dimColor>·</Text>] : []),
      part.tone === 'dim' ? <Text dimColor>{part.text}</Text> : <Text color={TONE_COLOR[part.tone]}>{part.text}</Text>,
    ])
    const lang = keeper.lang
    const question =
      pending === null
        ? ''
        : pending.kind === 'away'
          ? pick(lang, {
              en: `The cache has expired; doing this here rewrites ${fmtTokens(current.nextTokens)}`,
              'zh-TW': `快取已過期，這則若在這裡做要重寫 ${fmtTokens(current.nextTokens)}`,
            })
          : pick(lang, {
              en: `This looks like an unrelated new task (context ${fmtTokens(pending.context)})`,
              'zh-TW': `這則看起來是無關的新任務（context ${fmtTokens(pending.context)}）`,
            })

    return (
      <Box flexDirection="column">
        {onText !== '' && (
          <Text dimColor wrap="truncate-end">
            {onText}
          </Text>
        )}
        {busy !== null && (
          <Text color="yellow" wrap="truncate-end">
            {pick(lang, {
              en: "Handing off: once the summary is written it runs /clear and puts it in the new session's prompt box; messages you type meanwhile go along",
              'zh-TW': '交接中：產生摘要後會 /clear，摘要放進新 session 的輸入框；這段時間打的訊息會一起帶過去',
            })}
          </Text>
        )}
        {busy === null && pending !== null && (
          <Box flexDirection="row">
            <Text color="yellow" wrap="truncate-end">
              {question}{' '}
            </Text>
            <Button
              key="handoff"
              label={pick(lang, { en: 'Hand off to a new session', 'zh-TW': '交接並開新 session' })}
              hotkey="h"
              onPress={() => void handOff($, lang, pending.kind, pending.prompt, pending.isHeld, turn)}
            />
            <Button
              key="stay"
              label={
                pending.isHeld
                  ? pick(lang, { en: 'Keep working here', 'zh-TW': '仍在這裡做' })
                  : pick(lang, { en: 'Stay here', 'zh-TW': '留在這裡' })
              }
              hotkey="k"
              onPress={() => void stay($, pending)}
            />
          </Box>
        )}
        {isCacheLine && (
          <Box flexDirection="row" columnGap={GAP}>
            <Text dimColor bold>
              cache
            </Text>
            {parts}
          </Box>
        )}
        {below}
      </Box>
    )
  })
}
