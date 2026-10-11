import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { WatchedAgent } from '../types'
import { configCommand, LANGUAGE, loadConfig, pick, type ConfigIO, type Lang, type Specs } from './config'
import {
  DEFAULT_DAYS,
  emptyLedger,
  LEDGER_PREFIX,
  LEDGER_SPEC,
  MAX_DAYS,
  recordSpawn,
  recordStep,
  renderStats,
  RETENTION_MS,
  type Ledger,
} from './ledger'

const running = atom({ plugin: 'agent-dispatch', key: 'running' } as const, [])
const stopped = atom({ plugin: 'agent-dispatch', key: 'stopped' } as const, [])
const now = atom({ plugin: 'agent-dispatch', key: 'now' } as const, 0)

const MOD = 'agent-dispatch'
const REDISPATCH = 'redispatch'
const STATS = 'stats'
const SPECS: Specs = { ledger: LEDGER_SPEC, language: LANGUAGE }
const POLL_MS = 3000
const STOPPED = new Set(['killed', 'failed'])
const FINISHED = new Set(['completed', 'idle'])

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) {
    return `${s}s`
  }
  const m = Math.floor(s / 60)
  if (m < 60) {
    return `${m}m${String(s % 60).padStart(2, '0')}s`
  }

  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

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
  const at = await $.clock.now()
  await update($, now, () => at)
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

type LedgerState = { recording: boolean; writing: Promise<void> }

// Applies `change` to this session's own ledger key. Parallel subagents step at the same time and
// each write reads the ledger back, so they take turns. Bookkeeping must never break the engine's call.
function record($: EngineInterface, state: LedgerState, where: string, change: (ledger: Ledger, at: number) => void): Promise<void> {
  if (!state.recording) {
    return Promise.resolve()
  }
  state.writing = state.writing.then(async () => {
    try {
      const key = `${LEDGER_PREFIX}${await $.session.id()}`
      const ledger = { ...emptyLedger(), ...((await $.store.get(key)) as Partial<Ledger> | undefined) }
      change(ledger, await $.clock.now())
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

async function statsText($: EngineInterface, lang: Lang, arg: string | undefined): Promise<string> {
  const days = arg === undefined ? DEFAULT_DAYS : Number(arg)
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return pick(lang, {
      en: `Usage: /${MOD} ${STATS} [days], days from 1 to ${MAX_DAYS} (default ${DEFAULT_DAYS})`,
      'zh-TW': `用法：/${MOD} ${STATS} [天數]，天數 1 到 ${MAX_DAYS}（預設 ${DEFAULT_DAYS}）`,
    })
  }
  const keys = (await $.store.keys()).filter(name => name.startsWith(LEDGER_PREFIX))
  const stored = await Promise.all(keys.map(key => $.store.get(key)))

  return renderStats(lang, stored, days, await $.clock.now())
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
  const ledger: LedgerState = { recording: true, writing: Promise.resolve() }

  on('session.start', async ($, e, next) => {
    try {
      const config = await loadConfig(configIO($), MOD, SPECS, options)
      lang = config.lang
      ledger.recording = config.values.ledger !== false
    } catch (error) {
      $.ui.log(`session.start: settings not read: ${String(error)}`, { to: 'debug' })
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
        argumentHint: 'redispatch | stats [days] | status',
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
    const [command, arg] = e.args.trim().split(/\s+/)
    if (command === STATS) {
      return { text: await statsText($, lang, arg) }
    }
    const text = await configCommand(configIO($), MOD, SPECS, options, e.args, resolved => {
      lang = resolved.lang
      ledger.recording = resolved.values.ledger !== false
    })

    return {
      text:
        text ??
        pick(lang, {
          en: `Usage: /${MOD} ${REDISPATCH}, /${MOD} ${STATS} [days], /${MOD} status`,
          'zh-TW': `用法：/${MOD} ${REDISPATCH}、/${MOD} ${STATS} [天數]、/${MOD} status`,
        }),
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if ('deny' in spawned) {
      return spawned
    }
    await record($, ledger, 'agent.spawn', (entries, at) =>
      recordSpawn(entries, at, {
        ...(spawned.agentId === undefined ? {} : { agentId: spawned.agentId }),
        type: e.subagentType,
        model: spawned.model,
        ...(e.model === undefined ? {} : { requested: e.model }),
        fork: e.fork || e.subagentType === 'fork',
        description: e.description,
      }),
    )

    return spawned
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
      await update($, now, () => agent.startedAt)
      await showStatus($, lang)
    }

    return ran
  }).catch(($, e, next) => next(e))

  // The band is one instance shared by every plugin: draw above what the plugins beneath drew
  // (open-items), never in place of it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const agents = await read($, running)
    const lost = await read($, stopped)
    if (e.props.hasSurvey || (agents.length === 0 && lost.length === 0)) {
      return next(e)
    }
    const below = await next(e)
    const at = await read($, now)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {agents.length > 0 && (
          <Text>
            <Text color="yellow">
              {pick(lang, { en: `${agents.length} background agent(s) running`, 'zh-TW': `${agents.length} 個背景 agent 執行中` })}
            </Text>
            <Text dimColor> · {pick(lang, { en: 'typing is queued, Esc interrupts them', 'zh-TW': '打字會排隊，Esc 會中斷它們' })}</Text>
          </Text>
        )}
        {agents.map(agent => (
          <Text dimColor wrap="truncate-end">
            {'   '}
            {agent.description} · {label(agent)} · {elapsed(at - agent.startedAt)}
          </Text>
        ))}
        {lost.length > 0 && (
          <Box flexDirection="row">
            <Text color="red" wrap="truncate-end">
              {pick(lang, { en: `${lost.length} agent(s) interrupted`, 'zh-TW': `${lost.length} 個 agent 被中斷` })}
              {pick(lang, { en: ': ', 'zh-TW': '：' })}
              {lost.map(agent => agent.description).join(pick(lang, { en: ', ', 'zh-TW': '、' }))}{' '}
            </Text>
            <Button key="redispatch" label={pick(lang, { en: 'Redispatch', 'zh-TW': '重派' })} hotkey="r" onPress={() => void fillRedispatch($, lang)} />
            <Button key="dismiss" label={pick(lang, { en: 'Dismiss', 'zh-TW': '略過' })} hotkey="d" onPress={() => void update($, stopped, () => [])} />
          </Box>
        )}
        {below}
      </Box>
    )
  })
}
