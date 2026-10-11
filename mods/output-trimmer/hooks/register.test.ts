import { describe, expect, test } from 'claude-code/testing'

import { LIMITS, asLog, shouldTrim, trim } from './trim'

describe('shouldTrim', () => {
  test('trims runners and builds', () => {
    expect(shouldTrim('npx vitest run --dir src')).toBe(true)
    expect(shouldTrim('cd /repo && npm run build')).toBe(true)
    expect(shouldTrim('git push origin main')).toBe(true)
  })

  test('leaves reads, searches and diffs whole', () => {
    expect(shouldTrim('cat src/a.ts')).toBe(false)
    expect(shouldTrim("sed -n '1,400p' a.ts")).toBe(false)
    expect(shouldTrim('cd /repo && grep -rn foo src')).toBe(false)
    expect(shouldTrim('git -C sub diff HEAD~1')).toBe(false)
    expect(shouldTrim('/usr/bin/cat a')).toBe(false)
  })

  test('honours # notrim', () => {
    expect(shouldTrim('npm test # notrim')).toBe(false)
  })
})

describe('trim', () => {
  test('passes short output whole', () => {
    expect(trim('ok\n'.repeat(10), '/tmp/x.log')).toBeUndefined()
  })

  test('keeps head, tail and failure lines from the middle', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`)
    lines[500] = ' FAIL src/a.test.ts > adds numbers'
    lines[501] = '   AssertionError: expected 3 to be 4'
    const out = trim(lines.join('\n'), '/tmp/x.log')!
    const kept = out.text.split('\n')
    expect(kept[0]).toContain('/tmp/x.log')
    expect(kept[1]).toBe('line 1')
    expect(out.text).toContain('L501:  FAIL src/a.test.ts')
    expect(out.text).toContain('L502:    AssertionError')
    expect(kept[kept.length - 1]).toBe('line 1000')
    expect(out.dropped).toBe(1000 - LIMITS.head - LIMITS.tail - 2)
    expect(kept.length).toBeLessThan(LIMITS.head + LIMITS.tail + LIMITS.signals + 5)
  })

  test('trims one huge line by characters', () => {
    const out = trim('x'.repeat(50000), '/tmp/x.log')!
    expect(out.text.length).toBeLessThan(1000)
  })
})

describe('asLog', () => {
  test('ends the saved file with a newline', () => {
    expect(asLog('a\nb')).toBe('a\nb\n')
    expect(asLog('a\nb\n')).toBe('a\nb\n')
  })
})
