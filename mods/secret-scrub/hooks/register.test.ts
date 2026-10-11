import type { On } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'

import { BYPASS, bypassPattern, compilePatterns, MASK, scrub } from './scrub'

describe('scrub', () => {
  test('masks the value of a token query parameter and keeps the URL', () => {
    const { text, labels } = scrub(
      'http://localhost:3000/logs?format=text&reqId=0b56be&days=1&token=aiusdhvpaiudhpaids',
    )
    expect(text).toBe(`http://localhost:3000/logs?format=text&reqId=0b56be&days=1&token=${MASK}`)
    expect(labels).toEqual(['query token'])
  })

  test('masks token= in plain text, not only in URLs', () => {
    const { text, labels } = scrub('測試 token=abcdefgh12345678\n(api_key=abcdefgh12345678)')
    expect(text).toBe(`測試 token=${MASK}\n(api_key=${MASK})`)
    expect(labels).toEqual(['token', 'token'])
  })

  test('leaves generic names, longer names and placeholders in plain text alone', () => {
    const input = 'key={item.id} auth=abcdefgh12345678 csrf_token=abcdefgh12345678 token=${API_TOKEN} token={token}'
    expect(scrub(input)).toEqual({ text: input, labels: [] })
  })

  test('leaves short example values alone', () => {
    expect(scrub('用 `?token=xxx` 帶參數').labels).toEqual([])
  })

  test('masks env lines, bearer headers and known key formats', () => {
    const input = [
      'LOGS_ACCESS_TOKEN=abcdef1234567890',
      'curl -H "Authorization: Bearer abc.def-123456789"',
      // Fake keys assembled at runtime so the literals don't trip GitHub push protection.
      'key ' + 'sk-' + 'ant-api03-' + 'A'.repeat(28),
      'gh ' + 'ghp' + '_0123456789abcdefghijklmnopqrstuvwxyz',
    ].join('\n')
    const { text, labels } = scrub(input)
    expect(text).toBe(
      [
        `LOGS_ACCESS_TOKEN=${MASK}`,
        `curl -H "Authorization: Bearer ${MASK}"`,
        `key ${MASK}`,
        `gh ${MASK}`,
      ].join('\n'),
    )
    expect(labels.length).toBe(4)
  })

  test('does not touch commit hashes or ordinary prose', () => {
    const input = '在 commit 4907f8eb9d87c60dce588003b0767d8c1b720761 加上 tag v1，key 是 reqId'
    expect(scrub(input)).toEqual({ text: input, labels: [] })
  })
})

test('the prompt reaches the model scrubbed', async ($, on) => {
  let seen = ''
  on('prompt.submit', ($, e) => {
    seen = e.text

    return { text: e.text }
  })
  await $.prompt.submit({ text: '看這個 https://x.dev/logs?token=aiusdhvpaiudhpaids' } as never)
  expect(seen).toBe(`看這個 https://x.dev/logs?token=${MASK}`)
})

test('#noscrub sends the prompt as typed, minus the marker', async ($, on) => {
  let seen = ''
  on('prompt.submit', ($, e) => {
    seen = e.text

    return { text: e.text }
  })
  await $.prompt.submit({ text: '#noscrub token=aiusdhvpaiudhpaids' } as never)
  expect(seen).toBe('token=aiusdhvpaiudhpaids')
})


describe('settings', () => {
  test('custom rules mask the whole match; allow keeps a match as typed', () => {
    const rules = compilePatterns(['\\bINT-[0-9]{6}\\b', '(broken'], 'g')
    expect(rules.bad).toEqual(['(broken'])
    expect(scrub('ticket INT-123456 here', { rules: rules.patterns })).toEqual({ text: `ticket ${MASK} here`, labels: ['custom rule'] })
    const allow = compilePatterns(['^aiusdh'], '').patterns
    expect(scrub('token=aiusdhvpaiudhpaids', { allow }).labels).toEqual([])
    expect(scrub('token=zzusdhvpaiudhpaids', { allow }).labels).toEqual(['token'])
  })

  test('the bypass marker is a word of its own, whatever it is', () => {
    expect(BYPASS.test('#noscrub token=x')).toBe(true)
    expect(BYPASS.test('#noscrub，token=x')).toBe(true)
    expect(BYPASS.test('#noscrubbed')).toBe(false)
    const custom = bypassPattern('!raw')
    expect(custom.test('look !raw here')).toBe(true)
    expect(custom.test('look x!raw')).toBe(false)
  })
})

// The suite asserts the zh-TW wording, so the user file says zh-TW unless a test gives its own.
const USER_FILE = '/home/.claude/cc-mod-trimtab.json'
const ZH = '{"*":{"language":"zh-TW"}}'

function settings(on: On, files: Record<string, string>) {
  files = { [USER_FILE]: ZH, ...files }
  mock.store(on)
  mock.env(on, { HOME: '/home' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: null }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.read', ($, e) => {
    const text = files[e.path]
    if (text === undefined) {
      throw new Error('ENOENT')
    }

    return { value: text }
  })
}

test('settings change what is masked; a repo can add neither rules nor exceptions', { options: { bypass_marker: '!raw' } }, async ($, on) => {
  settings(on, {
    '/repo/.claude/cc-mod-trimtab.local.json': '{"secret-scrub":{"custom_rules":["\\\\bINT-[0-9]{6}\\\\b"],"allow":["test-[a-z]+"]}}',
    '/repo/.claude/cc-mod-trimtab.json': '{"secret-scrub":{"custom_rules":["(a+)+$"],"allow":[".*"]}}',
  })
  const seen: string[] = []
  on('prompt.submit', ($, e) => {
    seen.push(e.text)

    return { text: e.text }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'INT-123456 token=aiusdhvpaiudhpaids' } as never)
  // `allow` must match the whole value: `test-…` inside a longer secret is still masked.
  await $.prompt.submit({ text: 'token=test-abcdefgh token=sk-test-aiusdhvpaiudhpaids' } as never)
  await $.prompt.submit({ text: '!raw INT-123456' } as never)
  await $.prompt.submit({ text: '#noscrub INT-123456' } as never)
  expect(seen).toEqual([`${MASK} token=${MASK}`, `token=test-abcdefgh token=${MASK}`, 'INT-123456', `#noscrub ${MASK}`])
  const status = (await $.command.run({ command: 'secret-scrub', args: 'status' } as never)).text
  expect(status).toMatch(/repo 的 custom_rules：repo 檔案不能設定，改用 local 檔案/)
  expect(status).toMatch(/repo 的 allow：repo 檔案不能設定，改用 local 檔案/)
})

async function failingScrub($: Engine, on: On, files: Record<string, string>) {
  settings(on, files)
  let isSent = false
  on('prompt.submit', ($, e) => {
    isSent = true

    return { text: e.text }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const held = await $.prompt.submit({ text: null } as never)

  return { held, isSent }
}

test('a failing scrub holds the prompt back instead of sending it', async ($, on) => {
  const { held, isSent } = await failingScrub($, on, {})
  expect(held.drop).toContain('檢查失敗')
  expect(isSent).toBe(false)
})

test('the wording is English by default', async ($, on) => {
  const { held } = await failingScrub($, on, { [USER_FILE]: '' })
  expect(held.drop).toContain('the check failed')
  expect((await $.command.run({ command: 'secret-scrub', args: '' } as never)).text).toMatch(/^Usage: /)
})
