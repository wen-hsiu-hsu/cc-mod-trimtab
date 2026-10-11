import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode } from 'claude-code'

import type { WatchedAgent } from '../types'
import { configCommand, LANGUAGE, loadConfig, pick, type ConfigIO, type Lang, type Specs } from './config'
import {
  applyMeta,
  buildReport,
  countKinds,
  dayLabel,
  elapsed,
  DEFAULT_DAYS,
  GROUP_BYS,
  groups,
  type GroupBy,
  n,
  repoName,
  sessionName,
  share,
  spawnParts,
  tokens,
  type Spawn,
  emptyText,
  emptyLedger,
  isLedger,
  LEDGER_PREFIX,
  LEDGER_SPEC,
  MAX_DAYS,
  promptSummary,
  range,
  recordSpawn,
  recordStep,
  renderStats,
  RETENTION_MS,
  type Ledger,
  type Report,
  type SessionMeta,
} from './ledger'

// An opened row lists this many spawns, and this many more at each "more".
const PAGE = 10

const running = atom({ plugin: 'agent-dispatch', key: 'running' } as const, [])
const stopped = atom({ plugin: 'agent-dispatch', key: 'stopped' } as const, [])
// What the stats pane shows: the period, the grouping, the row opened to its spawns, their
// order, how many of them are listed and the one opened in place.
const view = atom({ plugin: 'agent-dispatch', key: 'view' } as const, { days: 30, by: 'repo', item: '', sort: 'tokens', limit: PAGE, spawn: '' })

// How an opened row orders its spawns: most tokens, newest, or longest run first.
type SortBy = 'tokens' | 'time' | 'duration'
const SORTS: Record<SortBy, (spawn: Spawn) => number> = {
  tokens: spawn => tokens(spawn),
  time: spawn => spawn.at,
  duration: spawn => spawn.last - spawn.at,
}

const MOD = 'agent-dispatch'
const REDISPATCH = 'redispatch'
const STATS = 'stats'
const PANE = 'agent-dispatch-stats'
const PERIODS = [7, 30, 90]
// From this many body columns a row is one line; below, its bar goes on a second line.
const WIDE_COLUMNS = 80
// From this many body columns the two cards sit side by side; below, one above the other.
const CARD_COLUMNS = 60
const SPECS: Specs = { ledger: LEDGER_SPEC, language: LANGUAGE }
const POLL_MS = 3000
const STOPPED = new Set(['killed', 'failed'])
const FINISHED = new Set(['completed', 'idle'])

function label(agent: WatchedAgent): string {
  return agent.model ? `${agent.type}/${agent.model}` : agent.type
}

// Sent to Claude, so always English.
export function redispatchPrompt(agents: WatchedAgent[]): string {
  const list = agents.map(agent => `- ${agent.description} (${label(agent)}, agent id ${agent.id})`).join('\n')

  return `These background agents were just interrupted. Dispatch them again with their original prompt, subagent_type and model (the original Agent calls are earlier in the conversation):\n${list}`
}

// Moves agents the engine reports as finished or stopped out of `running`.
async function refresh($: EngineInterface, lang: Lang): Promise<void> {
  const tracked = await read($, running)
  if (tracked.length === 0) {
    return
  }
  const live = new Map((await $.agent.list()).map(info => [info.id, info.status]))
  const stillRunning: WatchedAgent[] = []
  const newlyStopped: WatchedAgent[] = []
  for (const agent of tracked) {
    const status = live.get(agent.id)
    if (status !== undefined && STOPPED.has(status)) {
      newlyStopped.push({ ...agent, status })
    } else if (status !== undefined && !FINISHED.has(status)) {
      stillRunning.push(agent)
    }
  }

  await update($, running, () => stillRunning)
  if (newlyStopped.length > 0) {
    await update($, stopped, list => [...list, ...newlyStopped])
    $.ui.toast(
      pick(lang, {
        en: `agent-dispatch: ${newlyStopped.length} background agent(s) were interrupted; type /${MOD} ${REDISPATCH} to dispatch them again`,
        'zh-TW': `agent-dispatch：${newlyStopped.length} 個背景 agent 被中斷，輸入 /${MOD} ${REDISPATCH} 重派`,
      }),
      { timeoutMs: 10000 },
    )
  }
  await showStatus($, lang)
}

// Surfaces without the band above the prompt (mobile, the IDE) get a one-line summary instead.
async function showStatus($: EngineInterface, lang: Lang): Promise<void> {
  const surface = await $.session.surface()
  if (surface === 'terminal' || surface === 'desktop') {
    return
  }
  const count = (await read($, running)).length
  const lost = (await read($, stopped)).length
  const runningText = pick(lang, { en: `${count} background agent(s)`, 'zh-TW': `${count} 個背景 agent` })
  const interrupted = pick(lang, { en: `${lost} interrupted (/${MOD} ${REDISPATCH})`, 'zh-TW': `${lost} 個被中斷（/${MOD} ${REDISPATCH}）` })
  const parts = [count > 0 ? runningText : '', lost > 0 ? interrupted : '']
  const text = parts.filter(Boolean).join(' · ')
  $.ui.status(text === '' ? undefined : text)
}

async function fillRedispatch($: EngineInterface, lang: Lang): Promise<string> {
  const agents = await read($, stopped)
  if (agents.length === 0) {
    return pick(lang, { en: 'No interrupted background agents.', 'zh-TW': '沒有被中斷的背景 agent。' })
  }
  await $.prompt.fill({ text: redispatchPrompt(agents), mode: 'replace' })
  await update($, stopped, () => [])
  await showStatus($, lang)

  return pick(lang, {
    en: `Put the redispatch instructions for ${agents.length} agent(s) in the prompt box; press Enter to confirm.`,
    'zh-TW': `已把 ${agents.length} 個 agent 的重派指示放進輸入框，確認後按 Enter。`,
  })
}

// `meta` belongs to session `sid`; `agents` maps an agent id to the ledger key it was spawned
// under, at most AGENT_KEYS of them.
type LedgerState = { recording: boolean; writing: Promise<void>; sid: string; meta: SessionMeta; agents: Map<string, string> }

const AGENT_KEYS = 500

// `/clear` starts a new session id in the same process without a session.start: the new
// session starts now and is named after its own first prompt.
async function sessionKey($: EngineInterface, state: LedgerState): Promise<string> {
  const sid = await $.session.id()
  if (state.sid !== sid) {
    if (state.sid !== '') {
      state.meta = { ...state.meta, started: await $.clock.now(), prompt: '' }
    }
    state.sid = sid
  }

  return `${LEDGER_PREFIX}${sid}`
}

// Applies `change` to this session's own ledger key, or for a step of an agent spawned under an
// earlier session id (one that outlived /clear) to that session's. Parallel subagents step at
// the same time and each write reads the ledger back, so they take turns. Bookkeeping must
// never break the engine's call.
function record($: EngineInterface, state: LedgerState, where: string, change: (ledger: Ledger, at: number) => void, agentId?: string): Promise<void> {
  if (!state.recording) {
    return Promise.resolve()
  }
  state.writing = state.writing.then(async () => {
    try {
      const own = await sessionKey($, state)
      const key = (agentId === undefined ? undefined : state.agents.get(agentId)) ?? own
      const stored = await $.store.get(key)
      const ledger = isLedger(stored) ? { ...emptyLedger(), ...stored } : emptyLedger()
      change(ledger, await $.clock.now())
      if (key === own) {
        applyMeta(ledger, state.meta)
      }
      await $.store.set(key, ledger)
    } catch (error) {
      $.ui.log(`${where}: ledger not written: ${String(error)}`, { to: 'debug' })
    }
  })

  return state.writing
}

// Deletes the ledgers no session has written to for RETENTION_MS.
async function pruneLedgers($: EngineInterface): Promise<void> {
  const cutoff = (await $.clock.now()) - RETENTION_MS
  for (const key of (await $.store.keys()).filter(name => name.startsWith(LEDGER_PREFIX))) {
    const stored = (await $.store.get(key)) as Partial<Ledger> | undefined
    if (typeof stored?.updated !== 'number' || stored.updated < cutoff) {
      await $.store.delete(key)
    }
  }
}

async function loadReport($: EngineInterface, days: number): Promise<Report> {
  const keys = (await $.store.keys()).filter(name => name.startsWith(LEDGER_PREFIX))
  const stored = await Promise.all(keys.map(key => $.store.get(key)))

  return buildReport(stored, days, await $.clock.now())
}

// `stats [--text] [days]`: opens the pane, or prints the report with `--text`, in a `-p` run
// or where the pane cannot be placed (a narrow terminal).
async function stats($: EngineInterface, lang: Lang, args: string[], interactive: boolean): Promise<string> {
  const text = args.includes('--text')
  const rest = args.filter(arg => arg !== '--text')
  const days = rest[0] === undefined ? DEFAULT_DAYS : Number(rest[0])
  if (rest.length > 1 || !Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return pick(lang, {
      en: `Usage: /${MOD} ${STATS} [--text] [days], days from 1 to ${MAX_DAYS} (default ${DEFAULT_DAYS})`,
      'zh-TW': `用法：/${MOD} ${STATS} [--text] [天數]，天數 1 到 ${MAX_DAYS}（預設 ${DEFAULT_DAYS}）`,
    })
  }
  if (!text && interactive) {
    await update($, view, current => ({ ...current, days }))
    const opened = await $.ui.open({ id: PANE, title: pick(lang, { en: 'agent-dispatch usage', 'zh-TW': 'agent-dispatch 用量' }), focus: true, closeOnEscape: true })
    if (opened.isPlaced) {
      return pick(lang, { en: 'Opened the usage pane (Esc closes it).', 'zh-TW': '已開啟用量 pane（Esc 關閉）。' })
    }
    $.ui.log(`stats: pane not placed (${opened.reason}), printing the text report`, { to: 'debug' })
    await $.ui.close({ id: PANE }).catch(() => undefined)
  }

  return renderStats(lang, await loadReport($, days))
}

// How many cells of `width` a bar for `part` of `most` fills: at least one when there is any.
function barCells(part: number, most: number, width: number): number {
  return part <= 0 ? 0 : Math.max(1, Math.round((part / most) * width))
}

function svgBar(cells: number, width: number): string {
  const unit = 8

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * unit}" height="10"><rect width="${cells * unit}" height="10" rx="2" fill="#2f6fb5"/></svg>`
}

// One colored part of a card's bar and its legend line: `ink` on the terminal, `fill` on desktop.
// `tally` follows it on every card, `note` only on the overview's.
type Part = { key: string; label: string; short?: string; tally?: string; note?: string; value: number; ink: string; fill: string }

// main session purple, subagent cyan, named model yellow, default model gray, fork green.
const COLORS = {
  main: { ink: 'magenta', fill: '#8a5cc7' },
  sub: { ink: 'cyan', fill: '#2f8fb0' },
  named: { ink: 'yellow', fill: '#c98a12' },
  default: { ink: 'gray', fill: '#8b8b93' },
  fork: { ink: 'green', fill: '#3f9a4f' },
} as const

// The main session's models, one after another in the same bar.
const MAIN_SHADES = [COLORS.main, { ink: 'magentaBright', fill: '#b48ee6' }, { ink: 'magenta', fill: '#6b3fa8' }]

// `width` cells shared out by `values`, each part with any value at least one cell.
function splitCells(values: number[], width: number): number[] {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total === 0) {
    return values.map(() => 0)
  }
  const cells = values.map(value => (value > 0 ? Math.max(1, Math.round((value / total) * width)) : 0))
  // Rounding can miss the width by a cell or two: the largest part takes the difference.
  const largest = cells.indexOf(Math.max(...cells))
  cells[largest] = (cells[largest] ?? 0) + width - cells.reduce((sum, cell) => sum + cell, 0)

  return cells
}

function svgStack(parts: { cells: number; fill: string }[]): string {
  const unit = 8
  let x = 0
  const rects = parts.map(part => {
    const rect = part.cells === 0 ? '' : `<rect x="${x * unit}" width="${part.cells * unit}" height="8" fill="${part.fill}"/>`
    x += part.cells

    return rect
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x * unit}" height="8">${rects.join('')}</svg>`
}

// A spawn's key in the pane: its agent id, or for one recorded without, when it started.
function spawnId(spawn: Spawn): string {
  return spawn.agentId ?? String(spawn.at)
}

// Where a spawn's model came from: forked, named, or the default.
function kindColor(spawn: Spawn): { ink: string; fill: string } {
  return spawn.fork ? COLORS.fork : spawn.requested !== undefined ? COLORS.named : COLORS.default
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
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
  // Re-read at session start and after `/agent-dispatch set`.
  let lang: Lang = 'en'
  // A `-p` run has no pane: `stats` prints its report there.
  let interactive = true
  const ledger: LedgerState = { recording: true, writing: Promise.resolve(), sid: '', meta: { repo: '', started: 0, prompt: '' }, agents: new Map() }

  on('session.start', async ($, e, next) => {
    interactive = e.isInteractive
    try {
      const config = await loadConfig(configIO($), MOD, SPECS, options)
      lang = config.lang
      ledger.recording = config.values.ledger !== false
    } catch (error) {
      $.ui.log(`session.start: settings not read: ${String(error)}`, { to: 'debug' })
    }
    try {
      ledger.meta = { ...ledger.meta, repo: (await $.session.repo())?.root ?? e.cwd, started: await $.clock.now() }
    } catch (error) {
      $.ui.log(`session.start: repo not read: ${String(error)}`, { to: 'debug' })
    }
    try {
      await pruneLedgers($)
    } catch (error) {
      $.ui.log(`session.start: ledgers not pruned: ${String(error)}`, { to: 'debug' })
    }
    try {
      await $.command.register({
        name: MOD,
        description: pick(lang, {
          en: 'Put the redispatch instructions for interrupted background agents in the prompt box (redispatch), or show token use by subagents and models (stats)',
          'zh-TW': '把被中斷的背景 agent 重派指示放進輸入框（redispatch），或看 subagent 與各模型的 token 用量（stats）',
        }),
        argumentHint: 'redispatch | stats [--text] [days] | status',
      })
    } catch (error) {
      $.ui.log(`session.start: /${MOD} not registered: ${String(error)}`, { to: 'debug' })
      $.ui.toast(pick(lang, { en: `${MOD}: /${MOD} was not registered (${String(error)})`, 'zh-TW': `${MOD}：/${MOD} 指令沒有註冊成功（${String(error)}）` }))
    }
    $.clock.every(POLL_MS, () => void refresh($, lang))

    return next(e)
  })

  on('command.run', { command: MOD }, async ($, e) => {
    if (e.args.trim().split(/\s+/)[0] === REDISPATCH) {
      return { text: await fillRedispatch($, lang) }
    }
    const [command, ...rest] = e.args.trim().split(/\s+/)
    if (command === STATS) {
      return { text: await stats($, lang, rest, interactive) }
    }
    const text = await configCommand(configIO($), MOD, SPECS, options, e.args, resolved => {
      lang = resolved.lang
      ledger.recording = resolved.values.ledger !== false
    })

    return {
      text:
        text ??
        pick(lang, {
          en: `Usage: /${MOD} ${REDISPATCH}, /${MOD} ${STATS} [--text] [days], /${MOD} status`,
          'zh-TW': `用法：/${MOD} ${REDISPATCH}、/${MOD} ${STATS} [--text] [天數]、/${MOD} status`,
        }),
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.deny !== undefined) {
      return spawned
    }
    await record($, ledger, 'agent.spawn', (entries, at) =>
      recordSpawn(entries, at, {
        ...(spawned.agentId === undefined ? {} : { agentId: spawned.agentId }),
        type: e.subagentType,
        model: spawned.model,
        ...(e.model === undefined ? {} : { requested: e.model }),
        fork: e.fork || e.subagentType === 'fork',
        background: e.background,
        description: e.description,
      }),
    )
    if (spawned.agentId !== undefined && ledger.recording) {
      ledger.agents.set(spawned.agentId, await sessionKey($, ledger))
      for (const old of [...ledger.agents.keys()].slice(0, -AGENT_KEYS)) {
        ledger.agents.delete(old)
      }
    }

    return spawned
  })

  // The session is named after its first prompt that is not a slash command; a resumed one
  // keeps the name it has. Mods cannot read the session's own title.
  on('prompt.submit', async ($, e, next) => {
    await sessionKey($, ledger).catch(() => undefined)
    if (ledger.meta.prompt === '' && ['composer', 'bridge', 'sdk'].includes(e.origin.kind) && !e.text.trimStart().startsWith('/')) {
      ledger.meta = { ...ledger.meta, prompt: promptSummary(e.text) }
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const usage = result.usage
    if (usage !== null) {
      await record($, ledger, 'turn.step', (entries, at) =>
        recordStep(entries, at, {
          ...(e.agentId === undefined ? {} : { agentId: e.agentId }),
          model: usage.model || e.model,
          input: usage.input_tokens,
          cacheWrite: usage.cache_creation_input_tokens,
          cacheRead: usage.cache_read_input_tokens,
          output: usage.output_tokens,
        }),
        e.agentId,
      )
    }

    return result
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = await next(e)
    const result = ran.result as { status?: string; agentId?: string; resolvedModel?: string } | undefined
    if (e.agentId === undefined && result?.status === 'async_launched' && result.agentId) {
      const agent: WatchedAgent = {
        id: result.agentId,
        description: e.description,
        type: e.subagent_type ?? 'general-purpose',
        startedAt: await $.clock.now(),
        status: 'running',
        ...((e.model ?? result.resolvedModel) ? { model: e.model ?? result.resolvedModel } : {}),
      }
      await update($, running, list => [...list, agent])
      await showStatus($, lang)
    }

    return ran
  }).catch(($, e, next) => next(e))

  // The band is one instance shared by every plugin: draw above what the plugins beneath drew
  // (open-items), never in place of it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const lost = await read($, stopped)
    if (e.props.hasSurvey || lost.length === 0) {
      return next(e)
    }
    const below = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="red" wrap="truncate-end">
            {pick(lang, { en: `${lost.length} agent(s) interrupted`, 'zh-TW': `${lost.length} 個 agent 被中斷` })}
            {pick(lang, { en: ': ', 'zh-TW': '：' })}
            {lost.map(agent => agent.description).join(pick(lang, { en: ', ', 'zh-TW': '、' }))}{' '}
          </Text>
          <Button key="redispatch" label={pick(lang, { en: 'Redispatch', 'zh-TW': '重派' })} hotkey="r" onPress={() => void fillRedispatch($, lang)} />
          <Button key="dismiss" label={pick(lang, { en: 'Dismiss', 'zh-TW': '略過' })} hotkey="d" onPress={() => void update($, stopped, () => [])} />
        </Box>
        {below}
      </Box>
    )
  })

  // Laid out by the body's columns, never padded with spaces (a CJK character takes two cells).
  // Each row is a button that opens it to its sessions and spawns; Back returns.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const parts = $.ui.resolve(e)
    const { Box, Button, Text } = parts
    // Desktop draws the bars as Svg; the terminal has no Svg and gets colored spaces. The runtime
    // hands every constructor over, so the surface decides, not their presence.
    const Svg = e.surface !== 'terminal' && 'Svg' in parts ? parts.Svg : undefined
    const shown = await read($, view)
    const by = (GROUP_BYS as readonly string[]).includes(shown.by) ? (shown.by as GroupBy) : 'repo'
    const report = await loadReport($, shown.days)
    const rows = groups(lang, report, by)
    const open = rows.find(row => row.key === shown.item)
    const body = e.props.bodyColumns
    const wide = body >= WIDE_COLUMNS
    const all = report.main + report.sub
    const most = Math.max(1, ...rows.map(row => row.tokens))
    const barWidth = wide ? clamp(body - 60, 10, 40) : clamp(body - 22, 8, 30)
    const byLabel: Record<GroupBy, string> = {
      repo: 'repo',
      session: 'session',
      model: pick(lang, { en: 'model', 'zh-TW': '模型' }),
      type: pick(lang, { en: 'type', 'zh-TW': '種類' }),
    }
    // Switches in place, so nothing below moves: in the terminal one button that steps to the
    // next value (its hotkey too) and wraps, elsewhere a segment per value with the hotkey on the
    // one after the current, so it steps forward the same way.
    const switcher = (key: string, label: string, hotkey: string, options: { value: string; label: string }[], value: string, onPick: (value: string) => void) => {
      if (e.surface === 'terminal') {
        const at = Math.max(0, options.findIndex(option => option.value === value))
        const next = options[(at + 1) % options.length]!.value

        return (
          <Box key={`switch:${key}`} flexDirection="row" flexShrink={0}>
            <Text dimColor>{label}</Text>
            <Button key={key} plain hotkey={hotkey} onPress={() => onPick(next)}>
              <Text color="yellow">‹ {options[at]?.label ?? value} ›</Text>
            </Button>
          </Box>
        )
      }

      const at = Math.max(0, options.findIndex(option => option.value === value))

      return (
        <Box key={`switch:${key}`} flexDirection="row" gap={1} flexShrink={0}>
          <Text dimColor>{label}</Text>
          {options.map((option, i) => (
            <Button
              key={`${key}:${option.value}`}
              label={option.label}
              {...(i === (at + 1) % options.length ? { hotkey } : {})}
              {...(i === at ? { variant: 'primary' as const } : { dimColor: true })}
              onPress={() => onPick(option.value)}
            />
          ))}
        </Box>
      )
    }
    const spawnCount = (count: number) => pick(lang, { en: `${count} spawns`, 'zh-TW': `${count} 次` })
    const cellBar = (part: number, whole: number, width: number) => {
      const cells = barCells(part, whole, width)
      if (Svg !== undefined) {
        return <Svg source={svgBar(cells, width)} alt={n(part)} width={width * 8} height={10} />
      }

      return cells === 0 ? <Text> </Text> : <Text backgroundColor="cyan">{' '.repeat(cells)}</Text>
    }
    const bar = (part: number) => cellBar(part, most, barWidth)

    const periodSwitch = switcher(
      'days',
      pick(lang, { en: 'Period ', 'zh-TW': '期間 ' }),
      'p',
      PERIODS.map(days => ({ value: String(days), label: pick(lang, { en: `${days} days`, 'zh-TW': `${days} 天` }) })),
      String(shown.days),
      value => void update($, view, current => ({ ...current, days: Number(value), item: '' })),
    )
    const groupSwitch = switcher(
      'group',
      pick(lang, { en: 'Group by ', 'zh-TW': '分組 ' }),
      'g',
      GROUP_BYS.map(value => ({ value, label: byLabel[value] })),
      by,
      value => void update($, view, current => ({ ...current, by: value, item: '' })),
    )
    // Two cards, each a total over a bar of what it is made of: stacked in a dock, side by side
    // from CARD_COLUMNS. A card's border and padding take four of its columns.
    const paired = body >= CARD_COLUMNS
    const cardWidth = paired ? Math.floor((body - 2) / 2) : body
    const tokenPartsOf = (main: number, sub: number): Part[] => [
      { key: 'main', label: pick(lang, { en: 'main session', 'zh-TW': '主 session' }), value: main, ...COLORS.main },
      { key: 'sub', label: 'subagent', value: sub, ...COLORS.sub },
    ]
    const tokenParts = tokenPartsOf(report.main, report.sub)
    // An opened session's main tokens by model, most first, in alternating shades of purple.
    const modelParts = (byModel: [string, number][]): Part[] =>
      [...byModel]
        .sort((a, b) => b[1] - a[1])
        .map(([model, value], i) => ({ key: `main:${model}`, label: model, value, ...MAIN_SHADES[i % MAIN_SHADES.length]! }))
    const kindPartsOf = (s: Report['spawned']): Part[] => [
      {
        key: 'named',
        label: pick(lang, { en: 'named a model', 'zh-TW': '指定模型' }),
        short: pick(lang, { en: 'named', 'zh-TW': '指定' }),
        tally: pick(lang, { en: ` (Opus: ${s.opus})`, 'zh-TW': `（Opus ${s.opus}）` }),
        value: s.explicit,
        ...COLORS.named,
      },
      { key: 'default', label: pick(lang, { en: 'default model', 'zh-TW': '沿用預設' }), short: pick(lang, { en: 'default', 'zh-TW': '預設' }), value: s.defaults, ...COLORS.default },
      {
        key: 'fork',
        label: 'fork',
        note: pick(lang, { en: " (main session's model)", 'zh-TW': '（用主 session 的模型）' }),
        short: 'fork',
        value: s.forks,
        ...COLORS.fork,
      },
    ]
    const kindParts = kindPartsOf(report.spawned)
    const card = (key: string, title: string, aside: RenderNode, total: string, parts: Part[], legendKey: string) => (
      <Box key={`card:${key}`} flexDirection="column" width={cardWidth} flexShrink={0} borderStyle="round" borderDimColor paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Text dimColor>{title}</Text>
          {aside}
        </Box>
        <Text bold>{total}</Text>
        {stack(parts, cardWidth - 4)}
        {parts.map(part => (
          <Box key={`${legendKey}:${part.key}`} flexDirection="row" justifyContent="space-between" gap={1}>
            <Box flexShrink={1}>
              <Text wrap="truncate-end">
                <Text color={part.ink}>●</Text> {part.label}
                {part.tally === undefined && part.note === undefined ? '' : <Text dimColor>{`${part.tally ?? ''}${part.note ?? ''}`}</Text>}
              </Text>
            </Box>
            <Text>{n(part.value)}</Text>
          </Box>
        ))}
      </Box>
    )
    // An opened row's card: its total and `aside`, and only when it has more than one part, the bar and a
    // legend on one line by short labels: `named 22 (Opus: 0)`. A spawns card always splits.
    const compact = (key: string, total: RenderNode, aside: RenderNode, parts: Part[], kinds = false) => {
      const split = kinds || parts.filter(part => part.value > 0).length > 1

      return (
        <Box key={`card:${key}`} flexDirection="column" width={cardWidth} flexShrink={0} borderStyle="round" borderDimColor paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            {total}
            {aside}
          </Box>
          {split ? stack(parts, cardWidth - 4) : null}
          {split ? (
            <Text wrap="wrap">
              {parts.map((part, i) => [
                i === 0 ? '' : '  ',
                <Text color={part.ink}>●</Text>,
                ` ${part.short ?? part.label} ${n(part.value)}`,
                part.tally === undefined ? '' : <Text dimColor>{part.tally}</Text>,
              ])}
            </Text>
          ) : null}
        </Box>
      )
    }
    const stack = (parts: Part[], width: number) => {
      const cells = splitCells(parts.map(part => part.value), width)
      if (Svg !== undefined) {
        return <Svg source={svgStack(parts.map((part, i) => ({ cells: cells[i] ?? 0, fill: part.fill })))} alt={parts.map(part => `${part.label} ${n(part.value)}`).join(', ')} width={width * 8} height={8} />
      }

      return (
        <Text>
          {parts.map((part, i) => ((cells[i] ?? 0) === 0 ? '' : <Text backgroundColor={part.ink}>{' '.repeat(cells[i] ?? 0)}</Text>))}
        </Text>
      )
    }

    if (open !== undefined) {
      const sort: SortBy = shown.sort in SORTS ? (shown.sort as SortBy) : 'tokens'
      const listed = open.detail
        .flatMap(part => part.spawns.map(spawn => ({ spawn, session: part.session })))
        .sort((a, b) => SORTS[sort](b.spawn) - SORTS[sort](a.spawn))
      const limit = Math.max(PAGE, Number(shown.limit) || PAGE)
      const openMain = open.detail.reduce((sum, part) => sum + part.main, 0)
      const openSub = open.tokens - openMain
      const counted = countKinds(listed.map(item => item.spawn))
      const top = Math.max(1, ...listed.map(item => tokens(item.spawn)))
      const rowBar = wide ? 16 : 8

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button
              key="back"
              label={pick(lang, { en: '‹ Back', 'zh-TW': '‹ 返回' })}
              hotkey="b"
              onPress={() => void update($, view, current => ({ ...current, item: '' }))}
            />
            <Text dimColor>{byLabel[by]} ›</Text>
            <Box flexShrink={1}>
              <Text bold wrap="truncate-end">
                {open.label}
              </Text>
            </Box>
          </Box>
          <Text dimColor>{pick(lang, { en: `${shown.days} days`, 'zh-TW': `${shown.days} 天` })}</Text>
          <Box key="cards" flexDirection={paired ? 'row' : 'column'} marginTop={1} gap={paired ? 2 : 0}>
            {compact(
              'tokens',
              <Text>
                <Text bold>{n(open.tokens)}</Text> <Text dimColor>token</Text>
              </Text>,
              openSub === 0 ? null : (
                <Text color={COLORS.sub.ink}>{pick(lang, { en: `by subagents ${share(openSub, open.tokens)}`, 'zh-TW': `subagent 佔 ${share(openSub, open.tokens)}` })}</Text>
              ),
              by === 'session' ? [...modelParts(open.detail.flatMap(part => part.session.mainByModel)), ...tokenPartsOf(openMain, openSub).slice(1)] : tokenPartsOf(openMain, openSub),
            )}
            {counted.all === 0
              ? null
              : compact(
                  'spawns',
                  <Text>
                    <Text bold>{counted.all}</Text> <Text dimColor>{pick(lang, { en: 'spawns', 'zh-TW': '次派出' })}</Text>
                  </Text>,
                  null,
                  kindPartsOf(counted),
                  true,
                )}
          </Box>
          {listed.length === 0 ? (
            // The main session row: no spawns, each session's own tokens instead.
            open.detail.map(part => (
              <Box key={`main:${part.session.repo}-${part.session.started}`} flexDirection="row" gap={1}>
                <Box flexGrow={1} flexShrink={1}>
                  <Text wrap="truncate-end">{sessionName(lang, part.session)}</Text>
                </Box>
                <Text>{n(part.main)}</Text>
              </Box>
            ))
          ) : (
          <Box flexDirection="column">
          <Box marginTop={1}>
            {switcher(
              'sort',
              pick(lang, { en: 'Sort ', 'zh-TW': '排序 ' }),
              's',
              [
                { value: 'tokens', label: pick(lang, { en: 'most tokens', 'zh-TW': 'token 多到少' }) },
                { value: 'time', label: pick(lang, { en: 'time', 'zh-TW': '時間' }) },
                { value: 'duration', label: pick(lang, { en: 'duration', 'zh-TW': '耗時' }) },
              ],
              sort,
              value => void update($, view, current => ({ ...current, sort: value, limit: PAGE })),
            )}
          </Box>
          <Box flexDirection="row" gap={1}>
            <Box width={1} flexShrink={0} />
            <Box flexGrow={1} flexShrink={1}>
              <Text dimColor>{pick(lang, { en: 'Spawns', 'zh-TW': '派出' })}</Text>
            </Box>
            <Box width={rowBar} flexShrink={0} />
            <Box width={9} flexShrink={0} justifyContent="flex-end">
              <Text dimColor>token</Text>
            </Box>
            <Box width={6} flexShrink={0} justifyContent="flex-end">
              <Text dimColor>{pick(lang, { en: 'date', 'zh-TW': '日期' })}</Text>
            </Box>
          </Box>
          {listed.slice(0, limit).map(({ spawn, session }) => {
            const id = spawnId(spawn)
            const color = kindColor(spawn)
            const how = spawn.fork ? 'fork' : spawn.requested === undefined ? pick(lang, { en: 'default', 'zh-TW': '預設' }) : pick(lang, { en: 'named', 'zh-TW': '指定' })
            const lines: [string, string, RenderNode][] = [
              ['type', pick(lang, { en: 'Type', 'zh-TW': '種類' }), spawn.type],
              [
                'model',
                pick(lang, { en: 'Model', 'zh-TW': '模型' }),
                <Text wrap="truncate-end">
                  <Text color={color.ink}>{how}</Text>
                  {spawn.requested === undefined || spawn.fork ? '' : ` ${spawn.requested}`} → {spawn.model}
                </Text>,
              ],
              [
                'run',
                pick(lang, { en: 'Run', 'zh-TW': '執行' }),
                [
                  ...(spawn.background ? [pick(lang, { en: 'background', 'zh-TW': '背景' })] : []),
                  pick(lang, { en: `${spawn.steps} steps`, 'zh-TW': `${spawn.steps} 步` }),
                  elapsed(spawn.last - spawn.at),
                ].join(' · '),
              ],
              ['session', 'session', sessionName(lang, session)],
            ]

            return [
              <Box key={`line:${id}`} flexDirection="row" gap={1}>
                <Box key={`dot:${id}`} width={1} flexShrink={0}>
                  <Text color={kindColor(spawn).ink}>●</Text>
                </Box>
                <Box flexGrow={1} flexShrink={1}>
                  <Button key={`spawn:${id}`} plain onPress={() => void update($, view, current => ({ ...current, spawn: current.spawn === id ? '' : id }))}>
                    <Text wrap="truncate-end">{spawnParts(lang, spawn)[0]}</Text>
                  </Button>
                </Box>
                <Box width={rowBar} flexShrink={0}>
                  {cellBar(tokens(spawn), top, rowBar)}
                </Box>
                <Box width={9} flexShrink={0} justifyContent="flex-end">
                  <Text>{n(tokens(spawn))}</Text>
                </Box>
                <Box width={6} flexShrink={0} justifyContent="flex-end">
                  <Text dimColor>{dayLabel(lang, spawn.at)}</Text>
                </Box>
              </Box>,
              shown.spawn === id ? (
                // Opened in place: a line in the color of where its model came from runs down the left
                // (a Box border cannot be drawn on one side only).
                <Box key={`detail:${id}`} flexDirection="column" marginLeft={1} marginTop={1} marginBottom={1}>
                  {lines.map(([key, name, value]) => (
                    <Box key={`detail:${id}:${key}`} flexDirection="row" gap={1}>
                      <Box width={2} flexShrink={0}>
                        <Text color={color.ink}>│</Text>
                      </Box>
                      <Box width={8} flexShrink={0}>
                        <Text dimColor>{name}</Text>
                      </Box>
                      <Box flexShrink={1}>{typeof value === 'string' ? <Text wrap="truncate-end">{value}</Text> : value}</Box>
                    </Box>
                  ))}
                </Box>
              ) : null,
            ]
          })}
          {listed.length > limit ? (
            <Box paddingLeft={2}>
              <Button key="more" plain hotkey="m" onPress={() => void update($, view, current => ({ ...current, limit: limit + PAGE }))}>
                <Text color="yellow">{pick(lang, { en: `${listed.length - limit} more ▸`, 'zh-TW': `還有 ${listed.length - limit} 筆 ▸` })}</Text>
              </Button>
            </Box>
          ) : null}
          </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor wrap="wrap">
              {pick(lang, { en: 'Enter opens a spawn · s sorts · m more · ‹ Back (b) returns · Esc closes', 'zh-TW': 'Enter 展開一筆 · s 排序 · m 更多 · ‹ 返回（b）回總覽 · Esc 關閉' })}
            </Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {wide ? (
          // A wide pane: the period and its days on the left, the grouping on the right.
          <Box key="header" flexDirection="row" justifyContent="space-between" gap={2}>
            <Box flexDirection="row" gap={2}>
              {periodSwitch}
              <Text dimColor>{range(lang, report)}</Text>
            </Box>
            {report.sessions.length === 0 ? <Box /> : groupSwitch}
          </Box>
        ) : (
          <Box key="header" flexDirection="row" justifyContent="space-between" gap={2}>
            <Text dimColor>{range(lang, report)}</Text>
            {periodSwitch}
          </Box>
        )}
        {report.sessions.length === 0 ? (
          <Box marginTop={1}>
            <Text dimColor wrap="wrap">
              {emptyText(lang)}
            </Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Box key="cards" flexDirection={paired ? 'row' : 'column'} marginTop={1} gap={paired ? 2 : 0}>
              {card(
                'tokens',
                pick(lang, { en: 'Tokens', 'zh-TW': '總 token' }),
                <Text color={COLORS.sub.ink}>{pick(lang, { en: `by subagents ${share(report.sub, all)}`, 'zh-TW': `subagent 佔 ${share(report.sub, all)}` })}</Text>,
                n(all),
                tokenParts,
                'share',
              )}
              {card(
                'spawns',
                pick(lang, { en: 'Spawns', 'zh-TW': '派出' }),
                <Text dimColor>{pick(lang, { en: 'where the model came from', 'zh-TW': '模型怎麼來' })}</Text>,
                pick(lang, { en: String(report.spawned.all), 'zh-TW': `${report.spawned.all} 次` }),
                kindParts,
                'spawned',
              )}
            </Box>
            <Box key="cache-read">
              <Text dimColor wrap="wrap">
                {pick(lang, {
                  en: `Cache read ${n(report.cacheRead)}, not counted`,
                  'zh-TW': `快取讀取 ${n(report.cacheRead)}，不計入`,
                })}
              </Text>
            </Box>
            {wide ? (
              <Box key="columns" flexDirection="row" gap={1} marginTop={1}>
                <Box flexGrow={1} flexShrink={1}>
                  <Text dimColor>{byLabel[by]}</Text>
                </Box>
                <Box width={barWidth} flexShrink={0} />
                <Box width={10} flexShrink={0} justifyContent="flex-end">
                  <Text dimColor>token</Text>
                </Box>
                <Box width={5} flexShrink={0} justifyContent="flex-end">
                  <Text dimColor>{pick(lang, { en: 'share', 'zh-TW': '佔比' })}</Text>
                </Box>
                <Box width={10} flexShrink={0} justifyContent="flex-end">
                  <Text dimColor>{pick(lang, { en: 'spawns', 'zh-TW': '派出' })}</Text>
                </Box>
              </Box>
            ) : (
              <Box key="group-line" marginTop={1} marginBottom={1}>
                {groupSwitch}
              </Box>
            )}
            {rows.map(row => {
              // A Button holds only text, so the name is the button and the bar sits beside it.
              const name = (
                <Box flexGrow={1} flexShrink={1}>
                  <Button key={`row:${row.key}`} plain onPress={() => void update($, view, current => ({ ...current, item: row.key, sort: 'tokens', limit: PAGE, spawn: '' }))}>
                    <Text wrap="truncate-end">{row.label}</Text>
                  </Button>
                </Box>
              )

              return wide ? (
                <Box key={`line-${row.key}`} flexDirection="row" gap={1}>
                  {name}
                  <Box width={barWidth} flexShrink={0}>
                    {bar(row.tokens)}
                  </Box>
                  <Box width={10} flexShrink={0} justifyContent="flex-end">
                    <Text>{n(row.tokens)}</Text>
                  </Box>
                  <Box width={5} flexShrink={0} justifyContent="flex-end">
                    <Text dimColor>{share(row.tokens, all)}</Text>
                  </Box>
                  <Box width={10} flexShrink={0} justifyContent="flex-end">
                    <Text dimColor>{spawnCount(row.spawns)}</Text>
                  </Box>
                </Box>
              ) : (
                <Box key={`line-${row.key}`} flexDirection="column">
                  <Box flexDirection="row" gap={1}>
                    {name}
                    <Text dimColor>{spawnCount(row.spawns)}</Text>
                  </Box>
                  <Box flexDirection="row" gap={1}>
                    <Box width={barWidth} flexShrink={0}>
                      {bar(row.tokens)}
                    </Box>
                    <Text>{n(row.tokens)}</Text>
                    <Text dimColor>{share(row.tokens, all)}</Text>
                  </Box>
                </Box>
              )
            })}
            <Box marginTop={1}>
              <Text dimColor wrap="wrap">
                {pick(lang, { en: 'Tab moves · Enter opens a row · p period · g group · Esc closes', 'zh-TW': 'Tab 移動 · Enter 打開一列 · p 期間 · g 分組 · Esc 關閉' })}
              </Text>
            </Box>
          </Box>
        )}
      </Box>
    )
  })
}
