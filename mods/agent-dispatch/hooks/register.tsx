import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { WatchedAgent } from '../types'
import { configCommand, LANGUAGE, loadConfig, pick, type ConfigIO, type Lang, type Specs } from './config'
import {
  applyMeta,
  buildReport,
  DEFAULT_DAYS,
  GROUP_BYS,
  groups,
  type GroupBy,
  n,
  repoName,
  sessionName,
  share,
  spawnParts,
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

const running = atom({ plugin: 'agent-dispatch', key: 'running' } as const, [])
const stopped = atom({ plugin: 'agent-dispatch', key: 'stopped' } as const, [])
// What the stats pane shows: the period, the grouping and the row opened to its spawns.
const view = atom({ plugin: 'agent-dispatch', key: 'view' } as const, { days: 30, by: 'repo', item: '' })

const MOD = 'agent-dispatch'
const REDISPATCH = 'redispatch'
const STATS = 'stats'
const PANE = 'agent-dispatch-stats'
const PERIODS = [7, 30, 90]
// From this many body columns a row is one line; below, its bar goes on a second line.
const WIDE_COLUMNS = 80
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
    const { Box, Button, Select, Text } = parts
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
    const spawnCount = (count: number) => pick(lang, { en: `${count} spawns`, 'zh-TW': `${count} 次` })
    const bar = (part: number) => {
      const cells = barCells(part, most, barWidth)
      if (Svg !== undefined) {
        return <Svg source={svgBar(cells, barWidth)} alt={n(part)} width={barWidth * 8} height={10} />
      }

      return cells === 0 ? <Text> </Text> : <Text backgroundColor="cyan">{' '.repeat(cells)}</Text>
    }

    if (open !== undefined) {
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
          <Text dimColor wrap="wrap">
            {pick(lang, {
              en: `${n(open.tokens)} tokens · ${open.spawns} spawns · ${shown.days} days`,
              'zh-TW': `${n(open.tokens)} token · 派出 ${open.spawns} 次 · ${shown.days} 天`,
            })}
          </Text>
          {open.detail.map(part => (
            <Box key={`detail-${part.session.repo}-${part.session.started}`} flexDirection="column" marginTop={1}>
              <Text bold wrap="truncate-end">
                {sessionName(lang, part.session)}
              </Text>
              <Text dimColor wrap="truncate-end">
                {repoName(lang, part.session.repo)} · {pick(lang, { en: `main session ${n(part.main)}`, 'zh-TW': `主 session ${n(part.main)}` })}
              </Text>
              {part.spawns.map(spawn => {
                const [title, what, how] = spawnParts(lang, spawn)

                return (
                  <Box flexDirection="column" paddingLeft={2} marginTop={1}>
                    <Text wrap="wrap">{title}</Text>
                    <Text dimColor wrap="wrap">
                      {what}
                    </Text>
                    <Text dimColor wrap="wrap">
                      {how}
                    </Text>
                  </Box>
                )
              })}
            </Box>
          ))}
          <Box marginTop={1}>
            <Text dimColor wrap="wrap">
              {pick(lang, { en: '‹ Back (b) returns · Esc closes', 'zh-TW': '‹ 返回（b）回總覽 · Esc 關閉' })}
            </Text>
          </Box>
        </Box>
      )
    }

    const kpis = [
      { label: pick(lang, { en: 'Tokens', 'zh-TW': '總 token' }), value: n(all) },
      { label: pick(lang, { en: 'Subagents', 'zh-TW': 'subagent' }), value: share(report.sub, all) },
      { label: pick(lang, { en: 'Spawns', 'zh-TW': '派出' }), value: String(report.spawned.all) },
    ]
    const s = report.spawned

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" gap={2}>
          <Text dimColor>{range(lang, report)}</Text>
          <Select
            key="days"
            label={pick(lang, { en: 'Period ', 'zh-TW': '期間 ' })}
            options={PERIODS.map(days => ({ value: String(days), label: pick(lang, { en: `${days} days`, 'zh-TW': `${days} 天` }) }))}
            value={String(shown.days)}
            onSelect={value => void update($, view, current => ({ ...current, days: Number(value), item: '' }))}
          />
        </Box>
        {report.sessions.length === 0 ? (
          <Box marginTop={1}>
            <Text dimColor wrap="wrap">
              {emptyText(lang)}
            </Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Box flexDirection="row" marginTop={1}>
              {kpis.map(kpi => (
                <Box key={`kpi-${kpi.label}`} flexDirection="column" width={wide ? 22 : Math.floor(body / 3)} flexShrink={0}>
                  <Text dimColor>{kpi.label}</Text>
                  <Text bold>{kpi.value}</Text>
                </Box>
              ))}
            </Box>
            <Text dimColor wrap="wrap">
              {pick(lang, {
                en: `main ${n(report.main)} · sub ${n(report.sub)} · cache read ${n(report.cacheRead)}`,
                'zh-TW': `主 ${n(report.main)} · sub ${n(report.sub)} · cache read ${n(report.cacheRead)}`,
              })}
            </Text>
            <Text dimColor wrap="wrap">
              {pick(lang, {
                en: `named model ${s.explicit}/${s.all} · Opus ${s.opus} · fork ${s.forks} · default ${share(s.defaults, s.all)}`,
                'zh-TW': `指定模型 ${s.explicit}/${s.all} · Opus ${s.opus} · fork ${s.forks} · 預設 ${share(s.defaults, s.all)}`,
              })}
            </Text>
            <Box marginTop={1} marginBottom={1}>
              <Select
                key="group"
                label={pick(lang, { en: 'Group by ', 'zh-TW': '分組 ' })}
                options={GROUP_BYS.map(value => ({ value, label: byLabel[value] }))}
                value={by}
                onSelect={value => void update($, view, current => ({ ...current, by: value, item: '' }))}
              />
            </Box>
            {rows.map(row => {
              // A Button holds only text, so the name is the button and the bar sits beside it.
              const name = (
                <Box flexGrow={1} flexShrink={1}>
                  <Button key={`row:${row.key}`} plain onPress={() => void update($, view, current => ({ ...current, item: row.key }))}>
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
                {pick(lang, { en: 'Tab moves · Enter opens a row · Esc closes', 'zh-TW': 'Tab 移動 · Enter 打開一列 · Esc 關閉' })}
              </Text>
            </Box>
          </Box>
        )}
      </Box>
    )
  })
}
