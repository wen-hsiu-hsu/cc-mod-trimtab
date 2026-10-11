// The conversation as plain text for the distill model: tool inputs and results clipped, secrets
// masked with secret-scrub's rules, only what came after the last distill. Pure functions, no `$`.
// It is read by the model only, so its labels are English.
import { scrub } from './scrub'

const TRANSCRIPT_MAX_CHARS = 300_000
const TOOL_INPUT_CHARS = 300
const TOOL_RESULT_CHARS = 500

// Every message this mod adds to the conversation starts with it: context for the model, never evidence.
export const TAG = '[project-memory]'

export type Row = {
  role: 'user' | 'assistant'
  text: string
  toolUses: readonly { tool: string; input: Record<string, unknown>; text?: string; isError?: true }[]
}

// The start of a person's message, kept as where the next distill begins.
export const anchorOf = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 30)
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}… (truncated, was ${s.length} characters)` : s)

// Rows after the latest user message that opens with the anchor; all rows when there is none.
export function transcriptOf(rows: readonly Row[], anchor: string | undefined) {
  let start = 0
  let found = false
  if (anchor) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]
      if (r?.role === 'user' && r.text.replace(/\s+/g, ' ').includes(anchor)) {
        start = i + 1
        found = true
        break
      }
    }
  }
  const lines: string[] = []
  for (const r of rows.slice(start)) {
    if (r.role === 'user') {
      if (r.text.trim()) lines.push(`[User] ${r.text.trim()}`)
      continue
    }
    if (r.text.trim()) lines.push(`[Assistant] ${r.text.trim()}`)
    for (const u of r.toolUses) {
      const out = u.text === undefined ? '' : ` → ${u.isError ? 'error: ' : ''}${clip(u.text.replace(/\s+/g, ' '), TOOL_RESULT_CHARS)}`
      lines.push(`  [tool ${u.tool}] ${clip(JSON.stringify(u.input), TOOL_INPUT_CHARS)}${out}`)
    }
  }
  let text = scrub(lines.join('\n')).text
  if (text.length > TRANSCRIPT_MAX_CHARS) text = `(first ${text.length - TRANSCRIPT_MAX_CHARS} characters omitted)\n${text.slice(-TRANSCRIPT_MAX_CHARS)}`

  return { text, found }
}

// The person's own words, spaces removed, to check a quoted memory against; this mod's own
// messages do not count.
export const squash = (s: string) => s.replace(/\s+/g, '')
export const userTextOf = (rows: readonly Row[]) =>
  squash(rows.filter(r => r.role === 'user' && !r.text.startsWith(TAG)).map(r => r.text).join('\n'))

// The last person message's anchor: where this distill ends and the next begins.
export function lastAnchor(rows: readonly Row[]) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r?.role === 'user' && r.text.trim() && !r.text.startsWith(TAG)) return anchorOf(r.text)
  }

  return undefined
}
