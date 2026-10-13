import type { AgentStatus, On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { cells, elapsed, fit } from './ledger'
import { redispatchPrompt } from './register'

describe('helpers', () => {
  test('fits text to a width in terminal cells, CJK counting two', () => {
    expect(cells('ok 中文')).toBe(7)
    expect(fit('ok 中文', 7)).toBe('ok 中文')
    expect(fit('ok 中文字', 7)).toBe('ok 中…')
    expect(cells(fit('調整 stats 介面', 8))).toBeLessThanOrEqual(8)
  })
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
    // What ui.open answers, and the panes opened and closed.
    placed: true,
    opened: [] as string[],
    closed: [] as string[],
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
  on('ui.open', ($, e) => (world.opened.push(e.id), { value: world.placed ? { isPlaced: true } : { isPlaced: false, reason: 'narrow' } }) as never)
  on('ui.close', ($, e) => (world.closed.push(e.id), { value: undefined }))
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

  const ui = await $.ui.mount({ plugin: 'subagent-dispatch', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /執行中|Esc/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /review/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'band beneath' })).toBeDefined()
  await ui.unmount()

  status.value = 'killed'
  await clock.advance(3000)
  const after = await $.ui.mount({ plugin: 'subagent-dispatch', surface: 'terminal', ...BAND } as never)
  expect(await after.find({ type: 'Text', text: /執行中/ })).toBeUndefined()
  expect(await after.find({ type: 'Text', text: /1 個 agent 被中斷：review/ })).toBeDefined()
  expect(await after.find({ key: 'redispatch' })).toBeDefined()
  expect(await after.find({ type: 'Text', text: 'band beneath' })).toBeDefined()
  await after.unmount()
})

test('/subagent-dispatch redispatch and status', async ($, on) => {
  engine(on, { value: 'running' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const run = (args: string) => $.command.run({ command: 'subagent-dispatch', args } as never)
  expect((await run('redispatch')).text).toBe('沒有被中斷的背景 agent。')
  expect((await run('status')).text).toMatch(/^subagent-dispatch 設定[\s\S]*language = zh-TW {2}\[使用者\]/)
  expect((await run('')).text).toMatch(/^用法/)
})

test('the wording is English by default', async ($, on) => {
  const status: { value: AgentStatus } = { value: 'running' }
  const clock = engine(on, status, '')
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Agent', description: 'review', prompt: 'review the diff', model: 'sonnet' })
  status.value = 'killed'
  await clock.advance(3000)
  const after = await $.ui.mount({ plugin: 'subagent-dispatch', surface: 'terminal', ...BAND } as never)
  expect(await after.find({ type: 'Text', text: /1 agent\(s\) interrupted: review/ })).toBeDefined()
  expect(await after.find({ key: 'redispatch', text: 'Redispatch' })).toBeDefined()
  await after.unmount()
  const run = (args: string) => $.command.run({ command: 'subagent-dispatch', args } as never)
  expect((await run('')).text).toBe('Usage: /subagent-dispatch redispatch, /subagent-dispatch stats [--text] [days], /subagent-dispatch status')
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
  const stats = async ($: T, args = 'stats --text') => (await $.command.run({ command: 'subagent-dispatch', args } as never)).text as string
  const line = (text: string, has: string) => text.split('\n').find(row => row.includes(has)) ?? ''

  test('stats --text lists each spawn under its session and repo', async ($, on) => {
    const world = newWorld()
    const clock = engine(on, { value: 'running' }, '', world)
    world.repo = { root: '/repo', remote: null, internal: false, name: null }
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await start($)
    await $.prompt.submit({ text: '/subagent-dispatch stats', origin: { kind: 'composer' } } as never)
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
    expect(text).toContain('Sep 13 – Oct 12')
    expect(text).toContain('Oct 12 12:00 review the diff and fix the flaky ledger…')
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
    expect(text).toContain('Spawns: 4 (named a model 2, Opus among them 1; default model 1; fork 1)')
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

  test('a session after /clear is named after its own start and first prompt', async ($, on) => {
    const world = newWorld()
    const clock = engine(on, { value: 'running' }, '', world)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await start($)
    await $.prompt.submit({ text: 'first task', origin: { kind: 'composer' } } as never)
    await step($, 'claude-opus-4')
    // /clear: a new session id in the same process, with no session.start.
    world.sid = 's2'
    await clock.advance(5 * 60_000)
    await $.prompt.submit({ text: 'second task', origin: { kind: 'composer' } } as never)
    await step($, 'claude-opus-4')

    const text = await stats($)
    expect(text).toContain('Oct 12 12:00 first task')
    expect(text).toContain('Oct 12 12:05 second task')
    expect(text).not.toContain('12:00 second task')
    expect(text).not.toContain('12:05 first task')
  })

  test('steps of an agent that outlives /clear stay on its spawn', async ($, on) => {
    const world = newWorld()
    engine(on, { value: 'running' }, '', world)
    await start($)
    await spawn($, world, { description: 'long review', background: true }, 'a1')
    world.sid = 's2'
    await step($, 'claude-sonnet-4-6', 'a1')

    const text = await stats($)
    expect(line(text, 'long review')).toContain('1 steps')
    expect(text).not.toContain('unknown')
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

  test('replaces a ledger of the old 0.2.0 format under its own key', async ($, on) => {
    const world = newWorld()
    world.store = { 'ledger:s1': { updated: world.now, steps: {}, spawns: { '2026-10-12': { 'general-purpose|claude-haiku-4-5': 2 } }, counts: {}, opus: [], agents: {} } }
    engine(on, { value: 'running' }, '', world)
    await start($)
    await spawn($, world, { description: 'after the upgrade' }, 'a1')
    await step($, 'claude-sonnet-4-6', 'a1')

    expect(line(await stats($), 'after the upgrade')).toContain('1 steps')
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
    await $.command.run({ command: 'subagent-dispatch', args: 'set ledger false' } as never)
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

  test('stats --text writes dates the zh-TW way', async ($, on) => {
    const world = newWorld()
    engine(on, { value: 'running' }, undefined, world)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await start($)
    await $.prompt.submit({ text: 'first task', origin: { kind: 'composer' } } as never)
    await step($, 'claude-opus-4')

    const text = await stats($)
    expect(text).toContain('9/13 至 10/12')
    expect(text).toContain('10/12 12:00 first task')
  })

  test('stats --text says so when the ledger is empty, in the set language', async ($, on) => {
    engine(on, { value: 'running' })
    await start($)
    expect(await stats($)).toMatch(/^還沒有用量紀錄/)
  })

  // Presses a terminal switch until it shows `label`.
  async function choose(pane: { find: (query: object) => Promise<{ text: string } | undefined>; press: (query: object) => Promise<unknown> }, key: string, label: string): Promise<void> {
    for (let i = 0; i < 5 && !(await pane.find({ key }))?.text.includes(`‹ ${label} ›`); i++) {
      await pane.press({ key })
    }
  }

  const PANE = { plugin: 'subagent-dispatch', component: 'Pane', requestId: 'subagent-dispatch-stats', props: { title: 'stats', isFocused: true, bodyColumns: 100, placement: 'dock' } } as const

  // Today: a main step and an Opus review in /repo; a week ago: a haiku Explore in /old.
  async function twoWeeks($: T, on: On, surface: 'terminal' | 'desktop' = 'terminal', isInteractive = true): Promise<World> {
    const world = newWorld()
    const then = new Date(2026, 9, 5, 9).getTime()
    const tally = { input: 1000, cacheWrite: 0, cacheRead: 0, output: 0, steps: 1 }
    world.store = {
      'ledger:s3': {
        updated: then,
        repo: '/old',
        started: then,
        prompt: 'last week',
        main: {},
        spawns: [{ at: then, last: then, description: 'old task', type: 'Explore', model: 'claude-haiku-4-5', fork: false, background: false, ...tally }],
      },
    }
    world.repo = { root: '/repo', remote: null, internal: false, name: null }
    engine(on, { value: 'running' }, '', world)
    await $.session.start({ cwd: '/repo', surface, isInteractive })
    await step($, 'claude-opus-4')
    await spawn($, world, { model: 'opus', description: 'deep review' }, 'a1')
    await step($, 'claude-opus-4', 'a1')

    return world
  }

  test('stats opens a pane: summary, rows that open to each spawn, and the period', async ($, on) => {
    const world = await twoWeeks($, on)
    await stats($, 'stats')
    expect(world.opened).toEqual(['subagent-dispatch-stats'])

    for (const bodyColumns of [52, 110]) {
      const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' } as never)
      expect(await pane.find({ type: 'Text', text: 'Sep 13 – Oct 12' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: '1,320' })).toBeDefined()
      // Grouped by repo by default, named by the folder; bars are colored spaces, never '█'.
      expect(await pane.find({ key: 'row:/repo' })).toBeDefined()
      expect(await pane.find({ key: 'row:/old' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /█/ })).toBeUndefined()
      expect(await pane.find({ type: 'Text', text: /deep review/ })).toBeUndefined()
      await pane.unmount()
    }

    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
    await choose(pane, 'group', 'model')
    await pane.press({ key: 'row:claude-opus-4' })
    expect(await pane.find({ type: 'Text', text: 'deep review' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /old task/ })).toBeUndefined()
    expect(await pane.find({ key: 'row:claude-opus-4' })).toBeUndefined()

    await pane.press({ key: 'back' })
    expect(await pane.find({ type: 'Text', text: 'deep review' })).toBeUndefined()
    await choose(pane, 'group', 'type')
    await pane.press({ key: 'row:Explore' })
    expect(await pane.find({ type: 'Text', text: 'old task' })).toBeDefined()

    await pane.press({ key: 'back' })
    await choose(pane, 'days', '7 days')
    expect(await pane.find({ key: 'row:Explore' })).toBeUndefined()
    await choose(pane, 'days', '30 days')
    await choose(pane, 'group', 'session')
    expect(await pane.find({ type: 'Text', text: 'last week' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'Oct 5 09:00 · old' })).toBeDefined()
    await pane.unmount()
  })

  test('stats heads the pane with its name, keeps only unshown keys in the hint, and lists the sessions of a main-only model', async ($, on) => {
    await twoWeeks($, on)
    await step($, 'claude-sonnet-4')
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
    expect(await pane.find({ type: 'Text', text: 'subagent-dispatch stats' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /p period/ })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: 'Enter opens a row' })).toBeDefined()

    await choose(pane, 'group', 'model')
    await pane.press({ key: 'row:claude-sonnet-4' })
    expect((await pane.find({ key: 'list-columns' }))?.text).toMatch(/session/)
    expect(await pane.find({ type: 'Text', text: /s sorts|Back \(b\)/ })).toBeUndefined()
    // The back button shows its key, and the crumb keeps its width beside a long name.
    expect((await pane.find({ key: 'back' }))?.props.hotkey).toBe('b')
    await pane.unmount()
  })

  test('an open pane redraws a second after a step lands, once for steps in that second', async ($, on) => {
    const world = newWorld()
    const clock = engine(on, { value: 'running' }, '', world)
    await start($)
    await step($, 'claude-opus-4')
    await stats($, 'stats')
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
    expect(await pane.find({ type: 'Text', text: '160' })).toBeDefined()

    await step($, 'claude-opus-4')
    await step($, 'claude-opus-4')
    expect(await pane.find({ type: 'Text', text: '160' })).toBeDefined()
    await clock.advance(1000)
    expect(await pane.find({ type: 'Text', text: '480' })).toBeDefined()
    expect((await pane.find({ key: 'cache-read' }))?.text).toMatch(/Updated 12:00:01$/)
    await pane.unmount()
  })

  test('stats prints the text report where the pane cannot be placed, and closes it', async ($, on) => {
    const world = newWorld()
    world.placed = false
    engine(on, { value: 'running' }, '', world)
    await start($)
    await step($, 'claude-opus-4')
    const text = await stats($, 'stats')
    expect(text).toContain('Sessions')
    expect(world.opened).toEqual(['subagent-dispatch-stats'])
    expect(world.closed).toEqual(['subagent-dispatch-stats'])
  })

  test('stats prints the text report in a -p run without opening a pane', async ($, on) => {
    const world = await twoWeeks($, on, 'terminal', false)
    expect(await stats($, 'stats')).toContain('old task')
    expect(world.opened).toEqual([])
  })

  test('the overview has a token card and a spawns card whose three kinds add up', async ($, on) => {
    const world = newWorld()
    engine(on, { value: 'running' }, '', world)
    await start($)
    await step($, 'claude-sonnet-4-6')
    await spawn($, world, { description: 'deep review', model: 'opus' }, 'a1')
    await spawn($, world, { description: 'quick', model: 'haiku' }, 'a2')
    await spawn($, world, { description: 'default' }, 'a3')
    await spawn($, world, { subagentType: 'fork', description: 'forked', fork: true }, 'a4')
    await step($, 'claude-sonnet-4-6', 'a4')
    await stats($, 'stats')

    for (const bodyColumns of [52, 110]) {
      const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' } as never)
      const text = async (key: string) => (await pane.find({ key }))?.text ?? ''
      expect(await text('card:tokens')).toContain('320')
      expect(await text('card:tokens')).toContain('by subagents 50%')
      expect(await text('share:main')).toMatch(/main session.*160$/)
      expect(await text('share:sub')).toMatch(/subagent.*160$/)
      expect(await text('card:spawns')).toContain('where the model came from')
      expect(await text('spawned:named')).toMatch(/named a model \(Opus: 1\).*2$/)
      expect(await text('spawned:default')).toMatch(/default model.*1$/)
      expect(await text('spawned:fork')).toMatch(/fork \(main session's model\).*1$/)
      expect(await text('cache-read')).toMatch(/^Cache read 2,000, not counted.*Updated 12:00:00$/)
      expect((await pane.find({ key: 'cache-read' }))?.props.flexDirection).toBe('row')
      await pane.unmount()
    }
    // Too narrow for both: the time goes on the next line, at the left.
    const narrow = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 40 }, surface: 'terminal' } as never)
    expect((await narrow.find({ key: 'cache-read' }))?.props.flexDirection).toBe('column')
    await narrow.unmount()
  })

  // One session today with twelve haiku spawns: task i used (i + 1) thousand tokens, started i
  // minutes after 10:00 and ran 12 - i minutes; the even ones named their model.
  async function busyDay($: T, on: On): Promise<World> {
    const world = newWorld()
    const nine = new Date(2026, 9, 12, 9).getTime()
    const spawns = Array.from({ length: 12 }, (_, i) => {
      const at = nine + 3_600_000 + i * 60_000

      return {
        agentId: `a${i}`,
        at,
        last: at + (12 - i) * 60_000,
        description: `task ${i}`,
        type: 'general-purpose',
        model: 'claude-haiku-4-5',
        ...(i % 2 === 0 ? { requested: 'haiku' } : {}),
        fork: false,
        background: i === 0,
        input: (i + 1) * 1000,
        cacheWrite: 0,
        cacheRead: 0,
        output: 0,
        steps: 3,
      }
    })
    world.store = { 'ledger:s9': { updated: world.now, repo: '/repo', started: nine, prompt: 'a busy day', main: {}, spawns } }
    engine(on, { value: 'running' }, '', world)
    await start($)
    await stats($, 'stats')

    return world
  }

  const tasks = async (pane: { findAll: (query: object) => Promise<{ text: string }[]> }) =>
    (await pane.findAll({ type: 'Text', text: /^task \d+$/ })).map(found => found.text)

  test('an opened row lists its spawns as a table, most tokens first, ten before "more"', async ($, on) => {
    await busyDay($, on)
    const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 52 }, surface: 'terminal' } as never)
    await choose(pane, 'group', 'model')
    await pane.press({ key: 'row:claude-haiku-4-5' })
    expect(await tasks(pane)).toEqual(['task 11', 'task 10', 'task 9', 'task 8', 'task 7', 'task 6', 'task 5', 'task 4', 'task 3', 'task 2'])
    // A dot in the color of where its model came from, and the day it ran.
    const dot = async (id: string) => (await pane.find({ key: `dot:${id}` }))?.children[0] as { props: { color?: string } } | undefined
    expect((await dot('a10'))?.props.color).toBe('yellow')
    expect((await dot('a9'))?.props.color).toBe('gray')
    expect((await pane.find({ key: 'line:a9' }))?.text).toMatch(/task 9.*10,000.*Oct 12/)
    expect((await pane.find({ key: 'more' }))?.text).toContain('2 more')
    // "More" is a way around the pane, not something waiting on the user: no yellow.
    expect(((await pane.find({ key: 'more' }))?.children[0] as { props?: { color?: string } } | undefined)?.props?.color).toBeUndefined()
    expect((await pane.find({ key: 'more' }))?.props.hotkey).toBe('m')

    await pane.press({ key: 'more' })
    expect(await tasks(pane)).toHaveLength(12)
    expect(await pane.find({ key: 'more' })).toBeUndefined()
    await pane.unmount()
  })

  test('an opened row sorts by time or by how long a spawn ran', async ($, on) => {
    await busyDay($, on)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
    await choose(pane, 'group', 'model')
    await pane.press({ key: 'row:claude-haiku-4-5' })
    await choose(pane, 'sort', 'time')
    expect((await tasks(pane)).slice(0, 2)).toEqual(['task 11', 'task 10'])
    await choose(pane, 'sort', 'duration')
    expect((await tasks(pane)).slice(0, 2)).toEqual(['task 0', 'task 1'])
    // Back and into the row again starts from most tokens.
    await pane.press({ key: 'back' })
    await pane.press({ key: 'row:claude-haiku-4-5' })
    expect((await pane.find({ key: 'sort' }))?.text).toContain('‹ most tokens ›')
    await pane.unmount()
  })
  test('a spawn opens in place to its type, model, run and session, one at a time', async ($, on) => {
    await busyDay($, on)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
    await choose(pane, 'group', 'model')
    await pane.press({ key: 'row:claude-haiku-4-5' })
    await choose(pane, 'sort', 'duration')
    expect(await pane.find({ key: 'detail:a0' })).toBeUndefined()

    await pane.press({ key: 'spawn:a0' })
    const detail = async (id: string, line: string) => (await pane.find({ key: `detail:${id}:${line}` }))?.text ?? ''
    expect(await detail('a0', 'type')).toMatch(/Type\s*general-purpose/)
    expect(await detail('a0', 'model')).toMatch(/Model\s*named haiku → claude-haiku-4-5/)
    expect(await detail('a0', 'run')).toMatch(/Run\s*background · 3 steps · 12m00s/)
    expect(await detail('a0', 'session')).toMatch(/session\s*Oct 12 09:00 a busy day/)

    await pane.press({ key: 'spawn:a1' })
    expect(await pane.find({ key: 'detail:a0:type' })).toBeUndefined()
    expect(await detail('a1', 'model')).toMatch(/Model\s*default → claude-haiku-4-5/)
    expect(await detail('a1', 'run')).toMatch(/Run\s*3 steps · 11m00s/)
    await pane.press({ key: 'spawn:a1' })
    expect(await pane.find({ key: 'detail:a1:type' })).toBeUndefined()
    await pane.unmount()
  })
  test('an opened row sums its own tokens and spawns in two cards', async ($, on) => {
    await busyDay($, on)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
    await choose(pane, 'group', 'model')
    await pane.press({ key: 'row:claude-haiku-4-5' })
    const text = async (key: string) => (await pane.find({ key }))?.text ?? ''
    expect(await text('card:tokens')).toMatch(/78,000 token.*by subagents 100%/)
    expect(await text('card:spawns')).toMatch(/12 spawns/)
    expect(await text('card:spawns')).toMatch(/named 6 \(Opus: 0\).*default 6.*fork 0/)
    await pane.unmount()
  })

  test('the main session row of the type grouping lists each session\'s own tokens', async ($, on) => {
    await twoWeeks($, on)
    await stats($, 'stats')
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
    await choose(pane, 'group', 'type')
    await pane.press({ key: 'row:main' })
    expect(await pane.find({ key: 'card:spawns' })).toBeUndefined()
    expect((await pane.find({ key: 'card:tokens' }))?.text).toMatch(/160 token/)
    expect((await pane.find({ key: 'list-columns' }))?.text).toMatch(/session.*token.*date/)
    expect((await pane.find({ key: `session:/repo|${Date.parse('2026-10-12T12:00:00')}` }))?.text).toMatch(/\(no prompt\).*160.*Oct 12/)
    // Sessions sort by tokens or by time; duration is a spawn's.
    expect((await pane.find({ key: 'sort' }))?.text).toBe('‹ most tokens ›')
    await pane.press({ key: 'sort' })
    expect((await pane.find({ key: 'sort' }))?.text).toBe('‹ time ›')
    await pane.press({ key: 'sort' })
    expect((await pane.find({ key: 'sort' }))?.text).toBe('‹ most tokens ›')
    await pane.unmount()
  })
  test('the two cards sit side by side from 60 body columns, stacked below', async ($, on) => {
    await busyDay($, on)
    for (const [bodyColumns, direction] of [[52, 'column'], [60, 'row'], [64, 'row']] as const) {
      const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' } as never)
      expect((await pane.find({ key: 'cards' }))?.props.flexDirection).toBe(direction)
      await pane.press({ key: 'row:/repo' })
      expect((await pane.find({ key: 'cards' }))?.props.flexDirection).toBe(direction)
      await pane.press({ key: 'back' })
      await pane.unmount()
    }
  })

  test('an opened session splits its token card by the main session\'s models', async ($, on) => {
    const world = await twoWeeks($, on)
    await step($, 'claude-sonnet-4-6')
    await step($, 'claude-sonnet-4-6')
    await stats($, 'stats')
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
    await choose(pane, 'group', 'session')
    await pane.press({ key: `row:/repo|${world.now}` })
    const card = (await pane.find({ key: 'card:tokens' }))?.text ?? ''
    expect(card).toMatch(/claude-sonnet-4-6 320.*claude-opus-4 160.*subagent 160/)
    // Every other grouping keeps one main session part.
    await pane.press({ key: 'back' })
    await choose(pane, 'group', 'repo')
    await pane.press({ key: 'row:/repo' })
    expect((await pane.find({ key: 'card:tokens' }))?.text).toMatch(/main session 480.*subagent 160/)
    await pane.unmount()
  })

  test('at any width the period leads the top line and the grouping heads the list, each row in two lines', async ($, on) => {
    await busyDay($, on)
    for (const bodyColumns of [52, 110]) {
      const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' } as never)
      await choose(pane, 'group', 'model')
      expect(((await pane.find({ key: 'header' }))?.children[0] as { children: { props: { key?: string } }[] } | undefined)?.children[0]?.props.key).toBe('switch:days')
      expect((await pane.find({ key: 'group-line' }))?.text).toMatch(/model/)
      expect((await pane.find({ key: 'name:claude-haiku-4-5' }))?.text).toMatch(/claude-haiku-4-5.*spawns/)
      expect((await pane.find({ key: 'bar:claude-haiku-4-5' }))?.text).toMatch(/78,000.*%/)
      await pane.unmount()
    }
  })

  test('a row is a card whose name is cut to one line by its cells, leaving its spawns count whole', async ($, on) => {
    const world = await twoWeeks($, on)
    world.store[`ledger:long`] = {
      updated: world.now,
      repo: '/repo',
      started: world.now - 1000,
      prompt: '調整 subagent-dispatch stats 介面，讓中英混合的 session 名稱也只佔一行',
      main: { 'claude-opus-4': { input: 10, cacheWrite: 0, cacheRead: 0, output: 0, steps: 1 } },
      spawns: [],
    }
    await stats($, 'stats')
    const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 52 }, surface: 'terminal' } as never)
    await choose(pane, 'group', 'session')
    const card = await pane.find({ key: `line-/repo|${world.now - 1000}` })
    expect(card?.props.borderStyle).toBe('round')
    const long = (await pane.find({ key: `row:/repo|${world.now - 1000}` }))?.text ?? ''
    expect(long.endsWith('…')).toBe(true)
    expect(cells(long)).toBeLessThanOrEqual(52 - 4 - cells('0 spawns') - 3)
    expect((await pane.find({ key: `name:/repo|${world.now - 1000}` }))?.text).toMatch(/…0 spawns$/)
    expect((await pane.find({ key: 'name:/old|' + new Date(2026, 9, 5, 9).getTime() }))?.text).toBe('last week1 spawns')
    await pane.unmount()
  })

  test('period, grouping and sort switch in place: one cycling button in the terminal, segments on desktop', async ($, on) => {
    await twoWeeks($, on, 'desktop')
    await stats($, 'stats')
    const term = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
    const days = await term.find({ key: 'days' })
    expect(days?.type).toBe('Button')
    expect(days?.props.hotkey).toBe('p')
    expect(days?.text).toContain('‹ 30 days ›')
    // The current value is bold: yellow means something waits on the user (DESIGN.md).
    const value = days?.children[0] as { props: { bold?: boolean; color?: string } } | undefined
    expect(value?.props.bold).toBe(true)
    expect(value?.props.color).toBeUndefined()
    await term.press({ key: 'days' })
    expect((await term.find({ key: 'days' }))?.text).toContain('‹ 90 days ›')
    await term.press({ key: 'days' })
    expect((await term.find({ key: 'days' }))?.text).toContain('‹ 7 days ›')
    expect(await term.find({ key: 'row:/old' })).toBeUndefined()
    expect((await term.find({ key: 'group' }))?.props.hotkey).toBe('g')
    await term.press({ key: 'group' })
    expect((await term.find({ key: 'group' }))?.text).toContain('‹ session ›')
    await term.unmount()

    const desk = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
    expect((await desk.find({ key: 'days:7' }))?.props.variant).toBe('primary')
    // The hotkey sits on the segment after the current one, so it steps forward as in the terminal.
    expect((await desk.find({ key: 'days:30' }))?.props.hotkey).toBe('p')
    expect((await desk.find({ key: 'days:7' }))?.props.hotkey).toBeUndefined()
    await desk.press({ key: 'days:30' })
    expect((await desk.find({ key: 'days:30' }))?.props.variant).toBe('primary')
    expect((await desk.find({ key: 'days:7' }))?.props.variant).toBeUndefined()
    await desk.press({ key: 'group:model' })
    await desk.press({ key: 'row:claude-opus-4' })
    await desk.press({ key: 'sort:time' })
    expect((await desk.find({ key: 'sort:time' }))?.props.variant).toBe('primary')
    await desk.unmount()
  })

  test('the desktop pane draws its bars as Svg', async ($, on) => {
    await twoWeeks($, on, 'desktop')
    await stats($, 'stats')
    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
    // The two cards' bars and the two rows'.
    expect(await pane.findAll({ type: 'Svg' })).toHaveLength(4)
    expect(await pane.find({ type: 'Text', text: /█/ })).toBeUndefined()
    await pane.unmount()
  })
})

