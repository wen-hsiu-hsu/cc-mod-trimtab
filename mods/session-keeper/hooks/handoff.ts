// Handoff to a new session: the texts, the new-task gate's prompt and the progress file.
// Pure functions, no `$`; sending, clearing and drawing are in register.tsx.
import type { CacheMeter, HandoffKind } from '../types'
import { pick, writeIn, type Lang } from './config'
import { TTL_MS } from './meter'

// Shared with project-memory, which writes the file after each distill: session-keeper overwrites
// it with a handoff summary and is the only one that reads it into a new session.
export const PROGRESS_FILE = '.claude/progress.md'
// A progress file older than this is not offered: the work has most likely moved on.
export const PROGRESS_MAX_AGE_MS = 24 * 60 * 60_000
// Sessions a progress file was offered to, remembered per file.
const OFFERED_KEEP = 5
export const DEFAULT_THRESHOLD = 150_000
// After the person kept working here, the context must grow this much before the next offer.
export const QUIET_TOKENS = 50_000
export const GATE_LOG_KEEP = 300
const GATE_PROMPTS = 5
const GATE_FILES = 8

export type GateMode = 'off' | 'suggest' | 'block'
export type HandoffConfig = { gate: GateMode; isAwayOn: boolean; isResumeOn: boolean }

export function handoffConfig(options: Record<string, unknown>): HandoffConfig {
  const gate = options.handoff_gate

  return {
    gate: gate === 'suggest' || gate === 'block' ? gate : 'off',
    isAwayOn: options.away_handoff === true,
    isResumeOn: options.progress_resume !== false,
  }
}

// The same threshold as the status line's ctx colour.
export function thresholdOf(env: string | undefined): number {
  const n = Number(env)

  return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD
}

// Sections ordered by what a successor most often gets wrong: taking unverified work for done,
// retrying what failed, missing what still runs, forgetting the person's limits.
// `isNewTaskIn`: the unrelated prompt went into the conversation (suggest mode), so the summary leaves it out.
// The prompt is English; the language the summary is written in follows the `language` setting.
export function handoffPrompt(kind: HandoffKind, isNewTaskIn = false, lang: Lang = 'en'): string {
  return [
    'Write a handoff for the new conversation that takes over this work. Start the first line with "HANDOFF:" and a one-sentence goal; keep the whole under 1800 words (1800 characters in Chinese).',
    ...(kind === 'new-task' && isNewTaskIn
      ? ['The last user message is an unrelated new task; leave it out of the handoff and cover only the work before it.']
      : []),
    'In order:',
    '1. Goal',
    '2. Verified: checks actually run with their results seen (tests, builds, command output); give the results',
    '3. Done but unverified: changes not yet checked, or conclusions from reasoning only',
    '4. Approaches tried that failed, and why (the successor should not try them again)',
    '5. What still runs or is unfinished: background processes, dev servers, uncommitted changes and their branch, temp files',
    '6. Decisions made and why, and the limits the user gave during this work (for example no pushing, ask first)',
    '7. Relevant file paths, and the commands to re-check the current state on pickup',
    '8. Next step: one concrete action',
    '9. Questions waiting for the user',
    '10. Other: anything the list above does not cover but the successor needs to know, in any format',
    'Write only the facts the successor needs; write "none" for an empty item; no pleasantries.',
    'For content written elsewhere (spec, plan, issue, commit, diff) give the path or link; do not copy it.',
    'Never include secrets, tokens, passwords or personal data: the handoff is saved as a file in the repo.',
    `${writeIn(lang)} Keep code, commands, paths and error messages in their original form.`,
  ].join('\n')
}

// The new session's draft: what the person reviews before sending.
export function handoffDraft(kind: HandoffKind, summary: string, prompt: string, held: readonly string[], lang: Lang = 'en'): string {
  const asked = [prompt, ...held].map(s => s.trim()).filter(s => s !== '')
  if (kind === 'new-task') {
    return asked.join('\n\n')
  }
  const intro =
    kind === 'away'
      ? pick(lang, {
          en: '(session-keeper) The cache of the previous conversation expired; here is its handoff summary. Continue from it:',
          'zh-TW': '（session-keeper）上一段對話的快取已過期，以下是它的交接摘要，從這裡接續：',
        })
      : pick(lang, {
          en: '(session-keeper) Here is the handoff summary of the previous conversation. Continue from it:',
          'zh-TW': '（session-keeper）以下是上一段對話的交接摘要，從這裡接續：',
        })
  const tail = asked.length === 0 ? [] : ['', '---', '', ...asked.flatMap((s, i) => (i > 0 ? ['', s] : [s]))]

  return [intro, '', summary.trim(), ...tail].join('\n')
}

// Whether the cache under a large context has lapsed, so the next prompt re-writes all of it.
export function isColdAndLarge(meter: CacheMeter, sessionId: string, now: number, threshold: number): boolean {
  return (
    meter.sessionId === sessionId &&
    meter.lastInput >= threshold &&
    meter.ttl !== null &&
    now - meter.lastAt >= TTL_MS[meter.ttl]
  )
}

// The context the new-task gate starts at: the threshold, or past the quiet mark after a stay.
export function gateFloor(threshold: number, quiet: { sessionId: string; tokens: number }, sessionId: string): number {
  return quiet.sessionId === sessionId ? Math.max(threshold, quiet.tokens) : threshold
}

// Sent to the model only, so always English.
export const GATE_SYSTEM = [
  'You judge whether a new message the user sent in a coding conversation continues the current work or starts an unrelated new task.',
  "Follow-ups, corrections, additions, answers to Claude's questions, and the next step on the same feature or the same files all count as continuing (related).",
  'Only starting something unrelated to the current work counts as a new task (new).',
  'When unsure, answer related. Reply with one word: related or new.',
].join('\n')

type GateMessage = { role: 'user' | 'assistant'; text: string; toolUses: readonly { input: Record<string, unknown> }[] }

// What the gate's model reads: the task in the progress file, the latest prompts, the files touched.
export function gatePrompt(text: string, messages: readonly GateMessage[], task: string | undefined): string {
  const prompts = messages
    .filter(m => m.role === 'user' && m.text.trim() !== '')
    .slice(-GATE_PROMPTS)
    .map(m => `- ${clip(m.text, 300)}`)
  const files: string[] = []
  for (const m of [...messages].reverse()) {
    for (const use of m.toolUses) {
      const path = use.input.file_path ?? use.input.path
      if (typeof path === 'string' && !files.includes(path)) {
        files.push(path)
      }
    }
    if (files.length >= GATE_FILES) {
      break
    }
  }

  return [
    `Current task (from the progress file; may lag behind): ${task ?? '(none)'}`,
    '',
    'Recent user messages:',
    ...(prompts.length > 0 ? prompts : ['(none)']),
    '',
    `Files touched recently: ${files.length > 0 ? files.slice(0, GATE_FILES).join(', ') : '(none)'}`,
    '',
    'New message:',
    clip(text, 1000),
  ].join('\n')
}

export function parseVerdict(reply: string): 'new' | 'related' | undefined {
  const word = reply.trim().toLowerCase()
  if (word.startsWith('new')) {
    return 'new'
  }

  return word.startsWith('related') ? 'related' : undefined
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

// ---------- the gate's log: verdicts against what the person chose ----------

export type GateChoice = 'handoff' | 'stay' | 'ignored'
export type GateEntry = {
  at: number
  context: number
  mode: GateMode
  verdict: 'new' | 'related'
  choice?: GateChoice
  prompt: string
}

export const gateEntry = (at: number, context: number, mode: GateMode, verdict: 'new' | 'related', text: string): GateEntry => ({
  at,
  context,
  mode,
  verdict,
  prompt: clip(text, 60),
})

export function gateStats(log: readonly GateEntry[], now: number, days: number, lang: Lang = 'en'): string {
  const since = now - days * 24 * 60 * 60_000
  const recent = log.filter(e => e.at >= since)
  const offered = recent.filter(e => e.verdict === 'new')
  const count = (choice: GateChoice) => offered.filter(e => e.choice === choice).length
  const [handoff, stay, ignored] = [count('handoff'), count('stay'), count('ignored')]
  const answered = handoff + stay + ignored
  const wrong = answered === 0 ? '—' : `${Math.round(((stay + ignored) / answered) * 100)}%`

  return [
    pick(lang, {
      en: `new-task gate, last ${days} days: ${recent.length} judged, ${offered.length} judged new`,
      'zh-TW': `new-task gate，最近 ${days} 天：判斷 ${recent.length} 次，判為新任務 ${offered.length} 次`,
    }),
    pick(lang, {
      en: `  handed off ${handoff}, stayed ${stay}, ignored ${ignored}; share judged new but not handed off ${wrong}`,
      'zh-TW': `  交接 ${handoff}、留下 ${stay}、忽略 ${ignored}；判為新任務卻沒交接的比例 ${wrong}`,
    }),
    ...offered.slice(-10).map(e => `  ${e.choice ?? pick(lang, { en: 'no response', 'zh-TW': '未回應' })}  ${Math.round(e.context / 1000)}k  ${e.prompt}`),
  ].join('\n')
}

// ---------- the progress file ----------

export type ProgressHead = { session: string; updated: number; source: string }

export function parseProgress(text: string): { head: ProgressHead; body: string } | undefined {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  if (match === null) {
    return undefined
  }
  const field = (name: string) => new RegExp(`^${name}:\\s*(.*)$`, 'm').exec(match[1] ?? '')?.[1]?.trim() ?? ''
  const updated = Date.parse(field('updated'))

  return Number.isNaN(updated)
    ? undefined
    : { head: { session: field('session'), updated, source: field('source') }, body: text.slice(match[0].length).trim() }
}

// The task line of the file, as project-memory writes it (in either language), or the summary's HANDOFF line.
export function progressTask(body: string): string | undefined {
  const line = /^- (?:任務：|Task:\s*)(.+)$/m.exec(body)?.[1] ?? /^HANDOFF:\s*(.+)$/m.exec(body)?.[1]

  return line === undefined ? undefined : clip(line, 120)
}

export function renderHandoff(summary: string, session: string, at: number, stamp: string, lang: Lang = 'en'): string {
  return [
    '---',
    'source: session-keeper',
    `session: ${session}`,
    `updated: ${new Date(at).toISOString()}`,
    '---',
    '',
    pick(lang, { en: `# Handoff (${stamp})`, 'zh-TW': `# 交接（${stamp}）` }),
    '',
    summary.trim(),
    '',
  ].join('\n')
}

export type Offered = { updated: number; sessions: string[] }

// The note handed to the model beside the first prompt of a session, or undefined when the file
// is its own, too old, or already offered to it.
export function progressNote(text: string, sessionId: string, now: number, offered: Offered | undefined): string | undefined {
  const parsed = parseProgress(text)
  if (parsed === undefined || parsed.body === '') {
    return undefined
  }
  const { head, body } = parsed
  const isOffered = offered !== undefined && offered.updated === head.updated && offered.sessions.includes(sessionId)
  if (head.session === sessionId || isOffered || now - head.updated > PROGRESS_MAX_AGE_MS) {
    return undefined
  }

  // Handed to the model beside the prompt, so always English.
  return [
    `(session-keeper) Progress left by the previous conversation (${ago(now - head.updated)}); it may be unrelated to this work:`,
    '',
    body,
    '',
    'If the user wants to pick it up, start from this and check the actual files and git state before acting; if the user is doing something else, ignore it and do not bring it up.',
  ].join('\n')
}

export function withOffered(offered: Offered | undefined, updated: number, sessionId: string): Offered {
  const sessions = offered?.updated === updated ? offered.sessions : []

  return { updated, sessions: [...sessions.filter(s => s !== sessionId), sessionId].slice(-OFFERED_KEEP) }
}

function ago(ms: number): string {
  const min = Math.round(Math.max(0, ms) / 60_000)
  if (min < 1) {
    return 'just now'
  }

  return min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`
}

// `.git/info/exclude` with the progress file listed once (project-memory adds the same line).
export function withExclude(text: string): string | undefined {
  const line = `/${PROGRESS_FILE}`
  if (text.split('\n').some(l => l.trim() === line)) {
    return undefined
  }

  return `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}# session-keeper\n${line}\n`
}
