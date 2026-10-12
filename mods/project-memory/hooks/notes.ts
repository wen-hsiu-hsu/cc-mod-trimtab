// The notes as the built-in memory keeps them: one `pm-*.md` file per memory or rule, listed in
// MEMORY.md; procedures, rule counts and the repository's active days live in the store. Pure
// functions, no `$`.
import { pick, type Lang, type Text } from './config'

export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]
export const isMemoryType = (v: unknown): v is MemoryType => typeof v === 'string' && (MEMORY_TYPES as readonly string[]).includes(v)

// Facts and places go stale: unconfirmed over this many days the repository was worked on, they
// leave the index (the file stays). Counted in active days, so a month away loses nothing.
export const STALE_ACTIVE_DAYS = 30
const FACT_TYPES: readonly string[] = ['project', 'reference']
export const EVIDENCE_KEEP = 3
// An invalidated memory's file is kept this many calendar days, then deleted.
export const INVALIDATED_KEEP_DAYS = 90
// This mod's lines in MEMORY.md, which the main session's own memories share (it loads 200 lines).
export const INDEX_CAP = 60
export const PATHS_MAX = 3
// Sessions remembered per rule and procedure: a count is how many distinct sessions confirmed it.
const SESSIONS_KEEP = 20
const ACTIVE_DAYS_KEEP = 400

// What the store keeps in a rule's or procedure's `project` once it is placed in the repo or declined.
// Written in the language of the setting; read in either.
export const inRepoMark = (lang: Lang) => pick(lang, { en: 'in ', 'zh-TW': '已在 ' })
export const declinedMark = (lang: Lang) => pick(lang, { en: 'declined', 'zh-TW': '不放' })
export const isInRepo = (v: string | undefined) => v !== undefined && (v.startsWith('in ') || v.startsWith('已在 '))
export const isDeclined = (v: string | undefined) => v === 'declined' || v === '不放'

// Every file this mod writes starts with this, so the index lines it owns are told apart.
export const FILE_PREFIX = 'pm-'
export const INDEX_FILE = 'MEMORY.md'

// Fields both a memory and a rule carry.
type Lifecycle = {
  // Files of the repository it is about, relative to its root; checked for at each distill.
  paths: string[]
  evidence: string[]
  // The day it was found no longer true, and what took its place.
  invalidated?: string
  supersededBy?: string
  // Lines of the body this mod does not write (someone edited the file): kept as they are.
  extra: string[]
}

export type Memory = Lifecycle & { file: string; type: MemoryType; title: string; how?: string; why?: string }

// A rule is a feedback memory file while it is the mod's own; once written into the repo the file
// goes and the record stays, so it is neither added again nor loaded twice.
export type Rule = Lifecycle & {
  file?: string
  name: string
  rule: string
  applies?: string
  count: number
  sessions: string[]
  project?: string
}

export type Procedure = { name: string; when: string; steps: string[]; count: number; sessions: string[]; evidence: string[]; project?: string }

export type Notes = { memory: Memory[]; rules: Rule[]; procedures: Procedure[] }

// What the store keeps per repository beside the files.
export type RuleMeta = { name: string; count: number; sessions?: string[]; project?: string; rule?: string }
export type PromoteAsk = { asks: number; at: number }
export type RepoStore = {
  rules: Record<string, RuleMeta>
  procedures: Procedure[]
  asked: Record<string, PromoteAsk>
  // Local dates (YYYY-MM-DD) a session ran in the repository, ascending.
  activeDays: string[]
}
export const EMPTY_STORE: RepoStore = { rules: {}, procedures: [], asked: {}, activeDays: [] }

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

export function readStore(raw: unknown): RepoStore {
  const o = isRecord(raw) ? (raw as Partial<RepoStore>) : {}

  return {
    rules: isRecord(o.rules) ? o.rules : {},
    procedures: Array.isArray(o.procedures) ? o.procedures.map(p => ({ ...p, sessions: Array.isArray(p.sessions) ? p.sessions : [] })) : [],
    asked: isRecord(o.asked) ? o.asked : {},
    activeDays: Array.isArray(o.activeDays) ? o.activeDays.filter((d): d is string => typeof d === 'string') : [],
  }
}

export function withActiveDay(days: readonly string[], day: string): string[] | undefined {
  if (days.includes(day)) return undefined

  return [...days, day].sort().slice(-ACTIVE_DAYS_KEEP)
}

export const withSession = (sessions: readonly string[], sid: string) => [...sessions.filter(s => s !== sid), sid].slice(-SESSIONS_KEEP)

// ---------- one memory file ----------

// The labels of a memory file follow the language it was written in; reading takes both.
const LABEL: Readonly<Record<'how' | 'why' | 'applies' | 'paths', Text>> = {
  how: { en: 'How', 'zh-TW': '做法' },
  why: { en: 'Why', 'zh-TW': '理由' },
  applies: { en: 'Applies to', 'zh-TW': '適用' },
  paths: { en: 'Files', 'zh-TW': '相關檔案' },
}
const EVIDENCE_HEAD: Text = { en: '## Evidence', 'zh-TW': '## 根據' }
const FIELD_LINE = /^\*\*(做法|理由|適用|相關檔案|How|Why|Applies to|Files)[：:]\*\*\s*(.*)$/
const FIELD_KEY: Readonly<Record<string, 'how' | 'why' | 'applies' | 'paths'>> = {
  做法: 'how',
  How: 'how',
  理由: 'why',
  Why: 'why',
  適用: 'applies',
  'Applies to': 'applies',
  相關檔案: 'paths',
  Files: 'paths',
}
// Where the label ends: a full-width colon in Chinese, an ASCII one in English.
const labelOf = (lang: Lang, key: keyof typeof LABEL) => `**${pick(lang, LABEL[key])}${lang === 'zh-TW' ? '：' : ':'}**`
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

export type ParsedFile = {
  name: string
  description: string
  type?: MemoryType
  how?: string
  why?: string
  applies?: string
  paths: string[]
  invalidated?: string
  supersededBy?: string
  evidence: string[]
  extra: string[]
}

export function parseFile(text: string): ParsedFile {
  const parsed: ParsedFile = { name: '', description: '', paths: [], evidence: [], extra: [] }
  let body = text
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  if (front) {
    body = text.slice(front[0].length)
    for (const line of (front[1] ?? '').split('\n')) {
      const m = /^(\w+):\s*(.*)$/.exec(line)
      if (!m) continue
      const value = (m[2] ?? '').trim()
      if (m[1] === 'name') parsed.name = value
      if (m[1] === 'description') parsed.description = value
      if (m[1] === 'type' && isMemoryType(value)) parsed.type = value
      if (m[1] === 'invalidated' && value) parsed.invalidated = value
      if (m[1] === 'superseded_by' && value) parsed.supersededBy = value
    }
  }
  let inEvidence = false
  let sawTitle = false
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd()
    if (line.startsWith('## ')) {
      inEvidence = line === EVIDENCE_HEAD['zh-TW'] || line === EVIDENCE_HEAD.en
      if (!inEvidence) parsed.extra.push(line)
      continue
    }
    if (inEvidence) {
      if (line.startsWith('- ')) parsed.evidence.push(line.slice(2).trim())
      else if (line.trim()) parsed.extra.push(line)
      continue
    }
    const field = FIELD_LINE.exec(line)
    if (field) {
      const value = (field[2] ?? '').trim()
      const key = FIELD_KEY[field[1] ?? '']
      if (key === 'paths') parsed.paths = value.split(/\s*,\s*/).map(p => p.replace(/^`|`$/g, '')).filter(Boolean)
      else if (key !== undefined) parsed[key] = value
      continue
    }
    // The title line repeats the name; anything else someone wrote is kept.
    if (!sawTitle && line.trim() === parsed.name) {
      sawTitle = true
      continue
    }
    if (line.trim() || parsed.extra.length > 0) parsed.extra.push(line)
  }
  while (parsed.extra.length > 0 && parsed.extra.at(-1)?.trim() === '') parsed.extra.pop()

  return parsed
}

// The index line's hook and the frontmatter description: one short line.
export function describe(how?: string, why?: string, title = '') {
  return oneLine(how ?? why ?? title).slice(0, 120)
}

type FileFields = { how?: string; why?: string; applies?: string }

function renderFile(name: string, type: MemoryType, fields: FileFields, life: Lifecycle, lang: Lang) {
  return [
    '---',
    `name: ${oneLine(name)}`,
    `description: ${describe(fields.how, fields.why, name)}`,
    `type: ${type}`,
    ...(life.invalidated ? [`invalidated: ${life.invalidated}`] : []),
    ...(life.supersededBy ? [`superseded_by: ${oneLine(life.supersededBy)}`] : []),
    '---',
    '',
    name,
    '',
    ...(fields.how ? [`${labelOf(lang, 'how')} ${fields.how}`] : []),
    ...(fields.why ? [`${labelOf(lang, 'why')} ${fields.why}`] : []),
    ...(fields.applies ? [`${labelOf(lang, 'applies')} ${fields.applies}`] : []),
    ...(life.paths.length > 0 ? [`${labelOf(lang, 'paths')} ${life.paths.map(p => `\`${p}\``).join(', ')}`] : []),
    ...(life.extra.length > 0 ? ['', ...life.extra] : []),
    ...(life.evidence.length > 0 ? ['', pick(lang, EVIDENCE_HEAD), ...life.evidence.map(e => `- ${e}`)] : []),
    '',
  ].join('\n')
}

export const renderMemory = (m: Memory, lang: Lang = 'en') => renderFile(m.title, m.type, { how: m.how, why: m.why }, m, lang)
export const renderRule = (r: Rule, lang: Lang = 'en') => renderFile(r.name, 'feedback', { how: r.rule, applies: r.applies }, r, lang)

const lifeOf = (p: ParsedFile): Lifecycle => ({
  paths: p.paths,
  evidence: p.evidence,
  ...(p.invalidated ? { invalidated: p.invalidated } : {}),
  ...(p.supersededBy ? { supersededBy: p.supersededBy } : {}),
  extra: p.extra,
})

// The files of the memory folder, read into notes; a file the store lists as a rule is one.
export function notesOf(files: readonly { file: string; text: string }[], store: RepoStore): Notes {
  const memory: Memory[] = []
  const rules: Rule[] = []
  const seen = new Set<string>()
  for (const { file, text } of files) {
    const p = parseFile(text)
    const meta = store.rules[file]
    if (meta !== undefined) {
      seen.add(file)
      rules.push({
        file,
        name: p.name || meta.name,
        rule: p.how ?? meta.rule ?? p.description,
        ...(p.applies ? { applies: p.applies } : {}),
        count: meta.count,
        sessions: meta.sessions ?? [],
        ...(meta.project !== undefined ? { project: meta.project } : {}),
        ...lifeOf(p),
      })
      continue
    }
    if (!p.name) continue
    memory.push({ file, type: p.type ?? 'project', title: p.name, ...(p.how ? { how: p.how } : {}), ...(p.why ? { why: p.why } : {}), ...lifeOf(p) })
  }
  // Rules already written into the repo have no file; a rule whose file someone deleted is gone.
  for (const [key, meta] of Object.entries(store.rules)) {
    if (!seen.has(key) && meta.project !== undefined) {
      rules.push({ name: meta.name, rule: meta.rule ?? '', count: meta.count, sessions: meta.sessions ?? [], project: meta.project, paths: [], evidence: [], extra: [] })
    }
  }

  return { memory, rules, procedures: store.procedures.map(p => ({ ...p, steps: [...p.steps], sessions: [...p.sessions], evidence: [...p.evidence] })) }
}

// ---------- lifecycle ----------

// What the distill model works on (live) and what it never sees again (invalidated).
export function splitLive(notes: Notes): { live: Notes; dead: Notes } {
  return {
    live: { memory: notes.memory.filter(m => !m.invalidated), rules: notes.rules.filter(r => !r.invalidated), procedures: notes.procedures },
    dead: { memory: notes.memory.filter(m => m.invalidated), rules: notes.rules.filter(r => r.invalidated), procedures: [] },
  }
}

// Joins them again, dropping invalidated items past their keep: their files are then deleted.
export function joinLive(live: Notes, dead: Notes, day: string): Notes {
  const kept = (x: { invalidated?: string }) => x.invalidated === undefined || Date.parse(day) - Date.parse(x.invalidated) <= INVALIDATED_KEEP_DAYS * 86_400_000

  return {
    memory: [...live.memory, ...dead.memory].filter(kept),
    rules: [...live.rules, ...dead.rules].filter(kept),
    procedures: live.procedures,
  }
}

const lastSeen = (evidence: readonly string[]) =>
  evidence.map(e => /^(\d{4}-\d{2}-\d{2})/.exec(e)?.[1]).filter((d): d is string => d !== undefined).sort().at(-1)

// Unconfirmed over STALE_ACTIVE_DAYS of the repository's active days.
export function isArchived(m: Memory, activeDays: readonly string[]) {
  const seen = lastSeen(m.evidence)
  if (!FACT_TYPES.includes(m.type) || seen === undefined) return false

  return activeDays.filter(d => d > seen).length > STALE_ACTIVE_DAYS
}

// ---------- file names ----------

function hash(s: string) {
  let h = 0x811c9dc5
  for (const ch of s) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }

  return h.toString(16).padStart(8, '0').slice(0, 6)
}

// `pm-<type>-<ascii words of the title>-<hash>.md`: readable where the title has ASCII words, unique by the hash.
export function fileNameFor(type: string, title: string, taken: ReadonlySet<string>) {
  const words = title.toLowerCase().match(/[a-z0-9]+/g)?.join('-').slice(0, 40).replace(/-+$/, '') ?? ''
  const base = `${FILE_PREFIX}${type}-${words ? `${words}-` : ''}${hash(title)}`
  let name = `${base}.md`
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}.md`

  return name
}

// ---------- MEMORY.md ----------

export type IndexEntry = { file: string; title: string; hook: string }
const ownLine = /\]\((pm-[^)]+\.md)\)/

export const indexLine = (e: IndexEntry) => `- [${oneLine(e.title)}](${e.file}) — ${oneLine(e.hook)}`

// Rewrites only the lines that link a `pm-` file: kept in place when still listed, dropped when not,
// new ones appended. Every other line stays as it is.
export function updateIndex(text: string, entries: readonly IndexEntry[]) {
  const wanted = new Map(entries.map(e => [e.file, e]))
  const placed = new Set<string>()
  const lines: string[] = []
  for (const line of text === '' ? [] : text.replace(/\n$/, '').split('\n')) {
    const file = ownLine.exec(line)?.[1]
    if (file === undefined) {
      lines.push(line)
      continue
    }
    const entry = wanted.get(file)
    if (entry !== undefined && !placed.has(file)) {
      lines.push(indexLine(entry))
      placed.add(file)
    }
  }
  for (const e of entries) {
    if (!placed.has(e.file)) lines.push(indexLine(e))
  }

  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

type Listed = IndexEntry & { seen: string }

// Everything that belongs in the index: live memories not archived, live rules that have a file.
export function listed(notes: Notes, activeDays: readonly string[]): Listed[] {
  return [
    ...notes.memory
      .filter(m => !m.invalidated && !isArchived(m, activeDays))
      .map(m => ({ file: m.file, title: m.title, hook: describe(m.how, m.why, m.title), seen: lastSeen(m.evidence) ?? '' })),
    ...notes.rules
      .filter((r): r is Rule & { file: string } => r.file !== undefined && !r.invalidated)
      .map(r => ({ file: r.file, title: r.name, hook: describe(r.rule), seen: lastSeen(r.evidence) ?? '' })),
  ]
}

// The index lines, held to the cap: past it, the longest unconfirmed leave (their files stay).
// Merging is the distill's job; this keeps the cap when it could not.
export function indexEntries(notes: Notes, activeDays: readonly string[], cap = INDEX_CAP): IndexEntry[] {
  const all = listed(notes, activeDays)
  const keep = new Set([...all].sort((a, b) => b.seen.localeCompare(a.seen)).slice(0, cap).map(e => e.file))

  return all.filter(e => keep.has(e.file)).map(({ file, title, hook }) => ({ file, title, hook }))
}

// The store's part of the notes: rule counts, procedures, asks and active days.
export function storeOf(notes: Notes, asked: Record<string, PromoteAsk>, activeDays: string[]): RepoStore {
  const rules: Record<string, RuleMeta> = {}
  for (const r of notes.rules) {
    const key = r.file ?? `project:${r.name}`
    rules[key] = { name: r.name, count: r.count, sessions: r.sessions, ...(r.project !== undefined ? { project: r.project, rule: r.rule } : {}) }
  }

  return { rules, procedures: notes.procedures, asked, activeDays }
}

// ---------- /project-memory list ----------

// The sessions an evidence line's stamp names (`YYYY-MM-DD <sid>`); a memory keeps EVIDENCE_KEEP of them.
const sessionsOf = (evidence: readonly string[]) =>
  new Set(evidence.map(e => /^\d{4}-\d{2}-\d{2} ([0-9A-Za-z-]{1,8})(?=[｜|\s]|$)/.exec(e)?.[1]).filter((s): s is string => s !== undefined)).size

type ListItem = { type: string; title: string; sessions: number; seen: string; status: string[]; isDead: boolean }

// One plain line per memory and rule that has a file: type, title, sessions confirmed in, last
// confirmed, and where it stands. gone: a file's paths no longer in the repository. promoteMin:
// the sessions a rule needs before it is asked into CLAUDE.md.
export function listLines(notes: Notes, activeDays: readonly string[], gone: ReadonlyMap<string, string[]>, promoteMin: number, lang: Lang, cap = INDEX_CAP): string[] {
  const t = (en: string, zh: string) => pick(lang, { en, 'zh-TW': zh })
  const inIndex = new Set(indexEntries(notes, activeDays, cap).map(e => e.file))
  const statusOf = (file: string, x: { invalidated?: string }, archived: boolean) => {
    if (x.invalidated) return [t(`invalidated ${x.invalidated}`, `失效 ${x.invalidated}`)]
    const status = [archived ? t('stale', '已過期') : inIndex.has(file) ? t('listed', '列在目錄') : t(`not listed (over ${cap})`, `未列（超過 ${cap} 條）`)]
    const missing = gone.get(file)
    if (missing !== undefined) status.push(t(`files gone: ${missing.join(', ')}`, `檔案遺失：${missing.join(', ')}`))

    return status
  }
  const items: ListItem[] = [
    ...notes.memory.map(m => ({
      type: m.type,
      title: m.title,
      sessions: sessionsOf(m.evidence),
      seen: lastSeen(m.evidence) ?? '',
      status: statusOf(m.file, m, isArchived(m, activeDays)),
      isDead: m.invalidated !== undefined,
    })),
    ...notes.rules
      .filter((r): r is Rule & { file: string } => r.file !== undefined)
      .map(r => ({
        type: t('rule', '規則'),
        title: r.name,
        sessions: r.count,
        seen: lastSeen(r.evidence) ?? '',
        status: [...statusOf(r.file, r, false), ...(!r.invalidated && r.project === undefined && r.count >= promoteMin ? [t('waiting to go into CLAUDE.md', '等待寫進 CLAUDE.md')] : [])],
        isDead: r.invalidated !== undefined,
      })),
  ].sort((a, b) => Number(a.isDead) - Number(b.isDead) || b.seen.localeCompare(a.seen))
  if (items.length === 0) return [t('No memories yet.', '還沒有記憶。')]
  const sep = lang === 'zh-TW' ? '、' : '; '

  return items.map(i =>
    `[${i.type}] ${oneLine(i.title)} · ${t(`${i.sessions} session(s)`, `${i.sessions} 個 session`)} · ${i.seen || t('never confirmed', '未證實')} · ${i.status.join(sep)}`)
}
