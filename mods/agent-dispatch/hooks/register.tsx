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
  NOT_INCLUDED,
  sessionName,
  spawnLine,
  summaryLines,
  emptyText,
  emptyLedger,
  isLedger,
  LEDGER_PREFIX,
  LEDGER_SPEC,
  MAX_DAYS,
  promptSummary,
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
const BAR_CELLS = 20
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

type LedgerState = { recording: boolean; writing: Promise<void>; meta: SessionMeta }

// Applies `change` to this session's own ledger key. Parallel subagents step at the same time and
// each write reads the ledger back, so they take turns. Bookkeeping must never break the engine's call.
function record($: EngineInterface, state: LedgerState, where: string, change: (ledger: Ledger, at: number) => void): Promise<void> {
  if (!state.recording) {
    return Promise.resolve()
  }
  state.writing = state.writing.then(async () => {
    try {
      const key = `${LEDGER_PREFIX}${await $.session.id()}`
      const stored = await $.store.get(key)
      const ledger = isLedger(stored) ? { ...emptyLedger(), ...stored } : emptyLedger()
      change(ledger, await $.clock.now())
      applyMeta(ledger, state.meta)
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

function terminalBar(part: number, most: number): string {
  return part <= 0 ? '' : '█'.repeat(Math.max(1, Math.round((part / most) * BAR_CELLS)))
}

function svgBar(part: number, most: number): string {
  const width = part <= 0 ? 0 : Math.max(2, Math.round((part / most) * 160))

  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="10"><rect width="${width}" height="10" rx="2" fill="#5b8def"/></svg>`
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
  const ledger: LedgerState = { recording: true, writing: Promise.resolve(), meta: { repo: '', started: 0, prompt: '' } }

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

    return spawned
  })

  // The session is named after its first prompt; a resumed one keeps the name it has.
  on('prompt.submit', async ($, e, next) => {
    if (ledger.meta.prompt === '' && ['composer', 'bridge', 'sdk'].includes(e.origin.kind)) {
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const parts = $.ui.resolve(e)
    const { Box, Select, Text } = parts
    // Desktop draws the bars as Svg; the terminal has no Svg and gets character bars. The runtime
    // hands every constructor over, so the surface decides, not their presence.
    const Svg = e.surface !== 'terminal' && 'Svg' in parts ? parts.Svg : undefined
    const shown = await read($, view)
    const by = (GROUP_BYS as readonly string[]).includes(shown.by) ? (shown.by as GroupBy) : 'repo'
    const report = await loadReport($, shown.days)
    const rows = groups(lang, report, by)
    const most = Math.max(1, ...rows.map(row => row.tokens))
    const open = rows.find(row => row.key === shown.item)
    const byLabel: Record<GroupBy, string> = {
      repo: 'repo',
      session: 'session',
      model: pick(lang, { en: 'model', 'zh-TW': '模型' }),
      type: pick(lang, { en: 'agent type', 'zh-TW': 'agent 種類' }),
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Text bold>
            {pick(lang, { en: `${report.from} to ${report.to}`, 'zh-TW': `${report.from} 到 ${report.to}` })}
          </Text>
          <Select
            key="days"
            label={pick(lang, { en: 'Period: ', 'zh-TW': '期間：' })}
            options={PERIODS.map(days => ({ value: String(days), label: pick(lang, { en: `${days} days`, 'zh-TW': `${days} 天` }) }))}
            value={String(shown.days)}
            onSelect={value => void update($, view, current => ({ ...current, days: Number(value) }))}
          />
        </Box>
        {report.sessions.length === 0 ? (
          <Text dimColor>{emptyText(lang)}</Text>
        ) : (
          <Box flexDirection="column">
            <Box flexDirection="column" borderStyle="round" paddingX={1}>
              {summaryLines(lang, report).map(line => (
                <Text>{line}</Text>
              ))}
            </Box>
            <Select
              key="group"
              label={pick(lang, { en: 'Group by: ', 'zh-TW': '分組：' })}
              options={GROUP_BYS.map(value => ({ value, label: byLabel[value] }))}
              value={by}
              onSelect={value => void update($, view, current => ({ ...current, by: value, item: '' }))}
            />
            {rows.map(row => (
              <Box key={`row-${row.key}`} flexDirection="row" gap={1}>
                <Text wrap="truncate-end">{row.label.padEnd(28)}</Text>
                {Svg !== undefined ? (
                  <Svg source={svgBar(row.tokens, most)} alt={`${n(row.tokens)}`} width={160} height={10} />
                ) : (
                  <Text color="cyan">{terminalBar(row.tokens, most).padEnd(BAR_CELLS)}</Text>
                )}
                <Text dimColor>
                  {pick(lang, { en: `${n(row.tokens)} · ${row.spawns} spawn(s)`, 'zh-TW': `${n(row.tokens)} · 派出 ${row.spawns} 次` })}
                </Text>
              </Box>
            ))}
            <Select
              key="item"
              label={pick(lang, { en: 'Spawns of: ', 'zh-TW': '看明細：' })}
              options={rows.map(row => ({ value: row.key, label: row.label }))}
              {...(open === undefined ? {} : { value: open.key })}
              onSelect={value => void update($, view, current => ({ ...current, item: value }))}
            />
            {open?.detail.map(part => (
              <Box key={`detail-${part.session.repo}-${part.session.started}`} flexDirection="column">
                <Text bold wrap="truncate-end">
                  {sessionName(lang, part.session)}
                  {part.main > 0 ? pick(lang, { en: ` · main ${n(part.main)}`, 'zh-TW': ` · 主 ${n(part.main)}` }) : ''}
                </Text>
                {part.spawns.map(spawn => (
                  <Text wrap="truncate-end">  {spawnLine(lang, spawn)}</Text>
                ))}
              </Box>
            ))}
            <Text dimColor>{NOT_INCLUDED[lang]}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
