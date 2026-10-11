import type { On } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'

import { claimsDone, doneCheck, failureSignature, freshWork, isCheckCommand, noteCall, trackFailure } from './loops'
import type { Streak } from './loops'

const NUDGE = 'failed twice in a row for the same reason'

describe('failureSignature', () => {
  test('treats errors that differ only in paths, numbers and spacing as one', () => {
    const a = failureSignature('Error: ENOENT  C:\\work\\a\\x.ts line 12\n  at foo (/srv/a/b.js:3:4)')
    const b = failureSignature('Error: ENOENT D:/other/y.ts line 99 at foo (/tmp/c.js:7:8)')
    expect(a).toBe(b)
    expect(failureSignature('Error: A')).not.toBe(failureSignature('Error: B'))
    expect(failureSignature('x'.repeat(500)).length).toBe(200)
    expect(failureSignature(undefined)).toBe('')
  })
})

describe('trackFailure', () => {
  test('nudges on the second same failure, once per streak; a success or a new error starts over', () => {
    const streaks = new Map<string, Streak>()
    const call = (isError: boolean, text?: string) => trackFailure(streaks, 'Bash', 'Bash', isError, text)
    expect(call(true, 'boom 1')).toBeUndefined()
    expect(call(true, 'boom 2')).toContain(NUDGE)
    expect(call(true, 'boom 3')).toBeUndefined()
    expect(call(false)).toBeUndefined()
    expect(call(true, 'boom 4')).toBeUndefined()
    expect(call(true, 'other error')).toBeUndefined()
    expect(call(true, 'other error')).toContain(NUDGE)
  })

  test('does not count the user rejecting a call', () => {
    const streaks = new Map<string, Streak>()
    const rejected = "The user doesn't want to proceed with this tool use"
    expect(trackFailure(streaks, 'Bash', 'Bash', true, rejected)).toBeUndefined()
    expect(trackFailure(streaks, 'Bash', 'Bash', true, rejected)).toBeUndefined()
  })

  test('names the tool and the first error line; tools are counted apart', () => {
    const streaks = new Map<string, Streak>()
    expect(trackFailure(streaks, 'Read', 'Read', true, 'no such file\nmore')).toBeUndefined()
    expect(trackFailure(streaks, 'Bash', 'Bash', true, 'no such file\nmore')).toBeUndefined()
    const nudge = trackFailure(streaks, 'Read', 'Read', true, 'no such file\nmore')
    expect(nudge).toStartWith('[self-check] ')
    expect(nudge).toContain('Read')
    expect(nudge).toContain('no such file')
    expect(nudge).not.toContain('more')
  })
})

describe('isCheckCommand', () => {
  test('counts tests, checks and builds, not reads', () => {
    for (const command of [
      'npm test',
      'npm run test:brief',
      'pytest -q',
      'go test ./...',
      'cd x && npx tsc -p .',
      'claude plugin test mods/self-check',
      'npm run build',
      'make lint',
    ]) {
      expect(isCheckCommand(command)).toBe(true)
    }
    for (const command of ['ls tests/', 'cat test.js', 'git commit -m "add tests"', 'grep -rn check src', 'echo done', 'node run.js', '']) {
      expect(isCheckCommand(command)).toBe(false)
    }
  })
})

describe('claimsDone', () => {
  test('reads claims, not negations, questions or replies that admit no check', () => {
    for (const message of ['已經改好了，完成了。', '都好了', '修好了', '已修正 parser 的問題', 'All done.', "I've fixed it", 'It is now fixed and working.']) {
      expect(claimsDone(message)).toBe(true)
    }
    for (const message of ['還沒完成，我再看看', '尚未完成', '我先看過程式碼', '要我完成嗎？', 'Is it done?', '完成了，但我沒有跑測試', 'Done, though I could not run the tests', undefined, '']) {
      expect(claimsDone(message)).toBe(false)
    }
  })
})

describe('doneCheck', () => {
  test('blocks an edit with no check after it, once a turn', () => {
    const work = freshWork()
    noteCall(work, 'Edit', { file_path: 'src/a.ts' }, false)
    expect(doneCheck(work, '完成了', false, 'zh-TW')).toContain('[self-check]')
    expect(doneCheck(work, '完成了', false)).toBeUndefined()
  })

  test('lets a check after the last edit through', () => {
    const work = freshWork()
    noteCall(work, 'Edit', { file_path: 'src/a.ts' }, false)
    noteCall(work, 'Bash', { command: 'npm test' }, true)
    expect(doneCheck(work, '完成了', false)).toBeUndefined()
  })

  test('asks again when the code is edited after the check', () => {
    const work = freshWork()
    noteCall(work, 'Bash', { command: 'npm test' }, false)
    noteCall(work, 'Write', { file_path: 'src/a.ts' }, false)
    expect(doneCheck(work, '完成了', false)).toBeDefined()
  })

  test('ignores docs, failed edits, a stop already blocked and no claim', () => {
    const docs = freshWork()
    noteCall(docs, 'Edit', { file_path: 'README.md' }, false)
    expect(doneCheck(docs, '完成了', false)).toBeUndefined()

    const failed = freshWork()
    noteCall(failed, 'Edit', { file_path: 'src/a.ts' }, true)
    expect(doneCheck(failed, '完成了', false)).toBeUndefined()

    const edited = freshWork()
    noteCall(edited, 'Edit', { file_path: 'src/a.ts' }, false)
    expect(doneCheck(edited, '完成了', true)).toBeUndefined()
    expect(doneCheck(edited, '我改了 a.ts，要繼續嗎？', false)).toBeUndefined()
  })
})

// The engine beneath: Edit and Read answer, Bash fails with the text in `failing`,
// and a Stop hook beneath answers `stopBeneath()`.
function engine(
  on: On,
  failing: { text?: string } = {},
  stopBeneath: () => { block?: string } = () => ({}),
): { logs: string[] } {
  const logs: string[] = []
  on('ui.log', ($, e) => {
    logs.push(e.text)

    return { value: undefined } as never
  })
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash' && failing.text !== undefined) {
      return { isError: true, result: failing.text, text: failing.text } as never
    }

    return { result: {}, text: 'ok' } as never
  })
  on('classic.Stop', () => stopBeneath())

  return { logs }
}

async function stop($: Engine, message: string, isActive = false) {
  return $.classic.Stop({ stop_hook_active: isActive, last_assistant_message: message })
}

test('blocks the stop once when code was edited and not checked', async ($, on) => {
  const { logs } = engine(on)
  await begin($, on)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as never)
  const first = await stop($, '完成了。')
  expect(first.block).toContain('沒有跑任何測試')
  expect(logs.length).toBe(1)
  expect((await stop($, '完成了。', true)).block).toBeUndefined()
  // The record was cleared with the stop that went through.
  expect((await stop($, '完成了。')).block).toBeUndefined()
})

test('lets the stop through after a check', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  expect((await stop($, '完成了。')).block).toBeUndefined()
})

test('leaves the stop alone when done_check is off', { options: { done_check: false } }, async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as never)
  expect((await stop($, '完成了。')).block).toBeUndefined()
})

test('an interrupted turn does not carry its edits into the next', async ($, on) => {
  engine(on)
  on('turn.complete', ($, e) => ({ text: e.answer }) as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as never)
  await $.turn.complete({ answer: '', reason: 'aborted', durationMs: 1, isAborted: true, turnId: 't1' } as never)
  expect((await stop($, '完成了。')).block).toBeUndefined()
})

test('adds the nudge to the second same failure', async ($, on) => {
  engine(on, { text: 'Error: cannot find module ./a at line 3' })
  const first = await $.tool.call({ tool: 'Bash', command: 'node a.js' } as never)
  expect(first.context ?? []).toEqual([])
  const second = await $.tool.call({ tool: 'Bash', command: 'node a.js' } as never)
  expect(second.isError).toBe(true)
  expect((second.context ?? []).join('')).toContain(NUDGE)
})

test('adds no nudge when retry_nudge is off', { options: { retry_nudge: false } }, async ($, on) => {
  engine(on, { text: 'Error: cannot find module ./a' })
  await $.tool.call({ tool: 'Bash', command: 'node a.js' } as never)
  const second = await $.tool.call({ tool: 'Bash', command: 'node a.js' } as never)
  expect(second.context ?? []).toEqual([])
})

// Plugins beneath may refuse a call or keep the turn going; self-check must judge only what went through.
test('a call a plugin beneath denies is no edit', async ($, on) => {
  on('tool.call', () => ({ deny: 'blocked beneath' }))
  on('classic.Stop', () => ({}))
  const denied = await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as never)
  expect(denied.deny).toBe('blocked beneath')
  expect((await stop($, '完成了。')).block).toBeUndefined()
})

test('a Stop hook beneath that keeps the turn going is passed on, and the record is kept', async ($, on) => {
  let isBeneathBlocking = true
  engine(on, {}, () => (isBeneathBlocking ? { block: 'beneath: keep going' } : {}))
  await begin($, on)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as never)
  expect((await stop($, '完成了。')).block).toBe('beneath: keep going')
  isBeneathBlocking = false
  expect((await stop($, '完成了。')).block).toContain('沒有跑任何測試')
})

// A session whose user settings file says `userFile`; the suite asserts zh-TW wording, so that is the default.
async function begin($: Engine, on: On, userFile = '{"*":{"language":"zh-TW"}}') {
  mock.store(on)
  mock.clock(on)
  mock.env(on, {})
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: null }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.read', ($, e) => {
    if (e.path === '/.claude/cc-mod-trimtab.json') {
      return { value: userFile }
    }
    throw new Error('ENOENT')
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
}

test('/self-check set done_check off turns the check off for this session', async ($, on) => {
  engine(on)
  await begin($, on)
  const set = await $.command.run({ command: 'self-check', args: 'set done_check off' } as never)
  expect(set.text).toMatch(/done_check 現在是 false（來自 session）/)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as never)
  expect((await stop($, '完成了。')).block).toBeUndefined()
})

test('the wording is English by default, and the nudge for Claude is English in either language', async ($, on) => {
  engine(on, { text: 'Error: cannot find module ./a at line 3' })
  await begin($, on, '')
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as never)
  expect((await stop($, '完成了。')).block).toContain('ran no tests, build or check')
  expect((await $.command.run({ command: 'self-check', args: '' } as never)).text).toMatch(/^Usage: /)
})
