import type { On, TurnUsage } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { CacheMeter } from '../types'
import { KEEP_PROMPT, keepConfig, keepDueAt, skipReason } from './keep'
import { EMPTY, fmtDuration, fmtTokens, record, segments, toolsKey, ttlFromTranscript } from './meter'

const MIN = 60_000
const step = { at: 0, model: 'opus', toolsKey: 'k', input: 10, output: 500, read: 0, write: 0 }

describe('meter', () => {
  test('counts the hit ratio over every request', () => {
    let m = record(EMPTY, { ...step, write: 50_000 })
    m = record(m, { ...step, at: MIN, read: 50_000, write: 2_000 })
    expect(m.misses).toBe(0)
    expect(segments({ ...m, ttl: '1h' }, 2 * MIN).map(s => s.text)).toEqual([
      expect.stringMatching(/^warm 1h \[\d\d:\d\d\] 59m left$/),
      'hit 49%',
    ])
  })

  test('counts a miss and guesses its causes', () => {
    const warm = record(EMPTY, { ...step, write: 80_000 })
    const m = record({ ...warm, ttl: '5m' }, { ...step, at: 10 * MIN, model: 'sonnet', read: 0, write: 80_500 })
    expect(m.misses).toBe(1)
    expect(m.missTokens).toBe(80_500)
    expect(m.lastCauses).toEqual(['model?', 'ttl?'])
    expect(segments(m, 10 * MIN).at(-1)).toEqual({ text: 'miss 1 +80.5k (model? +1)', tone: 'warn' })
  })

  test('does not count the rebuild after a compaction', () => {
    const warm = record(EMPTY, { ...step, write: 80_000 })
    const m = record({ ...warm, expectRebuild: true }, { ...step, at: MIN, write: 20_000 })
    expect(m.misses).toBe(0)
    expect(m.expectRebuild).toBe(false)
  })

  test('names an unexplained miss unknown', () => {
    const warm = record(EMPTY, { ...step, write: 80_000 })
    expect(record(warm, { ...step, at: MIN, read: 1_000, write: 79_000 }).lastCauses).toEqual(['unknown'])
    expect(record(warm, { ...step, at: MIN, toolsKey: 'other', write: 79_000 }).lastCauses).toEqual(['tools?'])
  })

  test('colors the countdown and the cold cache', () => {
    const m: CacheMeter = { ...record(EMPTY, { ...step, write: 1_000 }), ttl: '1h' }
    expect(segments(m, 30 * MIN)[0]?.tone).toBe('dim')
    expect(segments(m, 57 * MIN)[0]).toMatchObject({ tone: 'warn', text: expect.stringContaining('3m left') })
    expect(segments(m, 61 * MIN)[0]).toEqual({ text: 'cold, next +1.5k', tone: 'hot' })
    expect(segments({ ...m, ttl: '5m' }, 3 * MIN)[0]?.tone).toBe('dim')
    expect(segments({ ...m, ttl: '5m' }, 4.5 * MIN)[0]?.tone).toBe('warn')
  })

  test('shows a placeholder before any cache use', () => {
    expect(segments(EMPTY, 0)).toEqual([{ text: '—', tone: 'dim' }])
  })

  test('reads the latest TTL off the transcript', () => {
    const line = (m5: number, h1: number) =>
      `{"cache_creation":{"ephemeral_5m_input_tokens":${m5},"ephemeral_1h_input_tokens":${h1}}}`
    expect(ttlFromTranscript([line(0, 900), line(0, 0)].join('\n'))).toBe('1h')
    expect(ttlFromTranscript([line(0, 900), line(300, 0)].join('\n'))).toBe('5m')
    expect(ttlFromTranscript('{}')).toBeNull()
  })

  test('formats tokens, durations and tool lists', () => {
    expect(fmtTokens(950)).toBe('950')
    expect(fmtTokens(184_300)).toBe('184.3k')
    expect(fmtTokens(200_000)).toBe('200k')
    expect(fmtDuration(45_000)).toBe('45s')
    expect(fmtDuration(23 * MIN)).toBe('23m')
    expect(fmtDuration(60 * MIN)).toBe('1h00m')
    expect(toolsKey(['b', 'a'])).toBe(toolsKey(['a', 'b']))
  })
})

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } } as const
const USAGE: TurnUsage = {
  model: 'opus',
  input_tokens: 10,
  output_tokens: 500,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 40_000,
}

function engine(on: On, usage: TurnUsage = USAGE): ReturnType<typeof mock.clock> {
  const clock = mock.clock(on)
  mock.env(on, {})
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('tool.list', () => ({ value: [{ name: 'Bash', description: '', mcp: false }] }))
  on('classic.Stop', () => ({}))
  on('ui.log', () => ({ value: undefined }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  })
  // Another plugin's band beneath: it must stay visible under the cache line.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>band beneath</Text>
  })

  return clock
}

test('draws the cache line on the desktop only', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'opus', messageCount: 1 })) {
    // drain the stream
  }

  const desktop = await $.ui.mount({ plugin: 'session-keeper', surface: 'desktop', ...BAND } as never)
  expect(await desktop.find({ type: 'Text', text: /^warm/ })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: 'cache' })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /hit 0%/ })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: 'band beneath' })).toBeDefined()
  await desktop.unmount()

  const terminal = await $.ui.mount({ plugin: 'session-keeper', surface: 'terminal', ...BAND } as never)
  expect(await terminal.find({ type: 'Text', text: /cache/ })).toBeUndefined()
  expect(await terminal.find({ type: 'Text', text: 'band beneath' })).toBeDefined()
  await terminal.unmount()
})

describe('keep', () => {
  const config = keepConfig({ keep_warm: true })
  const warm: CacheMeter = { ...record({ ...EMPTY, sessionId: 's1' }, { ...step, write: 40_000 }), ttl: '1h' }

  test('reads the options, clamped', () => {
    expect(config).toEqual({ isOn: true, idleMs: 55 * MIN, maxKeeps: 3 })
    expect(keepConfig({}).isOn).toBe(false)
    expect(keepConfig({ keep_warm: false, idle_minutes: 90, max_keeps: 0 })).toEqual({
      isOn: false,
      idleMs: 59 * MIN,
      maxKeeps: 1,
    })
  })

  test('is due an idle stretch after the latest request, until the keeps run out', () => {
    expect(keepDueAt(warm, config)).toBe(55 * MIN)
    expect(keepDueAt({ ...warm, keeps: 3 }, config)).toBeNull()
    expect(keepDueAt(EMPTY, config)).toBeNull()
    expect(keepDueAt(warm, { ...config, isOn: false })).toBeNull()
  })

  test('keeps only a known 1h cache of a large context that is still warm', () => {
    expect(skipReason(warm, 's1', 55 * MIN, config)).toBeUndefined()
    expect(skipReason({ ...warm, ttl: '5m' }, 's1', 55 * MIN, config)).toBe('ttl 5m')
    expect(skipReason({ ...warm, ttl: null }, 's1', 55 * MIN, config)).toBe('ttl unknown')
    expect(skipReason({ ...warm, lastInput: 20_000 }, 's1', 55 * MIN, config)).toMatch(/^context/)
    expect(skipReason(warm, 's2', 55 * MIN, config)).toBe('another conversation')
    expect(skipReason(warm, 's1', 61 * MIN, config)).toBe('already cold')
  })

  test('a new request starts a new idle stretch', () => {
    expect(record({ ...warm, keeps: 2 }, { ...step, at: MIN, read: 40_000 }).keeps).toBe(0)
  })

  test('shows the keeps on the line', () => {
    expect(segments({ ...warm, keeps: 1 }, MIN, 3).map(s => s.text)).toContain('kept 1/3')
    expect(segments(warm, MIN, 3).map(s => s.text)).not.toContain('kept 0/3')
  })
})

test('forks once the cache has idled, and renews its expiry', { options: { keep_warm: true } }, async ($, on) => {
  const clock = engine(on)
  on('fs.read', () => ({ value: '{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":40000}' }))
  const prompts: string[] = []
  on('model.fork', ($, e) => {
    prompts.push(e.prompt)

    return {
      value: {
        isAnswered: true,
        text: 'OK',
        usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 0 },
      },
    }
  })
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'opus', messageCount: 1 })) {
    // drain the stream
  }
  await $.classic.Stop({ transcript_path: '/t.jsonl' } as never)

  await clock.advance(54 * MIN)
  expect(prompts).toEqual([])
  await clock.advance(MIN)
  expect(prompts).toEqual([KEEP_PROMPT])

  const band = await $.ui.mount({ plugin: 'session-keeper', surface: 'desktop', ...BAND } as never)
  expect(await band.find({ type: 'Text', text: 'kept 1/3' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^warm 1h .* 1h00m left$/ })).toBeDefined()
  await band.unmount()

  // Two more, then the stretch's keeps are used up and the cache lapses.
  await clock.advance(3 * 55 * MIN)
  expect(prompts.length).toBe(3)
  await clock.advance(55 * MIN)
  expect(prompts.length).toBe(3)
})

test('does not fork a 5m cache', { options: { keep_warm: true } }, async ($, on) => {
  const clock = engine(on)
  on('fs.read', () => ({ value: '{"ephemeral_5m_input_tokens":40000,"ephemeral_1h_input_tokens":0}' }))
  let forks = 0
  on('model.fork', () => {
    forks += 1

    return { value: { isAnswered: false, reason: 'nothing-to-fork' } }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'opus', messageCount: 1 })) {
    // drain the stream
  }
  await $.classic.Stop({ transcript_path: '/t.jsonl' } as never)
  await clock.advance(2 * 55 * MIN)
  expect(forks).toBe(0)
})

