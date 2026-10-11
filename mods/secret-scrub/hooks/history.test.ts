import { describe, expect, test } from 'claude-code/testing'

import { scrubHistory } from './history'
import { MASK } from './scrub'

const line = (display: string, sessionId: string, pastedContents: object = {}) =>
  JSON.stringify({ display, pastedContents, timestamp: 1, project: '/p', sessionId })

describe('scrubHistory', () => {
  test('masks the display and inline pastes of the given session only', () => {
    const input = [
      line('看 https://x.dev/logs?token=aiusdhvpaiudhpaids', 'a', {
        1: { id: 1, type: 'text', content: 'API_TOKEN=abcdef1234567890' },
      }),
      line('看 https://x.dev/logs?token=aiusdhvpaiudhpaids', 'b'),
      '',
    ].join('\n')
    const result = scrubHistory(input, 'a')
    const [first, second, last] = result.text.split('\n')
    expect(JSON.parse(first).display).toBe(`看 https://x.dev/logs?token=${MASK}`)
    expect(JSON.parse(first).pastedContents[1].content).toBe(`API_TOKEN=${MASK}`)
    expect(second).toBe(input.split('\n')[1])
    expect(last).toBe('')
    expect(result.lines).toBe(1)
    expect(result.labels).toEqual(['query token', 'env secret'])
  })

  test('scrubs every session without a filter, keeps #noscrub and non-JSON lines', () => {
    const noscrub = line('#noscrub token=aiusdhvpaiudhpaids', 'a')
    const input = [noscrub, 'not json token=aiusdhvpaiudhpaids', line('x?token=aiusdhvpaiudhpaids', 'b')].join('\n')
    const result = scrubHistory(input)
    expect(result.text.split('\n').slice(0, 2)).toEqual(input.split('\n').slice(0, 2))
    expect(result.lines).toBe(1)
  })

  test('collects paste-cache hashes and leaves clean lines byte for byte', () => {
    const input = line('[Pasted text #1 +3 lines]', 'a', { 1: { id: 1, type: 'text', contentHash: '9ce5c942b6bd57fa' } })
    const result = scrubHistory(input, 'a')
    expect(result.text).toBe(input)
    expect(result.pasteHashes).toEqual(['9ce5c942b6bd57fa'])
  })
})
