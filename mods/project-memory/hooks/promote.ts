// Rules and procedures confirmed often enough go into the repository: which ones to hand Claude,
// the text that asks, and what Claude reports back. Adapted from ctx-handoff-mod's promote.ts (MIT).
// Pure functions, no `$`. What goes to the model (the ask, the tool and its reply) is English.
import { writeIn, type Lang } from './config'
import { str } from './distill'
import { declinedMark, inRepoMark, isDeclined } from './notes'
import type { Notes, PromoteAsk } from './notes'
import { TAG } from './transcript'

export const PROMOTE_MIN_COUNT = 3
const PROMOTE_MAX_ASKS = 2
const PROMOTE_COOLDOWN_MS = 6 * 60 * 60_000
const PROMOTE_ITEMS = 3

export const PROMOTE_TOOL = 'mark_in_project'
export const PROMOTE_DESCRIPTION =
  'Record where a project-memory rule or procedure now lives in this repo (after the user agreed and you wrote it into CLAUDE.md, ' +
  'or after you made the project skill), or that the user declined. project-memory then removes its own memory file for that rule and stops asking.'
export const PROMOTE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rule: { type: 'string', description: 'The rule name, copied exactly from the quoted text' },
          procedure: { type: 'string', description: 'The procedure name, copied exactly from the quoted text' },
          where: { type: 'string', description: 'Where in the repo it was put, e.g. CLAUDE.md or .claude/skills/release/SKILL.md' },
          declined: { type: 'boolean', description: 'The user does not want it in the repo' },
        },
      },
    },
  },
  required: ['items'],
} as const

export type PromoteItem = { key: string; line: string }

// Due now: asked at most twice, six hours apart, three at a time.
export function promoteItems(notes: Notes, asked: Record<string, PromoteAsk>, now: number): PromoteItem[] {
  const ready = (key: string) => {
    const a = asked[key]

    return !a || (a.asks < PROMOTE_MAX_ASKS && now - a.at >= PROMOTE_COOLDOWN_MS)
  }
  const rules = notes.rules
    .filter(r => r.count >= PROMOTE_MIN_COUNT && r.project === undefined && !r.invalidated)
    .sort((a, b) => b.count - a.count)
    .map(r => ({ key: `r:${r.name}`, line: `- Rule "${r.name}" (confirmed in ${r.count} sessions): ${r.rule}` }))
  const procedures = notes.procedures
    .filter(p => p.count >= PROMOTE_MIN_COUNT && p.project === undefined)
    .sort((a, b) => b.count - a.count)
    .map(p => ({ key: `p:${p.name}`, line: `- Procedure "${p.name}" (confirmed in ${p.count} sessions): ${p.when} | steps: ${p.steps.map((s, i) => `${i + 1}. ${s}`).join('; ')}` }))

  return [...rules, ...procedures].filter(c => ready(c.key)).slice(0, PROMOTE_ITEMS)
}

export function markAsked(asked: Record<string, PromoteAsk>, items: readonly { key: string }[], now: number) {
  const next = { ...asked }
  for (const c of items) next[c.key] = { asks: (asked[c.key]?.asks ?? 0) + 1, at: now }

  return next
}

// CLAUDE.md is the person's to write: rules are proposed and wait for a yes. A procedure becomes a
// skill of its own, which the person reviews as a new file, so it is written straight away.
export const promoteText = (items: readonly PromoteItem[], tool: string, lang: Lang = 'en') => {
  const hasRules = items.some(c => c.key.startsWith('r:'))
  const hasProcedures = items.some(c => c.key.startsWith('p:'))

  return [
    `${TAG} The practices below were confirmed in several conversations but are not in this repo yet. Finish what the user asked for this time first, then handle them at the end of this turn's reply; if the user said they are dealing with an urgent problem, put it off to a later turn.`,
    ...[
      ...(hasRules
        ? ['Rules go into CLAUDE.md, but CLAUDE.md is the user\'s to decide, so do not edit it directly: read what is there first, and if the same rule exists, only report where it is; otherwise list at the end of your reply the text to add and the file to put it in (CLAUDE.md at the repo root or under .claude/, following the project\'s convention) and ask the user whether to add it. Write it only after the user agrees; if they do not, leave it unchanged.']
        : []),
      ...(hasProcedures
        ? ['Procedures become project skills: .claude/skills/<kebab-case name>/SKILL.md, with frontmatter name (the same as the folder) and description (one sentence on when to use it), and the steps in order in the body, keeping commands and file names. If a skill or document already covers the same procedure, extend it and report where, instead of starting another. When done, tell the user at the end of your reply, and delete it if the user says no.']
        : []),
      `${writeIn(lang)} When adding to a file that is already written in another language, match that file instead.`,
      'Only edit files; do not commit or push.',
      `After writing, call ${tool} to report where each one went (rule for a rule, procedure for a procedure, where for the file location); when the user says no, mark it declined with ${tool}. Do not call it while the user has not answered.`,
    ].map((l, i) => `${i + 1}. ${l}`),
    '',
    ...items.map(c => c.line),
  ].join('\n')
}

export type Placed = { kind: 'rule' | 'procedure'; name: string; value: string }

// Claude's report, checked against the notes: what to record, and what could not be.
export function readReport(raw: unknown, notes: Notes, lang: Lang = 'en'): { placed: Placed[]; failed: string[] } {
  const items = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
  const placed: Placed[] = []
  const failed: string[] = []
  for (const it of items) {
    const declined = it.declined === true
    const where = str(it.where)
    const kind = typeof it.rule === 'string' ? 'rule' : typeof it.procedure === 'string' ? 'procedure' : undefined
    const name = kind === 'rule' ? String(it.rule).trim() : kind === 'procedure' ? String(it.procedure).trim() : ''
    const label = kind === 'rule' ? `rule "${name}"` : kind === 'procedure' ? `procedure "${name}"` : JSON.stringify(it)
    if (kind === undefined) {
      failed.push(`${label}: needs rule or procedure`)
      continue
    }
    if (!declined && !where) {
      failed.push(`${label}: missing where`)
      continue
    }
    const list: readonly { name: string }[] = kind === 'rule' ? notes.rules.filter(r => !r.invalidated) : notes.procedures
    if (!list.some(x => x.name === name)) {
      failed.push(`${label}: not in the notes`)
      continue
    }
    placed.push({ kind, name, value: declined ? declinedMark(lang) : `${inRepoMark(lang)}${where}` })
  }

  return { placed, failed }
}

// The notes with the report applied: a placed rule loses its file (the caller deletes it).
export function applyPlaced(notes: Notes, placed: readonly Placed[]): Notes {
  const of = (kind: Placed['kind'], name: string) => placed.find(p => p.kind === kind && p.name === name)?.value

  return {
    memory: notes.memory,
    rules: notes.rules.map(r => {
      const value = of('rule', r.name)
      if (value === undefined) return r
      // Declined: the rule stays a memory; written into the repo: its own file goes.
      if (isDeclined(value)) return { ...r, project: value }
      const { file: _file, ...rest } = r

      return { ...rest, project: value }
    }),
    procedures: notes.procedures.map(p => {
      const value = of('procedure', p.name)

      return value === undefined ? p : { ...p, project: value }
    }),
  }
}

export const promoteReport = (placed: readonly Placed[], failed: readonly string[]) => [
  ...(placed.length > 0 ? ['Recorded:', ...placed.map(p => `${p.kind} "${p.name}": ${p.value}`)] : []),
  ...(failed.length > 0 ? ['Not recorded:', ...failed] : []),
].join('\n') || 'No items received'
