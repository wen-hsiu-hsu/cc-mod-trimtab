import type { AgentStatus, On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { elapsed } from './ledger'
import { redispatchPrompt } from './register'

describe('helpers', () => {
  test('formats elapsed time', () => {
    expect(elapsed(5_000)).toBe('5s')
    expect(elapsed(192_000)).toBe('3m12s')
    expect(elapsed(3_900_000)).toBe('1h05m')
  })

  test('lists stopped agents in the redispatch prompt', () => {
    const text = redispatchPrompt([
      { id: 'a1', description: 'review 程式碼', type: 'general-purpose', model: 'sonnet', startedAt: 0, status: 'killed' },
    ])
    expect(text).toContain('- review 程式碼 (general-purpose/sonnet, agent id a1)')
    expect(text).toContain('were just interrupted')
  })
})

// What the engine beneath answers: the session id, the clock, the next spawn's model and agent id, each step's usage.
function newWorld() {
  return {
    sid: 's1',
    store: {} as Record<string, unknown>,
    now: new Date(2026, 9, 12, 12).getTime(),
    spawnModel: 'claude-sonnet-4-6',
    agentId: 'a1' as string | undefined,
    repo: null as { root: string; remote: null; internal: false; name: null } | null,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10 },
  }
}

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } } as const

// The engine beneath: Agent launches in the background, and agent.list reports `status`.
// The suite asserts zh-TW wording, so the user settings file says zh-TW unless a test gives another.
function engine(on: On, status: { value: AgentStatus }, userFile = '{"*":{"language":"zh-TW"}}', world = newWorld()): ReturnType<typeof mock.clock> {
  const clock = mock.clock(on, { now: world.now })
  // mock.store, but with the entries in the test's hands so it can read what the plugin wrote.
  on('store.get', ($, e) => ({ value: world.store[e.key] }))
  on('store.set', ($, e) => ((world.store[e.key] = JSON.parse(JSON.stringify(e.value))), { value: undefined }))
  on('store.delete', ($, e) => (delete world.store[e.key], { value: undefined }))
  on('store.keys', () => ({ value: Object.keys(world.store) }))
  mock.env(on, {})
  on('session.id', () => ({ value: world.sid }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: world.repo }))
  on('fs.read', ($, e) => {
    if (e.path === '/.claude/cc-mod-trimtab.json') {
      return { value: userFile }
    }
    throw new Error('ENOENT')
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('session.surface', () => ({ value: 'terminal' }))
  on('tool.call', { tool: 'Agent' }, ($, e) => ({
    result: { status: 'async_launched', agentId: 'a1', description: e.description, prompt: e.prompt, outputFile: '/tmp/a1' },
  }))
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'review', type: 'general-purpose', status: status.value }],
  }))
  on('agent.spawn', ($, e) => ({ model: world.spawnModel, agentId: world.agentId }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...world.usage, model: e.model } }
  })
  // Another plugin's band beneath (open-items): it must stay visible under the agents.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>band beneath</Text>
  })

  return clock
}

test('draws nothing above the prompt while an agent runs, and the stop once it is killed', async ($, on) => {
  const status: { value: AgentStatus } = { value: 'running' }
  const clock = engine(on, status)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Agent', description: 'review', prompt: 'review the diff', model: 'sonnet' })

  const ui = await $.ui.mount({ plugin: 'agent-dispatch', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /執行中|Esc/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /review/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'band beneath' })).toBeDefined()
  await ui.unmount()

  status.value = 'killed'
  await clock.advance(3000)
  const after = await $.ui.mount({ plugin: 'agent-dispatch', surface: 'terminal', ...BAND } as never)
  expect(await after.find({ type: 'Text', text: /執行中/ })).toBeUndefined()
  expect(await after.find({ type: 'Text', text: /1 個 agent 被中斷：review/ })).toBeDefined()
  expect(await after.find({ key: 'redispatch' })).toBeDefined()
  expect(await after.find({ type: 'Text', text: 'band beneath' })).toBeDefined()
  await after.unmount()
})

test('/agent-dispatch redispatch and status', async ($, on) => {
  engine(on, { value: 'running' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const run = (args: string) => $.command.run({ command: 'agent-dispatch', args } as never)
  expect((await run('redispatch')).text).toBe('沒有被中斷的背景 agent。')
  expect((await run('status')).text).toMatch(/^agent-dispatch 設定[\s\S]*language = zh-TW {2}\[使用者\]/)
  expect((await run('')).text).toMatch(/^用法/)
})

test('the wording is English by default', async ($, on) => {
  const status: { value: AgentStatus } = { value: 'running' }
  const clock = engine(on, status, '')
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Agent', description: 'review', prompt: 'review the diff', model: 'sonnet' })
  status.value = 'killed'
  await clock.advance(3000)
  const after = await $.ui.mount({ plugin: 'agent-dispatch', surface: 'terminal', ...BAND } as never)
  expect(await after.find({ type: 'Text', text: /1 agent\(s\) interrupted: review/ })).toBeDefined()
  expect(await after.find({ key: 'redispatch', text: 'Redispatch' })).toBeDefined()
  await after.unmount()
  const run = (args: string) => $.command.run({ command: 'agent-dispatch', args } as never)
  expect((await run('')).text).toBe('Usage: /agent-dispatch redispatch, /agent-dispatch stats [--text] [days], /agent-dispatch status')
})

describe('usage ledger', () => {
  const DAY = 86_400_000
  type World = ReturnType<typeof newWorld>
  type T = Parameters<Parameters<typeof test>[1]>[0]

  async function spawn($: T, world: World, args: Record<string, unknown>, agentId: string): Promise<void> {
    world.agentId = agentId
    world.spawnModel = typeof args.model === 'string' ? `claude-${args.model}-4` : 'claude-sonnet-4-6'
    await $.agent.spawn({ prompt: 'p', description: 'd', subagentType: 'general-purpose', background: false, fork: false, ...args } as never)
  }

  async function step($: T, model: string, agentId?: string): Promise<void> {
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model, messageCount: 1, ...(agentId ? { agentId } : {}) })) {
      // drain the stream
    }
  }

  const start = ($: T) => $.session.start({ cwd: '/repo/wt', surface: 'terminal', isInteractive: true })
  const stats = async ($: T, args = 'stats --text') => (await $.command.run({ command: 'agent-dispatch', args } as never)).text as string
  const line = (text: string, has: string) => text.split('\n').find(row => row.includes(has)) ?? ''

  test('stats --text lists each spawn under its session and repo', async ($, on) => {
    const world = newWorld()
    const clock = engine(on, { value: 'running' }, '', world)
    world.repo = { root: '/repo', remote: null, internal: false, name: null }
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await start($)
    await $.prompt.submit({ text: 'review the diff and fix the flaky ledger test please', origin: { kind: 'composer' } } as never)
    await $.prompt.submit({ text: 'a later prompt', origin: { kind: 'composer' } } as never)
    await step($, 'claude-opus-4')
    await spawn($, world, { description: 'deep review', model: 'opus', background: true }, 'a1')
    await clock.advance(5_000)
    await step($, 'claude-opus-4', 'a1')
    await clock.advance(60_000)
    await step($, 'claude-opus-4', 'a1')
    await spawn($, world, { description: 'find usages', subagentType: 'Explore' }, 'x1')
    await step($, 'claude-sonnet-4-6', 'x1')
    await step($, 'claude-sonnet-4-6', 'never-seen')

    const text = await stats($)
    expect(text).toContain('/repo')
    expect(text).not.toContain('/repo/wt')
    expect(text).toContain('10-12 12:00 review the diff and fix the flaky ledger…')
    expect(text).not.toContain('a later prompt')
    const deep = line(text, 'deep review')
    expect(deep).toContain('general-purpose')
    expect(deep).toContain('opus → claude-opus-4')
    expect(deep).toContain('background')
    expect(deep).toContain('320 tokens')
    expect(deep).toContain('2 steps')
    expect(deep).toContain('1m05s')
    expect(line(text, 'find usages')).toContain('Explore')
    expect(line(text, 'find usages')).toContain('default → claude-sonnet-4-6')
    expect(text).toContain('unknown')
  })

  test('stats --text counts explicit models, explicit Opus, forks and defaults', async ($, on) => {
    const world = newWorld()
    engine(on, { value: 'running' }, '', world)
    await start($)
    await spawn($, world, { description: 'deep review', model: 'opus' }, 'a1')
    await spawn($, world, { description: 'quick', model: 'haiku' }, 'a2')
    await spawn($, world, { description: 'default' }, 'a3')
    await spawn($, world, { subagentType: 'fork', description: 'forked', fork: true }, 'a4')
    await step($, 'claude-sonnet-4-6', 'a4')

    const text = await stats($)
    expect(text).toContain('Spawns: 4 (explicit model 2/4, explicit Opus 1, forks 1, default model 50%)')
    expect(line(text, 'forked')).toContain('fork')
    expect(line(text, 'forked')).toContain('160 tokens')
  })

  test('two sessions and parallel steps each keep every step', async ($, on) => {
    const world = newWorld()
    engine(on, { value: 'running' }, '', world)
    await start($)
    await Promise.all([step($, 'claude-opus-4'), step($, 'claude-opus-4'), step($, 'claude-opus-4')])
    world.sid = 's2'
    await step($, 'claude-opus-4')

    const text = await stats($)
    expect(text).toContain('main session  640')
    expect(line(text, 'claude-opus-4')).toContain('640')
  })

  test('keeps at most 500 spawns per session, newest kept', async ($, on) => {
    const world = newWorld()
    engine(on, { value: 'running' }, '', world)
    await start($)
    for (let i = 0; i < 502; i++) {
      await spawn($, world, { description: `task ${i}` }, `a${i}`)
    }
    const spawns = (world.store['ledger:s1'] as { spawns: { description: string }[] }).spawns
    expect(spawns.length).toBe(500)
    expect(spawns[0]?.description).toBe('task 2')
    expect(spawns[499]?.description).toBe('task 501')
  })

  test('prunes ledgers older than 90 days at session start', async ($, on) => {
    const world = newWorld()
    world.store = { 'ledger:old': { updated: world.now - 91 * DAY }, 'ledger:recent': { updated: world.now - 89 * DAY }, other: { updated: 0 } }
    engine(on, { value: 'running' }, '', world)
    await start($)

    expect(world.store['ledger:old']).toBeUndefined()
    expect(world.store['ledger:recent']).toBeDefined()
    expect(world.store.other).toBeDefined()
  })

  test('records nothing when ledger is false', async ($, on) => {
    const world = newWorld()
    engine(on, { value: 'running' }, '', world)
    await start($)
    await $.command.run({ command: 'agent-dispatch', args: 'set ledger false' } as never)
    await step($, 'claude-opus-4')
    await spawn($, world, { model: 'opus' }, 'a1')

    expect(world.store['ledger:s1']).toBeUndefined()
  })

  test('stats --text sums every session in the window', async ($, on) => {
    const world = newWorld()
    const tally = { input: 1000, cacheWrite: 0, cacheRead: 0, output: 0, steps: 1 }
    // Seven days ago: inside 30 days, outside 3.
    const then = new Date(2026, 9, 5, 9).getTime()
    world.store = {
      'ledger:s3': {
        updated: then,
        repo: '/old',
        started: then,
        prompt: 'last week',
        main: { 'claude-haiku-4-5': tally },
        spawns: [{ at: then, last: then, description: 'old task', type: 'Explore', model: 'claude-haiku-4-5', fork: false, background: false, ...tally }],
      },
    }
    engine(on, { value: 'running' }, '', world)
    await start($)
    await step($, 'claude-opus-4')
    await spawn($, world, { model: 'opus', description: 'deep review' }, 'a1')
    await step($, 'claude-opus-4', 'a1')

    const text = await stats($)
    // 2 steps of 160 tokens plus 2000 of haiku
    expect(text).toContain('2,320')
    expect(text).toContain('old task')
    expect(text).toContain('/old')

    const short = await stats($, 'stats --text 3')
    expect(short).not.toContain('old task')
    expect(short).toContain('320')
    expect(short).toContain('50%')
    expect(await stats($, 'stats --text 0')).toMatch(/1.*90/)
    expect(await stats($, 'stats --text abc')).toMatch(/1.*90/)
  })

  test('stats --text says so when the ledger is empty, in the set language', async ($, on) => {
    engine(on, { value: 'running' })
    await start($)
    expect(await stats($)).toMatch(/^還沒有用量紀錄/)
  })
})
