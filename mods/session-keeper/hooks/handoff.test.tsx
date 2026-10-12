import type { On, TurnUsage } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { CacheMeter } from '../types'
import {
  GATE_SYSTEM,
  gatePrompt,
  handoffPrompt,
  gateStats,
  handoffConfig,
  handoffDraft,
  isColdAndLarge,
  parseVerdict,
  progressNote,
  progressTask,
  renderHandoff,
  thresholdOf,
  withExclude,
  withOffered,
} from './handoff'
import { KEEP_PROMPT } from './keep'
import { EMPTY, record } from './meter'

const MIN = 60_000
const HOUR = 60 * MIN
const step = { at: 0, model: 'opus', toolsKey: 'k', input: 10, output: 500, read: 0, write: 160_000 }
const PROGRESS = (session: string, at: number) => renderHandoff('HANDOFF: 修好登入\n下一步：跑測試', session, at, 'x')

describe('handoff', () => {
  test('reads the options and the threshold', () => {
    expect(handoffConfig({})).toEqual({ gate: 'off', isAwayOn: false, isResumeOn: true })
    expect(handoffConfig({ handoff_gate: 'suggest', away_handoff: true })).toMatchObject({ gate: 'suggest', isAwayOn: true })
    expect(handoffConfig({ handoff_gate: 'block', away_handoff: false }).gate).toBe('block')
    expect(handoffConfig({ handoff_gate: 'nonsense' }).gate).toBe('off')
    expect(thresholdOf(undefined)).toBe(150_000)
    expect(thresholdOf('80000')).toBe(80_000)
    expect(thresholdOf('x')).toBe(150_000)
  })

  test('a new task drafts only the prompts; the others lead with the summary', () => {
    expect(handoffDraft('new-task', 'S', '寫 README', ['還有這個'], 'zh-TW')).toBe('寫 README\n\n還有這個')
    const away = handoffDraft('away', 'HANDOFF: x', '繼續', [], 'zh-TW')
    expect(handoffDraft('away', 'HANDOFF: x', '繼續', [])).toMatch(/cache of the previous conversation expired/)
    expect(away).toMatch(/快取已過期/)
    expect(away).toMatch(/HANDOFF: x\n\n---\n\n繼續$/)
    expect(handoffDraft('manual', 'HANDOFF: x', '', [], 'zh-TW')).toMatch(/HANDOFF: x$/)
  })

  test('the cache is cold only past its TTL, under a large context of this session', () => {
    const m: CacheMeter = { ...record({ ...EMPTY, sessionId: 's1' }, step), ttl: '1h' }
    expect(isColdAndLarge(m, 's1', 61 * MIN, 150_000)).toBe(true)
    expect(isColdAndLarge(m, 's1', 59 * MIN, 150_000)).toBe(false)
    expect(isColdAndLarge(m, 's2', 61 * MIN, 150_000)).toBe(false)
    expect(isColdAndLarge({ ...m, ttl: null }, 's1', 61 * MIN, 150_000)).toBe(false)
    expect(isColdAndLarge(m, 's1', 61 * MIN, 200_000)).toBe(false)
  })

  test('the gate reads the task, the latest prompts and the files touched', () => {
    const text = gatePrompt(
      '幫我寫 changelog',
      [
        { role: 'user', text: '修登入的 bug', toolUses: [] },
        { role: 'assistant', text: '', toolUses: [{ input: { file_path: 'src/login.ts' } }] },
      ],
      '修好登入',
    )
    expect(text).toMatch(/修好登入/)
    expect(text).toMatch(/- 修登入的 bug/)
    expect(text).toMatch(/src\/login\.ts/)
    expect(text).toMatch(/New message:\n幫我寫 changelog$/)
    expect(parseVerdict(' New')).toBe('new')
    expect(parseVerdict('related.')).toBe('related')
    expect(parseVerdict('不知道')).toBeUndefined()
  })

  test('counts how often a "new" verdict was not taken', () => {
    const log = [
      { at: 0, context: 1, mode: 'suggest' as const, verdict: 'new' as const, choice: 'handoff' as const, prompt: 'a' },
      { at: 0, context: 1, mode: 'suggest' as const, verdict: 'new' as const, choice: 'ignored' as const, prompt: 'b' },
      { at: 0, context: 1, mode: 'suggest' as const, verdict: 'related' as const, prompt: 'c' },
    ]
    expect(gateStats(log, 0, 30)).toMatch(/3 judged, 2 judged new\n {2}handed off 1, stayed 0, ignored 1; share judged new but not handed off 50%/)
    expect(gateStats(log, 0, 30, 'zh-TW')).toMatch(/判斷 3 次，判為新任務 2 次\n {2}交接 1、留下 0、忽略 1；判為新任務卻沒交接的比例 50%/)
  })

  test('offers a progress file once per session, not its own, within a day', () => {
    const file = PROGRESS('s1', 0)
    expect(progressTask(file)).toBe('修好登入')
    expect(progressNote(file, 's2', HOUR, undefined)).toMatch(/\(1 h ago\).*may be unrelated to this work/)
    expect(progressNote(file, 's1', HOUR, undefined)).toBeUndefined()
    expect(progressNote(file, 's2', 25 * HOUR, undefined)).toBeUndefined()
    expect(progressNote(file, 's2', HOUR, withOffered(undefined, 0, 's2'))).toBeUndefined()
    // A newer file is offered again.
    expect(progressNote(PROGRESS('s1', MIN), 's2', HOUR, withOffered(undefined, 0, 's2'))).toBeDefined()
    expect(progressNote('no front matter', 's2', HOUR, undefined)).toBeUndefined()
  })

  test('lists the progress file in .git/info/exclude once', () => {
    expect(withExclude('')).toBe('# session-keeper\n/.claude/progress.md\n')
    expect(withExclude('# project-memory\n/.claude/progress.md\n')).toBeUndefined()
  })
})

// ---------- the flows, through the engine ----------

// The test environment has timers; the hooks' type library does not declare them.
declare function setTimeout(callback: () => void, ms: number): unknown

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } } as const
const LARGE: TurnUsage = { model: 'opus', input_tokens: 10, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 160_000 }

type World = {
  clock: ReturnType<typeof mock.clock>
  sid: { value: string }
  files: Map<string, string>
  forks: string[]
  fills: string[]
  sent: string[]
  commands: string[]
  toasts: string[]
  // Set before session.start to have the command registration refused.
  refuse: { value: string | undefined }
  contexts: (readonly string[] | undefined)[]
  verdict: { value: string }
  // Holds the summary fork back until resolved.
  hold: { value: Promise<void> | undefined }
  // Set to have the summary fork come back without an answer, for this reason.
  forkFails: { value: string | undefined }
}

// The suite asserts the zh-TW wording, so the user settings file says zh-TW unless a test gives another.
const ZH = '{"*":{"language":"zh-TW"}}'

function world(on: On, ttl: '1h' | '5m' = '1h', userFile = ZH): World {
  const w: World = {
    clock: mock.clock(on),
    sid: { value: 's1' },
    files: new Map([
      ['/t.jsonl', `{"ephemeral_5m_input_tokens":${ttl === '5m' ? 1 : 0},"ephemeral_1h_input_tokens":${ttl === '1h' ? 1 : 0}}`],
      ['/.claude/cc-mod-trimtab.json', userFile],
    ]),
    forks: [],
    fills: [],
    sent: [],
    commands: [],
    toasts: [],
    refuse: { value: undefined },
    contexts: [],
    verdict: { value: 'related' },
    hold: { value: undefined },
    forkFails: { value: undefined },
  }
  mock.env(on, {})
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: w.sid.value }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false, name: null } }))
  on('session.messages', () => ({ value: [] }))
  on('tool.list', () => ({ value: [] }))
  on('command.register', ($, e) => {
    if (w.refuse.value !== undefined) {
      throw new Error(w.refuse.value)
    }

    return { value: { command: e.name } }
  })
  on('classic.Stop', () => ({}))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)

    return { value: undefined }
  })
  on('fs.read', ($, e) => {
    const text = w.files.get(e.path)
    if (text === undefined) {
      throw new Error('ENOENT')
    }

    return { value: text }
  })
  on('fs.write', ($, e) => {
    w.files.set(e.path, e.text)

    return { value: undefined }
  })
  on('fs.stat', () => ({ value: { kind: 'dir' } }) as never)
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: LARGE }
  })
  on('model.complete', () => ({
    value: { isAnswered: true, text: w.verdict.value, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  }))
  on('model.fork', async ($, e) => {
    w.forks.push(e.prompt)
    await w.hold.value
    if (w.forkFails.value !== undefined) {
      return { value: { isAnswered: false, reason: w.forkFails.value } }
    }

    return {
      value: { isAnswered: true, text: 'HANDOFF: 修好登入', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    }
  })
  on('command.run', ($, e) => {
    w.commands.push(e.command)
    if (e.command === 'clear') {
      w.sid.value = 's2'
    }

    return { text: '' }
  })
  on('prompt.fill', ($, e) => {
    w.fills.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('prompt.submit', ($, e) => {
    w.sent.push(e.text)
    w.contexts.push(e.context)

    return { text: e.text }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>band beneath</Text>
  })

  return w
}

async function oneTurn($: Parameters<TestBody>[0]): Promise<void> {
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'opus', messageCount: 1 })) {
    // drain the stream
  }
  await $.classic.Stop({ transcript_path: '/t.jsonl' } as never)
}

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as never

test('suggests a handoff for an unrelated prompt, and a stay quiets it', { options: { keep_warm: true, away_handoff: true, handoff_gate: 'suggest' } }, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await oneTurn($)
  w.verdict.value = 'new'
  const result = await $.prompt.submit(typed('幫我寫 changelog'))
  expect(result).toEqual({ text: '幫我寫 changelog' })
  expect(w.sent).toEqual(['幫我寫 changelog'])

  const band = await $.ui.mount({ plugin: 'session-keeper', surface: 'terminal', ...BAND } as never)
  expect(await band.find({ type: 'Text', text: /無關的新任務（context 160k）/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'band beneath' })).toBeDefined()
  await band.press({ key: 'stay' } as never)
  expect(await band.find({ type: 'Text', text: /無關的新任務/ })).toBeUndefined()
  await band.unmount()

  // Quiet until the context grows another 50k.
  await $.prompt.submit(typed('再一個新任務'))
  const again = await $.ui.mount({ plugin: 'session-keeper', surface: 'terminal', ...BAND } as never)
  expect(await again.find({ type: 'Text', text: /無關的新任務/ })).toBeUndefined()
  await again.unmount()
  expect(await $.command.run({ command: 'session-keeper', args: 'stats' } as never)).toMatchObject({ text: expect.stringMatching(/留下 1/) })
})

test('holds a prompt to a cold cache and hands off with the summary as a draft', { options: { keep_warm: true, away_handoff: true, handoff_gate: 'suggest' } }, async ($, on) => {
  const w = world(on, '5m')
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await oneTurn($)
  await w.clock.advance(10 * MIN)
  const result = await $.prompt.submit(typed('繼續'))
  expect(result).toMatchObject({ drop: expect.stringMatching(/快取已過期/) })
  expect(w.sent).toEqual([])

  const band = await $.ui.mount({ plugin: 'session-keeper', surface: 'terminal', ...BAND } as never)
  expect(await band.find({ type: 'Text', text: /快取已過期/ })).toBeDefined()
  await band.press({ key: 'handoff' } as never)
  await band.unmount()

  expect(w.forks).toEqual([handoffPrompt('away', false, 'zh-TW')])
  expect(w.commands).toEqual(['clear'])
  expect(w.files.get('/repo/.claude/progress.md')).toMatch(/source: session-keeper\nsession: s1[\s\S]*HANDOFF: 修好登入/)
  expect(w.files.get('/repo/.git/info/exclude')).toMatch(/\/\.claude\/progress\.md/)
  expect(w.fills).toHaveLength(1)
  expect(w.fills[0]).toMatch(/HANDOFF: 修好登入\n\n---\n\n繼續$/)

  // The new session does not get the same work again as a progress note.
  w.verdict.value = 'related'
  await $.prompt.submit(typed('好'))
  expect(w.contexts.at(-1) ?? []).toEqual([])
})

test('"keep working here" sends the held prompt', { options: { keep_warm: true, away_handoff: true, handoff_gate: 'suggest' } }, async ($, on) => {
  const w = world(on, '5m')
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await oneTurn($)
  await w.clock.advance(10 * MIN)
  await $.prompt.submit(typed('繼續'))
  const band = await $.ui.mount({ plugin: 'session-keeper', surface: 'terminal', ...BAND } as never)
  await band.press({ key: 'stay' } as never)
  await band.unmount()
  expect(w.sent).toEqual(['繼續'])
  expect(w.commands).toEqual([])
})

test('a new-task handoff drafts only the prompt', { options: { keep_warm: true, away_handoff: true, handoff_gate: 'suggest' } }, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await oneTurn($)
  w.verdict.value = 'new'
  await $.prompt.submit(typed('幫我寫 changelog'))
  const band = await $.ui.mount({ plugin: 'session-keeper', surface: 'terminal', ...BAND } as never)
  await band.press({ key: 'handoff' } as never)
  await band.unmount()
  expect(w.forks).toEqual([handoffPrompt('new-task', true, 'zh-TW')])
  expect(w.fills).toEqual(['幫我寫 changelog'])
  expect(w.files.get('/repo/.claude/progress.md')).toMatch(/HANDOFF: 修好登入/)
})

test('block mode holds an unrelated prompt', { options: { handoff_gate: 'block' } }, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await oneTurn($)
  w.verdict.value = 'new'
  expect(await $.prompt.submit(typed('幫我寫 changelog'))).toMatchObject({ drop: expect.stringMatching(/新任務/) })
  expect(w.sent).toEqual([])
  w.verdict.value = 'related'
  // Typing on keeps working here, with both prompts.
  expect(await $.prompt.submit(typed('對，就這樣'))).toEqual({ text: '幫我寫 changelog\n\n對，就這樣' })
})

test('offers the progress file beside the first prompt of a new session', async ($, on) => {
  const w = world(on)
  w.files.set('/repo/.claude/progress.md', PROGRESS('old', 0))
  const contexts = w.contexts
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await w.clock.advance(HOUR)
  await $.prompt.submit(typed('hi'))
  await $.prompt.submit(typed('again'))
  expect(contexts[0]?.[0]).toMatch(/previous conversation \(1 h ago\)[\s\S]*修好登入/)
  expect(contexts[1] ?? []).toEqual([])
})

test('the last keep writes the summary a cold-cache handoff then uses', { options: { keep_warm: true, away_handoff: true, handoff_gate: 'suggest' } }, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await oneTurn($)
  await w.clock.advance(3 * 55 * MIN)
  expect(w.forks).toEqual([KEEP_PROMPT, KEEP_PROMPT, handoffPrompt('away', false, 'zh-TW')])
  await w.clock.advance(61 * MIN)
  expect(await $.prompt.submit(typed('繼續'))).toMatchObject({ drop: expect.stringMatching(/快取已過期/) })
  const band = await $.ui.mount({ plugin: 'session-keeper', surface: 'terminal', ...BAND } as never)
  await band.press({ key: 'handoff' } as never)
  await band.unmount()
  expect(w.forks).toHaveLength(3)
  expect(w.fills[0]).toMatch(/HANDOFF: 修好登入/)
})

test('prompts typed during the handoff go into the draft', { options: { keep_warm: true, away_handoff: true, handoff_gate: 'suggest' } }, async ($, on) => {
  const w = world(on, '5m')
  let release: () => void = () => {}
  w.hold.value = new Promise<void>(resolve => {
    release = resolve
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await oneTurn($)
  await w.clock.advance(10 * MIN)
  await $.prompt.submit(typed('繼續'))
  const band = await $.ui.mount({ plugin: 'session-keeper', surface: 'terminal', ...BAND } as never)
  const pressed = band.press({ key: 'handoff' } as never)
  await w.clock.advance(1000)
  expect(await $.prompt.submit(typed('順便看一下測試'))).toMatchObject({ drop: expect.stringMatching(/交接中/) })
  expect(await $.prompt.submit(typed('順便看一下測試'))).toMatchObject({ drop: expect.stringMatching(/交接中/) })
  release()
  await pressed
  await band.unmount()
  expect(w.fills[0]).toMatch(/HANDOFF: 修好登入\n\n---\n\n繼續\n\n順便看一下測試$/)
  expect(w.sent).toEqual([])
})

test('/session-keeper handoff hands off with the goal as the prompt; other words show the usage', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await oneTurn($)

  expect(await $.command.run({ command: 'session-keeper', args: '' } as never)).toMatchObject({ text: expect.stringMatching(/^用法/) })
  expect(w.forks).toEqual([])

  expect(await $.command.run({ command: 'session-keeper', args: 'handoff  接著修登入' } as never)).toMatchObject({ text: expect.stringMatching(/^交接中/) })
  for (let i = 0; i < 50 && w.fills.length === 0; i++) {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  expect(w.forks).toEqual([handoffPrompt('manual', false, 'zh-TW')])
  expect(w.commands).toContain('clear')
  expect(w.fills).toHaveLength(1)
  expect(w.fills[0]).toMatch(/HANDOFF: 修好登入\n\n---\n\n接著修登入$/)
})

test('says so when the command name is taken', async ($, on) => {
  const w = world(on)
  w.refuse.value = "it is the user's /session-keeper"
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(w.toasts).toEqual([expect.stringMatching(/\/session-keeper 指令沒有註冊成功/)])
})

test('/session-keeper set changes a setting for this session; status shows where each value comes from', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const run = async (args: string) => (await $.command.run({ command: 'session-keeper', args } as never)).text
  expect(await run('set handoff_gate off')).toMatch(/handoff_gate 現在是 off（來自 session）/)
  expect(await run('status')).toMatch(/handoff_gate = off {2}\[session\] {2}花費，repo 不能設定/)
  expect(await run('set handoff_gate loud')).toMatch(/要是 suggest、block、off 之一/)
  expect(await run('set handoff_gate on --repo')).toMatch(/要是 suggest、block、off 之一/)
  expect(await run('set keep_warm on --repo')).toMatch(/沒有寫入：花費類，repo 檔案只能關閉/)
  expect(await run('set keep_warm off --repo')).toMatch(/^已設定.*keep_warm 現在是 false（來自 repo）/)
  expect(JSON.parse(w.files.get('/repo/.claude/cc-mod-trimtab.json') ?? '')).toEqual({ 'session-keeper': { keep_warm: false } })
  expect(await run('set max_keeps 5 --repo')).toMatch(/沒有寫入：repo 檔案只能調低/)
})

test('the features are off by default; /session-keeper on keeps the cache for a while, then they go back', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const run = async (args: string) => (await $.command.run({ command: 'session-keeper', args } as never)).text
  await oneTurn($)
  await w.clock.advance(55 * MIN)
  expect(w.forks).toEqual([])

  expect(await run('on')).toMatch(/要指定功能：keep_warm、handoff_gate、away_handoff/)
  expect(await run('on keep_warm 3d')).toMatch(/看不懂「3d」/)
  expect(await run('on keep_warm 90m')).toMatch(/^keep_warm 臨時開啟 1h30m（到 \d\d:\d\d）/)
  expect(await run('status')).toMatch(/keep_warm = true {2}\[session，臨時開啟剩 1h30m\]/)
  const band = await $.ui.mount({ plugin: 'session-keeper', surface: 'terminal', ...BAND } as never)
  expect(await band.find({ type: 'Text', text: 'session-keeper on · keep_warm 1h30m' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'band beneath' })).toBeDefined()
  await band.unmount()

  // Due right away: the idle stretch is 55 minutes old. The first keep says what it costs, once.
  await w.clock.advance(1)
  expect(w.forks).toEqual([KEEP_PROMPT])
  await w.clock.advance(55 * MIN)
  expect(w.forks).toHaveLength(2)
  expect(w.toasts).toEqual([expect.stringMatching(/^session-keeper：保持快取開始送 fork.*\/session-keeper off keep_warm$/)])

  // 90 minutes in, the keep_warm goes back to off: no third keep, no line.
  await w.clock.advance(35 * MIN)
  expect(w.forks).toHaveLength(2)
  expect(await run('status')).toMatch(/keep_warm = false {2}\[預設\]/)
  const after = await $.ui.mount({ plugin: 'session-keeper', surface: 'terminal', ...BAND } as never)
  expect(await after.find({ type: 'Text', text: /session-keeper on/ })).toBeUndefined()
  await after.unmount()
})

test('/session-keeper on leaves a feature that is on already; off turns it off for the session', { options: { handoff_gate: 'block' } }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const run = async (args: string) => (await $.command.run({ command: 'session-keeper', args } as never)).text
  expect(await run('on handoff_gate')).toMatch(/handoff_gate 已經常開（block，來自 使用者）/)
  expect(await run('off handoff_gate')).toMatch(/handoff_gate 在這個 session 關閉（使用者 設定是開啟/)
  expect(await run('status')).toMatch(/handoff_gate = off {2}\[session\]/)
  expect(await run('off away_handoff')).toBe('away_handoff 已關閉')
  expect(await run('on 2h away_handoff')).toMatch(/^away_handoff 臨時開啟 2h/)
  expect(await run('off away_handoff')).toBe('away_handoff 已關閉')
  expect(await run('status')).toMatch(/away_handoff = false {2}\[預設\]/)
})

test('/session-keeper on after an off of a feature that is on in the settings takes the off back', { options: { away_handoff: true } }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const run = async (args: string) => (await $.command.run({ command: 'session-keeper', args } as never)).text
  await run('off away_handoff')
  expect(await run('on away_handoff')).toMatch(/^away_handoff 取消這個 session 的關閉，回到常開（true，來自 使用者）/)
  expect(await run('status')).toMatch(/away_handoff = true {2}\[使用者\]/)
})

test('the wording is English by default; the handoff prompt names the language the summary is written in', { options: { keep_warm: true, away_handoff: true, handoff_gate: 'suggest' } }, async ($, on) => {
  const w = world(on, '5m', '')
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await oneTurn($)
  await w.clock.advance(10 * MIN)
  const held = await $.prompt.submit(typed('continue'))
  expect(held).toMatchObject({ drop: expect.stringMatching(/The cache has expired; continuing rewrites/) })
  const band = await $.ui.mount({ plugin: 'session-keeper', surface: 'terminal', ...BAND } as never)
  expect(await band.find({ type: 'Text', text: /The cache has expired; doing this here rewrites/ })).toBeDefined()
  expect(await band.find({ key: 'handoff', text: 'Hand off to a new session' })).toBeDefined()
  await band.press({ key: 'handoff' } as never)
  await band.unmount()
  expect(w.forks).toEqual([handoffPrompt('away', false, 'en')])
  expect(w.forks[0]).toContain('Write in English.')
  expect(w.forks[0]).not.toContain('Write in Traditional Chinese')
  expect(w.fills[0]).toMatch(/^\(session-keeper\) The cache of the previous conversation expired/)
  expect(w.files.get('/repo/.claude/progress.md')).toContain('# Handoff (')
  expect(await $.command.run({ command: 'session-keeper', args: '' } as never)).toMatchObject({ text: expect.stringMatching(/^Usage: \/session-keeper handoff \[goal\]/) })
})

test('with zh-TW the handoff prompt asks for Traditional Chinese, and the model-facing prompts stay English', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await oneTurn($)
  await $.command.run({ command: 'session-keeper', args: 'handoff goal' } as never)
  for (let i = 0; i < 50 && w.fills.length === 0; i++) {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  expect(w.forks[0]).toContain('Write in Traditional Chinese (zh-TW).')
  expect(w.forks[0]).not.toContain('Write in English.')
  expect(w.forks[0]).not.toMatch(/[\u4e00-\u9fff]/)
  expect(GATE_SYSTEM).not.toMatch(/[\u4e00-\u9fff]/)
  expect(w.files.get('/repo/.claude/progress.md')).toContain('# 交接（')
})

test('a failed handoff says so in a toast that starts with the mod', async ($, on) => {
  const w = world(on)
  w.forkFails.value = 'aborted'
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await oneTurn($)
  await $.command.run({ command: 'session-keeper', args: 'handoff 接著修登入' } as never)
  for (let i = 0; i < 50 && w.toasts.length === 0; i++) {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  expect(w.toasts).toEqual([expect.stringMatching(/^session-keeper：交接失敗，沒有產生摘要（aborted）/)])
})
