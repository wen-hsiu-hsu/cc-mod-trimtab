import type { AgentStatus, On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { elapsed, redispatchPrompt } from './register'

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
  on('session.repo', () => ({ value: null }))
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

test('shows a launched agent above the prompt and the stop once it is killed', async ($, on) => {
  const status: { value: AgentStatus } = { value: 'running' }
  const clock = engine(on, status)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Agent', description: 'review', prompt: 'review the diff', model: 'sonnet' })

  const ui = await $.ui.mount({ plugin: 'agent-dispatch', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /1 個背景 agent 執行中/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /review · general-purpose\/sonnet/ })).toBeDefined()
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
  const ui = await $.ui.mount({ plugin: 'agent-dispatch', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /1 background agent\(s\) running/ })).toBeDefined()
  await ui.unmount()
  status.value = 'killed'
  await clock.advance(3000)
  const after = await $.ui.mount({ plugin: 'agent-dispatch', surface: 'terminal', ...BAND } as never)
  expect(await after.find({ type: 'Text', text: /1 agent\(s\) interrupted: review/ })).toBeDefined()
  expect(await after.find({ key: 'redispatch', text: 'Redispatch' })).toBeDefined()
  await after.unmount()
  const run = (args: string) => $.command.run({ command: 'agent-dispatch', args } as never)
  expect((await run('')).text).toBe('Usage: /agent-dispatch redispatch, /agent-dispatch stats [days], /agent-dispatch status')
})

describe('usage ledger', () => {
  const DAY = 86_400_000
  const TODAY = '2026-10-12'
  type World = ReturnType<typeof newWorld>

  async function spawn($: Parameters<Parameters<typeof test>[1]>[0], world: World, args: Record<string, unknown>, agentId: string): Promise<void> {
    world.agentId = agentId
    world.spawnModel = typeof args.model === 'string' ? `claude-${args.model}-4` : 'claude-sonnet-4-6'
    await $.agent.spawn({ prompt: 'p', description: 'd', subagentType: 'general-purpose', ...args } as never)
  }

  async function step($: Parameters<Parameters<typeof test>[1]>[0], model: string, agentId?: string): Promise<void> {
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model, messageCount: 1, ...(agentId ? { agentId } : {}) })) {
      // drain the stream
    }
  }

  type Stored = { updated: number; steps: Record<string, Record<string, Record<string, number>>>; spawns: Record<string, Record<string, number>>; counts: Record<string, Record<string, number>>; opus: { day: string; type: string; description: string }[]; agents: Record<string, { type: string; model: string }> }
  const read = (world: World, id: string) => world.store[`ledger:${id}`] as Stored

  test('attributes steps to the main thread, a spawned type and unknown agents', async ($, on) => {
    const world = newWorld()
    engine(on, { value: 'running' }, '', world)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await step($, 'claude-opus-4')
    await spawn($, world, { subagentType: 'Explore' }, 'x1')
    await step($, 'claude-sonnet-4-6', 'x1')
    await step($, 'claude-sonnet-4-6', 'never-seen')

    const ledger = read(world, 's1')
    expect(ledger.updated).toBe(world.now)
    expect(ledger.steps[TODAY]['main|claude-opus-4']).toEqual({ input: 100, cacheWrite: 10, cacheRead: 1000, output: 50, steps: 1 })
    expect(ledger.steps[TODAY]['Explore|claude-sonnet-4-6']?.steps).toBe(1)
    expect(ledger.steps[TODAY]['unknown|claude-sonnet-4-6']?.steps).toBe(1)
    expect(ledger.spawns[TODAY]['Explore|claude-sonnet-4-6']).toBe(1)
    expect(ledger.agents.x1).toEqual({ type: 'Explore', model: 'claude-sonnet-4-6' })
  })

  test('counts explicit models, explicit Opus and forks', async ($, on) => {
    const world = newWorld()
    engine(on, { value: 'running' }, '', world)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await spawn($, world, { description: 'deep review', model: 'opus' }, 'a1')
    await spawn($, world, { description: 'quick', model: 'haiku' }, 'a2')
    await spawn($, world, { description: 'default' }, 'a3')
    await spawn($, world, { subagentType: 'fork', description: 'forked' }, 'a4')
    await step($, 'claude-sonnet-4-6', 'a4')

    const ledger = read(world, 's1')
    expect(ledger.counts[TODAY]).toEqual({ explicit: 2, opus: 1, forks: 1 })
    expect(ledger.opus).toEqual([{ day: TODAY, type: 'general-purpose', description: 'deep review' }])
    expect(ledger.steps[TODAY]['fork|claude-sonnet-4-6']?.steps).toBe(1)
  })

  test('two sessions keep their own keys', async ($, on) => {
    const world = newWorld()
    engine(on, { value: 'running' }, '', world)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await step($, 'claude-opus-4')
    world.sid = 's2'
    await step($, 'claude-opus-4')
    await step($, 'claude-opus-4')

    expect(read(world, 's1').steps[TODAY]['main|claude-opus-4']?.steps).toBe(1)
    expect(read(world, 's2').steps[TODAY]['main|claude-opus-4']?.steps).toBe(2)
  })

  test('parallel subagent steps do not lose updates', async ($, on) => {
    const world = newWorld()
    engine(on, { value: 'running' }, '', world)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await Promise.all([step($, 'claude-opus-4'), step($, 'claude-opus-4'), step($, 'claude-opus-4')])

    expect(read(world, 's1').steps[TODAY]['main|claude-opus-4']?.steps).toBe(3)
  })

  test('prunes ledgers older than 90 days at session start', async ($, on) => {
    const world = newWorld()
    world.store = { 'ledger:old': { updated: world.now - 91 * DAY }, 'ledger:recent': { updated: world.now - 89 * DAY }, other: { updated: 0 } }
    engine(on, { value: 'running' }, '', world)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

    expect(world.store['ledger:old']).toBeUndefined()
    expect(world.store['ledger:recent']).toBeDefined()
    expect(world.store.other).toBeDefined()
  })

  test('records nothing when ledger is false', async ($, on) => {
    const world = newWorld()
    engine(on, { value: 'running' }, '', world)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await $.command.run({ command: 'agent-dispatch', args: 'set ledger false' } as never)
    await step($, 'claude-opus-4')
    await spawn($, world, { model: 'opus' }, 'a1')

    expect(world.store['ledger:s1']).toBeUndefined()
  })

  test('/agent-dispatch stats sums every session in the window', async ($, on) => {
    const world = newWorld()
    // Seven days ago: inside 30 days, outside 3.
    world.store = {
      'ledger:s3': {
        updated: new Date(2026, 9, 5).getTime(),
        steps: { '2026-10-05': { 'main|claude-haiku-4-5': { input: 1000, cacheWrite: 0, cacheRead: 0, output: 0, steps: 1 } } },
        spawns: {},
        counts: {},
        opus: [],
        agents: {},
      },
    }
    engine(on, { value: 'running' }, '', world)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await step($, 'claude-opus-4')
    await spawn($, world, { model: 'opus', description: 'deep review' }, 'a1')
    await step($, 'claude-opus-4', 'a1')
    await step($, 'claude-opus-4', 'a1')
    world.sid = 's2'
    await spawn($, world, { subagentType: 'fork' }, 'f1')
    await step($, 'claude-sonnet-4-6', 'f1')

    const run = (args: string) => $.command.run({ command: 'agent-dispatch', args } as never)
    const text = (await run('stats')).text as string
    // 4 steps of 160 tokens plus 1000 of haiku; subagents are 3 of the 160-token steps
    expect(text).toContain('1,640')
    expect(text).toContain('claude-haiku-4-5')
    expect(text).toContain('general-purpose')
    expect(text).toContain('explicit model 1/2')
    expect(text).toContain('explicit Opus 1')
    expect(text).toContain('forks 1')
    expect(text).toContain('deep review')

    const short = (await run('stats 3')).text as string
    expect(short).not.toContain('claude-haiku-4-5')
    expect(short).toContain('480')
    expect(short).toContain('75%')
    expect((await run('stats 0')).text).toMatch(/1.*90/)
    expect((await run('stats abc')).text).toMatch(/1.*90/)
  })

  test('stats says so when the ledger is empty, in the set language', async ($, on) => {
    engine(on, { value: 'running' })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    expect((await $.command.run({ command: 'agent-dispatch', args: 'stats' } as never)).text).toMatch(/^還沒有用量紀錄/)
  })
})
