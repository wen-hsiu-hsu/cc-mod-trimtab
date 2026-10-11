// Rewrites Claude Code's prompt history (`history.jsonl`): one JSON object per line, the prompt as
// typed in `display` and pastes either inline (`pastedContents[n].content`) or in
// `paste-cache/<contentHash>.txt`. The prompt that reached the model was scrubbed; this file still
// holds what was typed, and the up-arrow recalls it from there.

import { BYPASS, scrub, type ScrubOptions } from './scrub'

type Paste = { content?: unknown; contentHash?: unknown }

type Entry = {
  display?: unknown
  sessionId?: unknown
  pastedContents?: Record<string, Paste>
}

export type HistoryScrub = {
  text: string
  // Lines rewritten, and the secrets masked in them.
  lines: number
  labels: string[]
  // Pastes kept in paste-cache by the lines looked at; their files are scrubbed separately.
  pasteHashes: string[]
}

// Scrubs every line, or only one session's when `sessionId` is given. A line sent with #noscrub
// stays as typed, and a line that is not JSON is left alone.
// `bypass` and `options`: the settings, as the prompt was scrubbed with them.
export function scrubHistory(input: string, sessionId?: string, bypass: RegExp = BYPASS, options: ScrubOptions = {}): HistoryScrub {
  const labels: string[] = []
  const pasteHashes = new Set<string>()
  let lines = 0

  const text = input
    .split('\n')
    .map(line => {
      if (line === '' || (sessionId !== undefined && !line.includes(sessionId))) {
        return line
      }
      let entry: Entry
      try {
        entry = JSON.parse(line)
      } catch {
        return line
      }
      if (typeof entry !== 'object' || entry === null) {
        return line
      }
      if (sessionId !== undefined && entry.sessionId !== sessionId) {
        return line
      }
      if (typeof entry.display === 'string' && bypass.test(entry.display)) {
        return line
      }

      const found: string[] = []
      if (typeof entry.display === 'string') {
        const scrubbed = scrub(entry.display, options)
        entry.display = scrubbed.text
        found.push(...scrubbed.labels)
      }
      for (const paste of Object.values(entry.pastedContents ?? {})) {
        if (typeof paste?.content === 'string') {
          const scrubbed = scrub(paste.content, options)
          paste.content = scrubbed.text
          found.push(...scrubbed.labels)
        }
        if (typeof paste?.contentHash === 'string' && /^[0-9a-f]+$/.test(paste.contentHash)) {
          pasteHashes.add(paste.contentHash)
        }
      }
      if (found.length === 0) {
        return line
      }
      lines++
      labels.push(...found)

      return JSON.stringify(entry)
    })
    .join('\n')

  return { text, lines, labels, pasteHashes: [...pasteHashes] }
}
