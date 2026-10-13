import type { AgentStatus, On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { addDays, buildHeatmap, cells, elapsed, fit, heatLevels, heatWeeks, liveFrom, monthMarks, parseSubagent, parseTranscript, type Tally } from './ledger'
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
    // Files beyond the settings file (transcripts), what was logged and toasted, and the files
    // read through `cat`.
    files: {} as Record<string, string>,
    logs: [] as string[],
    toasts: [] as string[],
    catted: [] as string[],
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
    const text = world.files[e.path]
    if (text === undefined) {
      throw new Error('ENOENT')
    }
    if (text === 'EIO') {
      throw new Error('EIO')
    }

    return { value: text }
  })
  // A directory is any path some file lies under; its entries are the next part of each path. A
  // file starting `BIG` is over the read limit.
  on('fs.list', ($, e) => {
    const dir = `${e.path ?? ''}/`
    const names = new Map<string, 'file' | 'dir'>()
    for (const path of Object.keys(world.files).filter(path => path.startsWith(dir))) {
      const [name, ...rest] = path.slice(dir.length).split('/')
      names.set(name!, rest.length === 0 ? 'file' : 'dir')
    }
    if (names.size === 0) {
      throw new Error('ENOENT')
    }

    return {
      value: [...names].map(([name, kind]) => ({ name, kind, size: kind === 'file' && world.files[dir + name]!.startsWith('BIG') ? 5 * 1024 * 1024 : 100, mtimeMs: 0, isLink: false })),
    }
  })
  // git names a worktree's main working tree by its common directory.
  on('process.run', ($, e) => ({
    value: { exitCode: 0, stdout: `${e.argv[2]?.split('/.claude/worktrees/')[0]}/.git\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('process.spawn', async function* ($, e) {
    world.catted.push(e.argv[1] ?? '')
    yield { stream: 'stdout' as const, text: (world.files[e.argv[1] ?? ''] ?? '').slice('BIG'.length) }

    return { value: { code: 0, signal: null } }
  } as never)
  on('ui.log', ($, e) => (world.logs.push(e.text), { value: undefined }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.toast', ($, e) => (world.toasts.push(e.text), { value: undefined }))
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
  expect((await run('')).text).toBe('Usage: /subagent-dispatch redispatch, /subagent-dispatch stats [--text] [days], /subagent-dispatch backfill, /subagent-dispatch status')
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

  test('the main session counts per day, and a ledger of the old format counts on its last day', async ($, on) => {
    const world = newWorld()
    const tally = { input: 1000, cacheWrite: 0, cacheRead: 0, output: 0, steps: 1 }
    const yesterday = new Date(2026, 9, 11, 23).getTime()
    const before = new Date(2026, 9, 10, 9).getTime()
    world.store = {
      // This session also stepped yesterday, before midnight.
      'ledger:s1': { updated: yesterday, repo: '', started: yesterday, prompt: 'late night', daily: { '2026-10-11': { 'claude-opus-4': tally } }, spawns: [] },
      'ledger:old': { updated: before, repo: '/old', started: before, prompt: 'old format', main: { 'claude-haiku-4-5': tally }, spawns: [] },
    }
    engine(on, { value: 'running' }, '', world)
    await start($)
    await step($, 'claude-opus-4')

    const ledger = world.store['ledger:s1'] as { daily: Record<string, Record<string, { steps: number }>> }
    expect(ledger.daily['2026-10-11']?.['claude-opus-4']?.steps).toBe(1)
    expect(ledger.daily['2026-10-12']?.['claude-opus-4']?.steps).toBe(1)

    const one = await stats($, 'stats --text 1')
    expect(one).toContain('usage, 1 day: Oct 12 – Oct 12')
    expect(one).toContain('main session  160')
    const two = await stats($, 'stats --text 2')
    expect(two).toContain('main session  1,160')
    expect(two).not.toContain('old format')
    const three = await stats($, 'stats --text 3')
    expect(three).toContain('main session  2,160')
    expect(three).toContain('old format')
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
      // The header's left part holds the period first; the day steps sit at the right.
      type Node = { props: { key?: string }; children: Node[] }
      const header = (await pane.find({ key: 'header' })) as Node | undefined
      expect(header?.children[0]?.children[0]?.children[0]?.props.key).toBe('switch:days')
      expect(header?.children[1]?.props.key).toBe('day-steps')
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
    expect((await term.find({ key: 'days' }))?.text).toContain('‹ 1 day ›')
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
    // The heatmap, the two cards' bars and the two rows'.
    expect(await pane.findAll({ type: 'Svg' })).toHaveLength(5)
    expect(await pane.find({ type: 'Text', text: /█/ })).toBeUndefined()
    await pane.unmount()
  })
})


describe('heatmap', () => {
  // A Monday, as in newWorld().
  const NOW = new Date(2026, 9, 12, 12).getTime()
  const at = (month: number, day: number, hour = 12) => new Date(2026, month - 1, day, hour).getTime()
  const tally = (input: number, cacheRead = 0): Tally => ({ input, cacheWrite: 0, cacheRead, output: 0, steps: 1 })
  const ZEROS = { all: 0, explicit: 0, opus: 0, forks: 0, defaults: 0 }
  const ledgerOf = (started: number, updated: number, daily: Record<string, Record<string, Tally>>, spawns: object[] = []) => ({ updated, repo: '/repo', started, prompt: 'p', daily, spawns })
  const spawnOn = (at: number, last: number, input: number, cacheRead = 0) => ({
    agentId: `a${at}`,
    at,
    last,
    description: 'look around',
    type: 'Explore',
    model: 'claude-haiku-4-5',
    fork: false,
    background: false,
    ...tally(input, cacheRead),
  })
  const byDay = (stored: unknown[], rows: Record<string, unknown>, weeks: number) => Object.fromEntries(buildHeatmap(stored, rows, weeks, NOW).days.map(item => [item.day, item.tokens]))

  test('fits as many weeks as the width holds, 4 to 53, today in the last column', () => {
    expect([heatWeeks(80), heatWeeks(110), heatWeeks(200), heatWeeks(12), heatWeeks(5)]).toEqual([38, 53, 53, 4, 4])
    const { days } = buildHeatmap([], {}, 4, NOW)
    expect(days).toHaveLength(3 * 7 + 1)
    expect(days[0]?.day).toBe('2026-09-21')
    expect(days.at(-1)?.day).toBe('2026-10-12')
    // On a Wednesday the last week has three days.
    expect(buildHeatmap([], {}, 4, at(10, 14)).days).toHaveLength(3 * 7 + 3)
  })

  test('a day nothing recorded is null and a recorded day with no use 0; cache read does not count; a spawn counts on its last step', () => {
    const stored = [ledgerOf(at(10, 8), at(10, 10), { '2026-10-08': { m: tally(100, 5000) } }, [spawnOn(at(10, 9), at(10, 10), 500, 9999)])]
    const days = byDay(stored, {}, 4)
    expect([days['2026-10-07'], days['2026-10-08'], days['2026-10-09'], days['2026-10-10'], days['2026-10-11']]).toEqual([null, 100, 0, 500, null])
  })

  test('reads the ledgers back to liveFrom and day rows before it, with no gap between', () => {
    const live = liveFrom(NOW)
    const before = addDays(live, -1)
    const row = (input: number) => ({ main: { m: tally(input) }, sub: { h: tally(1, 50) }, spawned: ZEROS, at: 0 })
    const stored = [ledgerOf(at(7, 1), NOW, { [before]: { m: tally(7) }, [live]: { m: tally(3) } })]
    const days = byDay(stored, { [before]: row(40), [live]: row(50), '2025-10-20': { main: {}, sub: {}, spawned: ZEROS, at: 0 } }, 53)
    expect(days[before]).toBe(41)
    expect(days[live]).toBe(3)
    expect(days['2025-10-20']).toBe(0)
    expect(days['2025-10-21']).toBeNull()
    expect(addDays(live, 88)).toBe('2026-10-12')
  })

  test('labels a month over the week its Sunday falls in', () => {
    const { days } = buildHeatmap([], {}, 8, NOW)
    expect(days[0]?.day).toBe('2026-08-24')
    expect(monthMarks('en', days)).toEqual([
      { week: 1, label: 'Sep' },
      { week: 5, label: 'Oct' },
    ])
    expect(monthMarks('zh-TW', days)[1]).toEqual({ week: 5, label: '10月' })
  })

  test('levels the used days by quartile, 0 for none', () => {
    const level = heatLevels([10, 20, 30, 40, 0, null].map((tokens, i) => ({ day: `d${i}`, tokens })))
    expect([10, 20, 30, 40, 0, null].map(level)).toEqual([1, 2, 3, 4, 0, 0])
  })

  describe('day rows', () => {
    test('session start writes a row for each recorded day up to the day before yesterday, and keeps the ones there', async ($, on) => {
      const world = newWorld()
      world.store = {
        'ledger:a': ledgerOf(at(10, 8), at(10, 12, 9), { '2026-10-08': { m: tally(100) }, '2026-10-11': { m: tally(5) } }, [spawnOn(at(10, 9), at(10, 9), 500)]),
        'day:2026-10-08': { main: {}, sub: {}, spawned: ZEROS, at: 1 },
      }
      engine(on, { value: 'running' }, '', world)
      await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
      expect(Object.keys(world.store).filter(key => key.startsWith('day:')).sort()).toEqual(['day:2026-10-08', 'day:2026-10-09', 'day:2026-10-10'])
      expect((world.store['day:2026-10-08'] as { at: number }).at).toBe(1)
      expect(world.store['day:2026-10-09']).toEqual({ main: {}, sub: { 'claude-haiku-4-5': tally(500) }, spawned: { ...ZEROS, all: 1, defaults: 1 }, at: world.now })
      expect(world.store['day:2026-10-10']).toEqual({ main: {}, sub: {}, spawned: ZEROS, at: world.now })
    })

    test('a row outlives its pruned ledger, and rows older than 366 days go', async ($, on) => {
      const world = newWorld()
      const old = world.now - 100 * 86_400_000
      const day = addDays('2026-10-12', -100)
      world.store = {
        'ledger:old': ledgerOf(old, old, { [day]: { m: tally(70) } }),
        'day:2025-10-12': { main: {}, sub: {}, spawned: ZEROS, at: 0 },
        'day:2025-10-11': { main: {}, sub: {}, spawned: ZEROS, at: 0 },
      }
      engine(on, { value: 'running' }, '', world)
      await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
      expect(world.store['ledger:old']).toBeUndefined()
      expect((world.store[`day:${day}`] as { main: Record<string, Tally> }).main).toEqual({ m: tally(70) })
      expect(world.store['day:2025-10-12']).toBeDefined()
      expect(world.store['day:2025-10-11']).toBeUndefined()
      const rows = Object.fromEntries(Object.entries(world.store).map(([key, value]) => [key.slice('day:'.length), value]))
      expect(byDay([], rows, 53)[day]).toBe(70)
    })
  })

  describe('in the pane', () => {
    const PANE = { plugin: 'subagent-dispatch', component: 'Pane', requestId: 'subagent-dispatch-stats', props: { title: 'stats', isFocused: true, bodyColumns: 100, placement: 'dock' } } as const
    type T = Parameters<Parameters<typeof test>[1]>[0]
    type Mounted = Awaited<ReturnType<T['ui']['mount']>>

    // Use today and on Oct 2 (a spawn), a recorded day with none on Oct 10, nothing on Oct 5, and a
    // day row from June, before the ledgers reach.
    async function heatWorld($: T, on: On, surface: 'terminal' | 'desktop' = 'terminal', userFile = '') {
      const world = newWorld()
      world.store = {
        'ledger:today': ledgerOf(at(10, 12, 9), at(10, 12, 10), { '2026-10-12': { 'claude-opus-4': tally(2000) } }),
        'ledger:oct2': ledgerOf(at(10, 2, 9), at(10, 2, 11), { '2026-10-02': { 'claude-opus-4': tally(300) } }, [spawnOn(at(10, 2, 10), at(10, 2, 11), 900)]),
        'ledger:quiet': ledgerOf(at(10, 10, 9), at(10, 10, 9), {}),
        'day:2026-06-01': { main: { 'claude-opus-4': tally(4321) }, sub: {}, spawned: ZEROS, at: 0 },
      }
      engine(on, { value: 'running' }, userFile, world)
      await $.session.start({ cwd: '/repo', surface, isInteractive: true })
      await $.command.run({ command: 'subagent-dispatch', args: 'stats' } as never)

      return world
    }
    const mount = ($: T, bodyColumns = 110, surface: 'terminal' | 'desktop' = 'terminal') => $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface } as never)
    const dayCells = async (pane: Mounted) => (await pane.findAll({ type: 'Button' })).filter(node => String(node.props.key).startsWith('day:'))
    const glyph = async (pane: Mounted, day: string) => (await pane.find({ key: `day:${day}` }))?.children[0] as { props: { color?: string; bold?: boolean; dimColor?: boolean } } | undefined

    test('draws as many weeks as the width holds, none below 12 columns or in an opened row', async ($, on) => {
      await heatWorld($, on)
      for (const [columns, weeks] of [
        [110, 53],
        [80, 38],
        [52, 24],
        [12, 4],
      ] as const) {
        const pane = await mount($, columns)
        // Today is a Monday: the last week has one day.
        expect(await dayCells(pane)).toHaveLength((weeks - 1) * 7 + 1)
        await pane.unmount()
      }
      const narrow = await mount($, 11)
      expect(await narrow.find({ key: 'heatmap' })).toBeUndefined()
      await narrow.unmount()

      const pane = await mount($)
      expect(await pane.find({ key: 'heat-months' })).toBeDefined()
      expect((await pane.find({ key: 'heat-legend' }))?.text).toMatch(/^No data · {2}None ■ {2}Less ■■■■ More {2}Selected ■.*Most Jun 1 4k$/)
      // 30 days span 11 columns at the right: too few for the label, which goes before the bracket.
      expect((await pane.find({ key: 'heat-note' }))?.text).toMatch(/30 days └─+┘$/)
      await pane.press({ key: 'days' })
      expect((await pane.find({ key: 'heat-note' }))?.text).toMatch(/└─+ 90 days ─+┘$/)
      await pane.press({ key: 'days' })
      expect((await pane.find({ key: 'heat-note' }))?.text).toMatch(/^ {104}▲ today$/)
      await pane.press({ key: 'row:/repo' })
      expect(await pane.find({ key: 'heatmap' })).toBeUndefined()
      await pane.unmount()
    })

    test('no data, no use, use and the chosen day are each drawn their own way', async ($, on) => {
      await heatWorld($, on)
      const pane = await mount($)
      expect((await glyph(pane, '2026-10-05'))?.props.dimColor).toBe(true)
      expect((await pane.find({ key: 'day:2026-10-05' }))?.text).toBe('·')
      expect((await glyph(pane, '2026-10-10'))?.props.color).toBe('#4a4a52')
      // Three used days: Oct 2 the least, then today, then the June day row.
      expect((await glyph(pane, '2026-10-02'))?.props.color).toBe('#1f5a6d')
      expect((await glyph(pane, '2026-10-12'))?.props.color).toBe('#2a7f9c')
      expect((await glyph(pane, '2026-06-01'))?.props.color).toBe('#3aa6cc')
      expect((await pane.find({ key: 'day:2026-10-12' }))?.text).toBe('■')

      await pane.press({ key: 'day:2026-10-10' })
      expect((await glyph(pane, '2026-10-10'))?.props).toMatchObject({ color: '#ff8c42', bold: true })
      expect(await pane.find({ type: 'Text', text: /^Sat Oct 10: no usage \(the day was recorded/ })).toBeDefined()
      expect(await pane.find({ key: 'card:tokens' })).toBeUndefined()

      await pane.press({ key: 'day:2026-10-05' })
      expect((await pane.find({ key: 'day:2026-10-05' }))?.text).toBe('■')
      expect(await pane.find({ type: 'Text', text: /^Mon Oct 5: no data \(neither a ledger nor a day row/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /no usage/ })).toBeUndefined()
      await pane.unmount()
    })

    test("a pressed day, j and k choose the period's day; p lets it go", async ($, on) => {
      await heatWorld($, on)
      const pane = await mount($)
      expect((await pane.find({ key: 'card:tokens' }))?.text).toMatch(/3,200/)

      await pane.press({ key: 'day:2026-10-02' })
      expect((await pane.find({ key: 'days' }))?.text).toContain('‹ Fri Oct 2 ›')
      expect((await pane.find({ key: 'header' }))?.text).toContain('1 day · p back to 30 days')
      expect((await pane.find({ key: 'card:tokens' }))?.text).toMatch(/1,200.*main session.*300.*subagent.*900/)
      // Oct 2 is in week 50 of 0–52, too near the right edge for the label after its mark.
      const note = (await pane.find({ key: 'heat-note' }))?.text ?? ''
      expect(note).toMatch(/^ +Fri Oct 2 ▲$/)
      expect(note.indexOf('▲')).toBe(50 * 2)
      expect(await pane.find({ key: 'row:/repo' })).toBeDefined()

      await pane.press({ key: 'next-day' })
      expect((await pane.find({ key: 'days' }))?.text).toContain('‹ Sat Oct 3 ›')
      await pane.press({ key: 'prev-day' })
      await pane.press({ key: 'prev-day' })
      expect((await pane.find({ key: 'days' }))?.text).toContain('‹ Thu Oct 1 ›')
      expect((await pane.find({ key: 'prev-day' }))?.props.hotkey).toBe('j')
      expect((await pane.find({ key: 'next-day' }))?.props.hotkey).toBe('k')

      // p lets the day go first, and only then steps the period.
      expect((await pane.find({ key: 'days' }))?.props.hotkey).toBe('p')
      await pane.press({ key: 'days' })
      expect((await pane.find({ key: 'days' }))?.text).toContain('‹ 30 days ›')
      expect((await pane.find({ key: 'card:tokens' }))?.text).toMatch(/3,200/)

      // k does nothing with no day chosen; j from none chooses today, and k stops there.
      await pane.press({ key: 'next-day' })
      expect((await pane.find({ key: 'days' }))?.text).toContain('‹ 30 days ›')
      await pane.press({ key: 'prev-day' })
      expect((await pane.find({ key: 'days' }))?.text).toContain('‹ Mon Oct 12 ›')
      await pane.press({ key: 'next-day' })
      expect((await pane.find({ key: 'days' }))?.text).toContain('‹ Mon Oct 12 ›')
      // Near the right edge the label goes before its mark.
      expect((await pane.find({ key: 'heat-note' }))?.text).toMatch(/Mon Oct 12 ▲$/)
      await pane.press({ key: 'day:2026-06-01' })
      expect((await pane.find({ key: 'heat-note' }))?.text).toMatch(/^ +▲ Mon Jun 1$/)
      await pane.unmount()
    })

    test("j stops at the heatmap's first day; a day before the ledgers reach shows its day row", async ($, on) => {
      await heatWorld($, on)
      const pane = await mount($, 12)
      await pane.press({ key: 'day:2026-09-21' })
      await pane.press({ key: 'prev-day' })
      expect((await pane.find({ key: 'days' }))?.text).toContain('‹ Mon Sep 21 ›')
      await pane.unmount()

      const wide = await mount($)
      await wide.press({ key: 'day:2026-06-01' })
      expect((await wide.find({ key: 'card:tokens' }))?.text).toMatch(/4,321/)
      expect(await wide.find({ type: 'Text', text: /^Only the day's summary is kept for Mon Jun 1/ })).toBeDefined()
      expect(await wide.find({ key: 'group-line' })).toBeUndefined()
      await wide.unmount()
    })

    test('the chosen day is written the zh-TW way', async ($, on) => {
      await heatWorld($, on, 'terminal', '{"*":{"language":"zh-TW"}}')
      const pane = await mount($)
      expect((await pane.find({ key: 'heat-legend' }))?.text).toMatch(/^無資料 · {2}無用量 ■ {2}少 ■■■■ 多 {2}選到 ■.*最多 6\/1 4k$/)
      await pane.press({ key: 'day:2026-10-02' })
      expect((await pane.find({ key: 'days' }))?.text).toContain('‹ 10/02 週五 ›')
      expect((await pane.find({ key: 'header' }))?.text).toContain('1 天 · p 回到 30 天')
      await pane.press({ key: 'day:2026-10-04' })
      expect(await pane.find({ type: 'Text', text: /^10\/04（日）沒有資料（帳本與每日摘要都沒有這天/ })).toBeDefined()
      await pane.unmount()
    })

    test('the desktop pane draws the heatmap as one Svg', async ($, on) => {
      await heatWorld($, on, 'desktop')
      const pane = await mount($, 110, 'desktop')
      const svg = (await pane.find({ key: 'heatmap' }))?.children[0] as { type: string; props: { source: string } } | undefined
      expect(svg?.type).toBe('Svg')
      expect(svg?.props.source).toContain('stroke-dasharray')
      expect(svg?.props.source).toContain('fill-opacity="0.25"')
      expect(await dayCells(pane)).toHaveLength(0)
      await pane.unmount()
    })
  })
})

describe('backfill', () => {
  const ROOT = '/.claude/projects/-repo'
  const time = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString()
  const json = (value: object) => JSON.stringify(value)
  const usage = (input: number) => ({ input_tokens: input, output_tokens: 1, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 })
  const reply = (id: string, ts: string, input: number, more: object = {}) => json({ type: 'assistant', timestamp: ts, cwd: '/repo', message: { id, model: 'claude-opus-4', usage: usage(input) }, ...more })
  const session = (day: number, cwd = '/repo') =>
    [
      json({ type: 'user', timestamp: time(day, 9), cwd, isMeta: true, message: { content: 'meta' } }),
      json({ type: 'user', timestamp: time(day, 9), cwd, message: { content: '<command-name>/clear</command-name>' } }),
      json({ type: 'user', timestamp: time(day, 9), cwd, message: { content: [{ type: 'text', text: 'fix the flaky ledger test' }] } }),
      reply('m1', time(day, 10), 1),
      reply('m1', time(day, 10), 100),
      reply('m2', time(day, 11), 50),
      reply('m3', time(day, 11), 7, { isSidechain: true }),
      json({ type: 'assistant', timestamp: time(day, 11), message: { id: 'm4', model: '<synthetic>', usage: usage(9) } }),
      'not json',
    ].join('\n')

  test('parses a transcript: one step per reply, no sidechain or synthetic lines, the first typed prompt', () => {
    const parsed = parseTranscript(session(5))
    expect(parsed.steps.map(step => [step.model, step.tally.input])).toEqual([
      ['claude-opus-4', 100],
      ['claude-opus-4', 50],
    ])
    expect(parsed.prompt).toBe('fix the flaky ledger test')
    expect(parsed.cwd).toBe('/repo')
    expect([parsed.started, parsed.updated]).toEqual([Date.parse(time(5, 9)), Date.parse(time(5, 11))])
  })

  test('parses a subagent: a fork by its meta, a named model, foreground or background', () => {
    const text = [reply('s1', time(5, 10), 10, { isSidechain: true }), reply('s2', time(5, 12), 20, { isSidechain: true })].join('\n')
    const fork = parseSubagent({ agentType: 'fork', isFork: true, model: 'inherit', description: 'look', requestShape: 'background' }, text, 'a1')
    expect(fork).toMatchObject({ agentId: 'a1', type: 'fork', fork: true, background: true, input: 30, steps: 2, at: Date.parse(time(5, 10)), last: Date.parse(time(5, 12)) })
    expect(fork?.requested).toBeUndefined()
    const named = parseSubagent({ agentType: 'Explore', model: 'haiku', description: 'find', requestShape: 'foreground' }, text, 'a2')
    expect(named).toMatchObject({ type: 'Explore', requested: 'haiku', fork: false, background: false, model: 'claude-opus-4' })
    expect(parseSubagent({}, 'not json', 'a3')).toBeUndefined()
  })

  // The backfill runs in the background: wait until `check` holds, or `rounds` ticks pass.
  async function waitFor(check: () => boolean, rounds = 300): Promise<void> {
    for (let i = 0; i < rounds && !check(); i++) {
      await new Promise(resolve => setTimeout(resolve, 1))
    }
  }

  // A session with a spawn, one with a live ledger, this session's own, a broken file and a large one.
  function transcripts() {
    const world = newWorld()
    world.files = {
      [`${ROOT}/old1.jsonl`]: session(5, '/repo/.claude/worktrees/x'),
      [`${ROOT}/old1/subagents/agent-a9.jsonl`]: reply('s1', time(5, 10), 40, { isSidechain: true }),
      [`${ROOT}/old1/subagents/agent-a9.meta.json`]: json({ agentType: 'Explore', description: 'find it', model: 'haiku', requestShape: 'background' }),
      [`${ROOT}/kept.jsonl`]: session(6),
      [`${ROOT}/s1.jsonl`]: session(7),
      [`${ROOT}/bad.jsonl`]: 'EIO',
      [`${ROOT}/big.jsonl`]: `BIG${session(8)}`,
    }
    world.store = { 'ledger:kept': { updated: world.now, repo: '/kept', started: world.now, prompt: 'live', daily: {}, spawns: [] } }

    return world
  }

  test('rebuilds a ledger for each transcript with none, once, and then the day rows', async ($, on) => {
    const world = transcripts()
    engine(on, { value: 'running' }, '', world)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await waitFor(() => world.toasts.length > 0)

    const old = world.store['ledger:old1'] as Record<string, unknown> & { spawns: Record<string, unknown>[] }
    expect(old).toMatchObject({ repo: '/repo', prompt: 'fix the flaky ledger test', source: 'transcript', started: Date.parse(time(5, 9)) })
    expect(old.daily).toEqual({ '2026-10-05': { 'claude-opus-4': { input: 150, cacheWrite: 0, cacheRead: 2000, output: 2, steps: 2 } } })
    expect(old.spawns).toHaveLength(1)
    expect(old.spawns[0]).toMatchObject({ agentId: 'a9', type: 'Explore', requested: 'haiku', input: 40 })
    // The live ledger stays, this session's own transcript is not read, a broken file is skipped and
    // a large one goes through cat.
    expect((world.store['ledger:kept'] as { prompt: string }).prompt).toBe('live')
    expect(world.store['ledger:s1']).toBeUndefined()
    expect(world.store['ledger:big']).toBeDefined()
    expect(world.catted).toEqual([`${ROOT}/big.jsonl`])
    expect(world.store.backfill).toMatchObject({ state: 'done', sessions: 2, skipped: 1 })
    expect(world.logs.some(text => text.startsWith(`backfill: skipped ${ROOT}/bad.jsonl`))).toBe(true)
    expect(world.toasts).toEqual(['subagent-dispatch: added 2 session(s) from the transcripts (since Oct 5)'])
    expect(world.store['day:2026-10-05']).toMatchObject({ main: { 'claude-opus-4': { input: 150 } }, sub: { 'claude-opus-4': { input: 40 } } })

    // Done once: a second session start reads nothing again.
    delete world.store['ledger:old1']
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await waitFor(() => false, 20)
    expect(world.store['ledger:old1']).toBeUndefined()
  })

  test("another session's run holds it off; the backfill command runs it again", async ($, on) => {
    const world = transcripts()
    world.store.backfill = { state: 'running', at: world.now - 60_000, sessions: 0, skipped: 0 }
    engine(on, { value: 'running' }, '', world)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await waitFor(() => false, 20)
    expect(world.store['ledger:old1']).toBeUndefined()

    const text = (await $.command.run({ command: 'subagent-dispatch', args: 'backfill' } as never)).text
    expect(text).toMatch(/^Reading the transcripts/)
    await waitFor(() => world.toasts.length > 0)
    expect(world.store['ledger:old1']).toBeDefined()
  })

  test('the backfill command does not run with the ledger off', async ($, on) => {
    const world = transcripts()
    world.store.backfill = { state: 'done', at: world.now, sessions: 0, skipped: 0 }
    engine(on, { value: 'running' }, '', world)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await $.command.run({ command: 'subagent-dispatch', args: 'set ledger false' } as never)
    expect((await $.command.run({ command: 'subagent-dispatch', args: 'backfill' } as never)).text).toMatch(/ledger setting is off/)
    await waitFor(() => false, 20)
    expect(world.store['ledger:old1']).toBeUndefined()
  })

  test('does not run in a -p run', async ($, on) => {
    const world = transcripts()
    engine(on, { value: 'running' }, '', world)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await waitFor(() => false, 20)
    expect(world.store.backfill).toBeUndefined()
  })
})
