import type { ItemKind, LogEntry, OpenItem, OptionRef, Stored, Tombstone } from '../types'
import { pick, type Lang, type Text } from './config'

export const MAX_TEXT = 80
export const KINDS: readonly ItemKind[] = ['decision', 'question', 'deferred', 'bug']

export function clip(text: string, max = MAX_TEXT): string {
  const one = text.replace(/\s+/g, ' ').trim()

  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

export function nextId(items: readonly OpenItem[]): string {
  const top = items.reduce((max, item) => Math.max(max, Number(item.id.slice(1)) || 0), 0)

  return `o${top + 1}`
}

/** Keeps stored ids that are still free, then numbers the rest after them in order. */
export function renumber(kept: readonly OpenItem[], fresh: readonly OpenItem[]): OpenItem[] {
  const used = new Set<string>()
  const out: OpenItem[] = []
  const later: OpenItem[] = []
  for (const item of kept) {
    if (/^o\d+$/.test(item.id) && !used.has(item.id)) {
      used.add(item.id)
      out.push(item)
    } else {
      later.push(item)
    }
  }

  return [...later, ...fresh].reduce<OpenItem[]>((list, item) => [...list, { ...item, id: nextId(list) }], out)
}

/** At most `max` items, dropping the oldest resolved ones before any open one. */
export function trimItems(items: readonly OpenItem[], max: number): OpenItem[] {
  let extra = items.length - max
  if (extra <= 0) {
    return [...items]
  }
  const dropDone = new Set(
    items
      .filter(item => item.isDone)
      .slice(0, extra)
      .map(item => item.uid),
  )
  extra -= dropDone.size
  const kept = items.filter(item => !dropDone.has(item.uid))

  return kept.slice(extra)
}

// ---- Duplicates ----

/** The text as compared for duplicates: width-folded, lower case, no spaces or punctuation. */
export function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

// Shorter texts than this only match when equal: "bug" is in too many texts to mean the same item.
const MIN_CONTAINED = 4

/** The first open item whose text equals `text` or contains it (or is contained), once normalized. */
export function findSimilar(items: readonly OpenItem[], text: string): OpenItem | undefined {
  const target = normalize(text)
  if (target === '') {
    return undefined
  }

  return items.find(item => {
    if (item.isDone) {
      return false
    }
    const other = normalize(item.text)
    if (other === target) {
      return true
    }
    const [short, long] = other.length < target.length ? [other, target] : [target, other]

    return short.length >= MIN_CONTAINED && long.includes(short)
  })
}

// ---- What is kept across sessions ----

// Resolved items are kept as tombstones this long, so another session cannot bring them back.
export const TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_TOMBSTONES = 500

const EMPTY: Stored = { items: [], done: [] }

// Items stored before uids existed get one from what both sessions read alike.
function withUid(item: OpenItem): OpenItem {
  return typeof item.uid === 'string' && item.uid !== ''
    ? item
    : { ...item, uid: `legacy:${item.createdAt}:${item.kind}:${item.text}` }
}

function isItem(value: unknown): value is OpenItem {
  const item = value as OpenItem
  return typeof item === 'object' && item !== null && typeof item.id === 'string' && typeof item.text === 'string'
}

function isTombstone(value: unknown): value is Tombstone {
  const t = value as Tombstone
  return typeof t === 'object' && t !== null && typeof t.uid === 'string' && typeof t.doneAt === 'number'
}

// A tombstone's item is dropped when unreadable, so a bad one cannot reach the pane.
function readTombstone(t: Tombstone): Tombstone {
  return t.item === undefined || isItem(t.item) ? t : { uid: t.uid, doneAt: t.doneAt }
}

/** A stored value as `{ items, done }`; the older form was a bare array of open items. */
export function readStored(value: unknown): Stored {
  if (Array.isArray(value)) {
    return { items: value.filter(isItem).filter(item => !item.isDone).map(withUid), done: [] }
  }
  const stored = value as Partial<Stored> | undefined
  if (typeof stored !== 'object' || stored === null) {
    return EMPTY
  }

  return {
    items: Array.isArray(stored.items) ? stored.items.filter(isItem).map(withUid) : [],
    done: Array.isArray(stored.done) ? stored.done.filter(isTombstone).map(readTombstone) : [],
  }
}

/** A session's list in the stored form: its open items, and a tombstone for each resolved one. */
export function toStored(items: readonly OpenItem[], now: number): Stored {
  return {
    items: items.filter(item => !item.isDone),
    done: items.filter(item => item.isDone).map(item => ({ uid: item.uid, doneAt: item.doneAt ?? now, item })),
  }
}

/**
 * Both sides merged by uid: a tombstone on either side wins over an open item, so an item
 * resolved in one session stays resolved; `b`'s copy of an item replaces `a`'s in place.
 */
export function combine(a: Stored, b: Stored, now: number, max: number): Stored {
  const done = new Map<string, Tombstone>()
  for (const t of [...a.done, ...b.done]) {
    const had = done.get(t.uid)
    const item = t.item ?? had?.item
    done.set(t.uid, { uid: t.uid, doneAt: Math.max(had?.doneAt ?? 0, t.doneAt), ...(item === undefined ? {} : { item }) })
  }
  const open = new Map<string, OpenItem>()
  for (const item of [...a.items, ...b.items]) {
    if (!done.has(item.uid)) {
      open.set(item.uid, { ...item, isDone: false })
    }
  }
  // The item is kept only while the pane lists it (STALE_MS), the uid for TOMBSTONE_MS.
  const tombstones = [...done.values()]
    .map(t => (t.item !== undefined && t.doneAt <= now - STALE_MS ? { uid: t.uid, doneAt: t.doneAt } : t))
    .filter(t => t.doneAt > now - TOMBSTONE_MS)
    .sort((x, y) => x.doneAt - y.doneAt)
    .slice(-MAX_TOMBSTONES)

  return { items: [...open.values()].slice(-max), done: tombstones }
}

/**
 * Items resolved in the last 7 days that `have` (the session's list) lacks, newest last, for the
 * pane's resolved list. One reopened since (a uid carrying the old one plus `:r`) is left out.
 */
export function recentResolved(stored: Stored, have: readonly OpenItem[], now: number): OpenItem[] {
  const known = [...stored.items.map(item => item.uid), ...stored.done.map(t => t.uid), ...have.map(item => item.uid)]
  const mine = new Set(have.map(item => item.uid))

  return stored.done
    .filter(t => t.item !== undefined && t.doneAt > now - STALE_MS && !mine.has(t.uid))
    .filter(t => !known.some(uid => uid.startsWith(`${t.uid}:r`)))
    .map(t => ({ ...t.item!, uid: t.uid, isDone: true, doneAt: t.doneAt }))
}

const MAX_LOG = 300

function isLogEntry(value: unknown): value is LogEntry {
  const entry = value as LogEntry
  return typeof entry === 'object' && entry !== null && typeof entry.uid === 'string' && typeof entry.text === 'string'
}

/** The repo's resolution log as stored; anything unreadable is left out. */
export function readLog(value: unknown): LogEntry[] {
  return Array.isArray(value) ? value.filter(isLogEntry) : []
}

/** The log with `entry` last (replacing an earlier entry of the same item), at most the newest 300. */
export function appendLog(log: readonly LogEntry[], entry: LogEntry): LogEntry[] {
  return [...log.filter(e => e.uid !== entry.uid), entry].slice(-MAX_LOG)
}

/** Whether resolving an item this way is worth a log entry: a decision, a drop, or any note. */
export function isLogged(item: OpenItem): boolean {
  return item.kind === 'decision' || item.outcome === 'dropped' || (item.note ?? '') !== ''
}

const HISTORY_SHOWN = 20

/** The newest log entries matching `query` (all when empty), for the model. */
export function historyLines(log: readonly LogEntry[], query: string, now: number, lang: Lang = 'en'): string {
  const q = normalize(query)
  const hits = log.filter(e => q === '' || normalize(`${e.text} ${e.note}`).includes(q)).slice(-HISTORY_SHOWN).reverse()
  if (hits.length === 0) {
    return q === ''
      ? pick(lang, { en: 'No resolved decisions or dropped items yet.', 'zh-TW': '還沒有已解決的決定或已放棄的項目。' })
      : pick(lang, { en: `Nothing in the log matches "${query}".`, 'zh-TW': `紀錄裡沒有符合「${query}」的項目。` })
  }

  return hits
    .map(e => {
      const how =
        e.outcome === 'dropped' ? pick(lang, { en: 'dropped', 'zh-TW': '已放棄' }) : pick(lang, { en: 'resolved', 'zh-TW': '已解決' })
      const note = e.note === '' ? '' : ` — ${e.note}`
      const kind = lang === 'zh-TW' ? kindLabel(e.kind, lang) : e.kind

      return `- [${kind}, ${how} ${ageText(now - e.at, lang)}] ${e.text}${note}`
    })
    .join('\n')
}

// ---- Source B: option lists in the assistant's answer ----

const LABEL_LINE: readonly RegExp[] = [
  // **A** text, **A.** text, **(A)** text, **A：text**
  /^\s*(?:[-*]\s+)?\*\*\(?([A-Za-z]|\d{1,2})\)?[.)：:]?\*\*[.)：:]?\s*(.*)$/,
  // (a) text
  /^\s*(?:[-*]\s+)?\(([A-Za-z]|\d{1,2})\)\s*(.*)$/,
  // A. text, A) text, 1. text
  /^\s*(?:[-*]\s+)?([A-Za-z]|\d{1,2})[.)]\s+(.*)$/,
  // A：text, A: text
  /^\s*(?:[-*]\s+)?([A-Za-z]|\d{1,2})\s*[：:]\s*(.+)$/,
]

function parseLabelLine(line: string): OptionRef | undefined {
  for (const pattern of LABEL_LINE) {
    const m = pattern.exec(line)
    if (m?.[1] !== undefined) {
      const text = clip((m[2] ?? '').replace(/\*\*/g, '').replace(/^[：:\-–—\s]+/, ''), 60)

      return { label: m[1].toUpperCase(), text }
    }
  }

  return undefined
}

function follows(prev: string, label: string): boolean {
  if (/^\d+$/.test(prev) && /^\d+$/.test(label)) {
    return Number(label) === Number(prev) + 1
  }

  return prev.length === 1 && label.length === 1 && label.charCodeAt(0) === prev.charCodeAt(0) + 1
}

function startsList(label: string): boolean {
  return label === 'A' || label === '1'
}

const QUESTION = /[？?]$/

function isQuestion(line: string): boolean {
  return QUESTION.test(line.trim().replace(/[*_)）」』\s]+$/, ''))
}

// At most this many lines of prose may follow a list that is not followed by a question.
const MAX_TRAILING = 2

/**
 * Whether a list whose last option is on line `end` is what the answer closes on: only a short
 * closing follows it, or a question does. Indented lines right after it still belong to it.
 */
function closesAnswer(lines: readonly string[], end: number): boolean {
  let rest = lines.slice(end + 1).filter(line => line.trim() !== '')
  const continued = rest.findIndex(line => !/^\s/.test(line))
  rest = continued === -1 ? [] : rest.slice(continued)

  return rest.length <= MAX_TRAILING || rest.slice(0, MAX_TRAILING).some(isQuestion)
}

/**
 * The latest list of 2..8 consecutive labelled options (A B C… or 1 2 3…) in an answer, when the
 * answer ends on it or on a question right after it; a list in the middle of an answer (steps,
 * a summary) is not a choice put to the person.
 */
export function parseOptions(answer: string): OptionRef[] {
  const lines = answer.split('\n')
  const groups: { options: OptionRef[]; end: number }[] = []
  let current: { options: OptionRef[]; end: number } | undefined
  lines.forEach((line, index) => {
    const option = parseLabelLine(line)
    if (option === undefined) {
      return
    }
    const last = current?.options[current.options.length - 1]
    if (current !== undefined && last !== undefined && follows(last.label, option.label)) {
      current.options.push(option)
      current.end = index
    } else if (startsList(option.label)) {
      current = { options: [option], end: index }
      groups.push(current)
    } else if (last !== undefined) {
      // A stray label ends the list being read.
      current = undefined
    }
  })
  const lists = groups.filter(group => group.options.length >= 2 && group.options.length <= 8)
  const latest = lists[lists.length - 1]

  return latest !== undefined && closesAnswer(lines, latest.end) ? latest.options : []
}

/** Whether the answer closes on a question (one of its last two lines, as a ➡️ hint may follow). */
export function endsWithQuestion(answer: string): boolean {
  return answer
    .split('\n')
    .filter(line => line.trim() !== '')
    .slice(-2)
    .some(isQuestion)
}

// Parsers of the person's words: Chinese and English whatever the language setting is.
const ALL = /全部|全都|都做|都要|全選|全做|兩個都|all of (them|the above)|\ball\b/i
const DEFER = /先不|不做|不要|先[^。，,；;\n]{0,4}(寫|記|當|放|列)|之後|晚點|暫緩|暫不|跳過|觀察|延後|以後|later|skip|defer|not now/i
const REF = /\(([A-Za-z]|\d{1,2})\)|(?<![A-Za-z0-9])([A-Z]|\d{1,2})(?![A-Za-z0-9]|[個次行天分秒%])/g

export type Choice = { chosen: string[]; deferred: string[]; isAll: boolean }

/**
 * Which labels a short user prompt picks. Conservative: undefined unless the prompt is
 * short and clearly names at least one label of the remembered list (or says "all").
 */
export function parseChoice(prompt: string, options: readonly OptionRef[]): Choice | undefined {
  const text = prompt.normalize('NFKC').trim()
  if (options.length < 2 || text === '' || text.length >= 120) {
    return undefined
  }
  if (ALL.test(text)) {
    return { chosen: options.map(o => o.label), deferred: [], isAll: true }
  }
  const known = new Set(options.map(o => o.label))
  const chosen = new Set<string>()
  const deferred = new Set<string>()
  for (const clause of text.split(/[。；;，,.\n]/)) {
    const labels = [...clause.matchAll(REF)]
      .map(m => (m[1] ?? m[2] ?? '').toUpperCase())
      .filter(label => known.has(label))
    const isDeferral = DEFER.test(clause)
    for (const label of labels) {
      ;(isDeferral ? deferred : chosen).add(label)
    }
  }
  for (const label of deferred) {
    chosen.delete(label)
  }
  if (chosen.size === 0) {
    return undefined
  }

  return { chosen: [...chosen], deferred: [...deferred], isAll: false }
}

/** The options a prompt left unchosen, as texts for new deferred items. */
export function unchosen(prompt: string, options: readonly OptionRef[]): OptionRef[] {
  const choice = parseChoice(prompt, options)
  if (choice === undefined) {
    return []
  }

  return options.filter(option => !choice.chosen.includes(option.label))
}

// ---- Lines shown to the person and the model ----

export const KIND_LABEL: Record<ItemKind, Text> = {
  decision: { en: 'To decide', 'zh-TW': '待你決定' },
  question: { en: 'Open questions', 'zh-TW': '未解決問題' },
  deferred: { en: 'Deferred', 'zh-TW': '延後' },
  bug: { en: 'Open bugs', 'zh-TW': '未解決 bug' },
}

export function kindLabel(kind: ItemKind, lang: Lang): string {
  return pick(lang, KIND_LABEL[kind])
}

// The pane's kind column, one per row. A two-character Chinese label has a full-width space in the
// middle, so it lines up with the three-character one.
export const KIND_SHORT: Record<ItemKind, Text> = {
  decision: { en: 'Decide', 'zh-TW': '待決定' },
  question: { en: 'Question', 'zh-TW': '問　題' },
  deferred: { en: 'Deferred', 'zh-TW': '延　後' },
  bug: { en: 'Bug', 'zh-TW': 'bug' },
}

export function kindShort(kind: ItemKind, lang: Lang): string {
  return pick(lang, KIND_SHORT[kind])
}

// ---- Terminal cells ----

// East Asian wide and full-width characters take two cells.
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u

export function cells(text: string): number {
  let n = 0
  for (const ch of text) {
    n += WIDE.test(ch) ? 2 : 1
  }

  return n
}

/**
 * `text` broken into lines of at most `width` cells: a Latin word moves whole to the next line
 * when it fits on one, wide characters break anywhere.
 */
export function wrapCells(text: string, width: number): string[] {
  const max = Math.max(1, width)
  const tokens = text.match(/\s+|[!-~]+?(?=\s|[^!-~]|$)|./gsu) ?? []
  const lines: string[] = []
  let line = ''
  let used = 0
  const push = (): void => {
    lines.push(line.trimEnd())
    line = ''
    used = 0
  }
  for (const token of tokens) {
    const size = cells(token)
    if (/^\s+$/.test(token)) {
      if (used > 0 && used + size <= max) {
        line += token
        used += size
      } else if (used > 0) {
        push()
      }
      continue
    }
    if (used > 0 && used + size > max && size <= max) {
      push()
    }
    for (const ch of size > max ? [...token] : [token]) {
      const w = cells(ch)
      if (used > 0 && used + w > max) {
        push()
      }
      line += ch
      used += w
    }
  }
  if (line !== '' || lines.length === 0) {
    push()
  }

  return lines
}

// `hint` follows the counts: the command where nothing can be pressed (the status line).
export function bandText(items: readonly OpenItem[], hint = '  /open-items', lang: Lang = 'en'): string {
  const open = items.filter(item => !item.isDone)
  if (open.length === 0) {
    return ''
  }
  const count = (...kinds: ItemKind[]): number => open.filter(item => kinds.includes(item.kind)).length
  const parts = [
    [count('decision'), pick(lang, { en: 'to decide', 'zh-TW': '待你決定' })],
    [count('question', 'bug'), pick(lang, { en: 'unresolved', 'zh-TW': '未解決' })],
    [count('deferred'), pick(lang, { en: 'deferred', 'zh-TW': '延後' })],
  ] as const
  const line = parts
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`)
    .join(' · ')

  return `${line}${hint}`
}

export function listLines(items: readonly OpenItem[]): string {
  const open = items.filter(item => !item.isDone)

  return open.length === 0 ? 'No open items.' : open.map(item => `- [${item.kind}] ${item.id}: ${item.text}`).join('\n')
}

export function compactNote(items: readonly OpenItem[]): string {
  return `[open-items] Unresolved items tracked so far (resolve with the mcp__open-items__track tool):\n${listLines(items)}`
}

/** What the model is told of items the person resolved or dropped in the pane since its last turn. */
export function panelNote(resolved: readonly OpenItem[]): string {
  const lines = resolved.map(item => {
    const how = item.outcome === 'dropped' ? 'marked as will not do' : 'resolved'

    return `- ${item.id} (${how}): ${item.text}`
  })

  return `[open-items] The user closed these in the open-items panel; do not bring them up again:\n${lines.join('\n')}`
}

export function carriedNote(items: readonly OpenItem[]): string {
  return `[open-items] Unresolved items carried over from an earlier session (resolve with the mcp__open-items__track tool):\n${listLines(items)}`
}

// ---- Age and branch ----

export const STALE_MS = 7 * 24 * 60 * 60 * 1000

export function ageText(ms: number, lang: Lang = 'en'): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) {
    return pick(lang, { en: 'just now', 'zh-TW': '剛剛' })
  }
  if (minutes < 60) {
    return pick(lang, { en: `${minutes} min ago`, 'zh-TW': `${minutes} 分鐘前` })
  }
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  return hours < 24 ? pick(lang, { en: `${hours} h ago`, 'zh-TW': `${hours} 小時前` }) : pick(lang, { en: `${days} d ago`, 'zh-TW': `${days} 天前` })
}

/** The pane's dim line beside an item: its age and, when known, the branch it was added on. */
export function metaText(item: OpenItem, now: number, lang: Lang = 'en'): string {
  return [ageText(now - item.createdAt, lang), item.branch].filter(Boolean).join(' · ')
}

export function isStale(item: OpenItem, now: number): boolean {
  return now - item.createdAt > STALE_MS
}

/** "（2 個在其他 branch、1 個超過 7 天）" for the load toast, or "" when neither applies. */
export function loadSummary(items: readonly OpenItem[], branch: string | undefined, now: number, lang: Lang = 'en'): string {
  const elsewhere = items.filter(item => branch !== undefined && item.branch !== undefined && item.branch !== branch).length
  const stale = items.filter(item => isStale(item, now)).length
  const days = STALE_MS / 86_400_000
  const parts = [
    elsewhere > 0 ? pick(lang, { en: `${elsewhere} on other branches`, 'zh-TW': `${elsewhere} 個在其他 branch` }) : '',
    stale > 0 ? pick(lang, { en: `${stale} older than ${days} days`, 'zh-TW': `${stale} 個超過 ${days} 天` }) : '',
  ].filter(Boolean)

  return parts.length === 0 ? '' : pick(lang, { en: ` (${parts.join(', ')})`, 'zh-TW': `（${parts.join('、')}）` })
}

// ---- Markdown for /open-items copy (and a handoff) ----

export function markdownList(items: readonly OpenItem[], lang: Lang = 'en'): string {
  const open = items.filter(item => !item.isDone)
  if (open.length === 0) {
    return ''
  }
  const groups = KINDS.map(kind => {
    const group = open.filter(item => item.kind === kind)
    if (group.length === 0) {
      return ''
    }
    const lines = group.map(item =>
      pick(lang, {
        en: `- ${item.id}: ${item.text}${item.branch === undefined ? '' : ` (${item.branch})`}`,
        'zh-TW': `- ${item.id}：${item.text}${item.branch === undefined ? '' : `（${item.branch}）`}`,
      }),
    )

    return `### ${kindLabel(kind, lang)}\n\n${lines.join('\n')}`
  }).filter(Boolean)

  return `## ${pick(lang, { en: 'Open items', 'zh-TW': '待處理項目' })}\n\n${groups.join('\n\n')}\n`
}

// ---- The pane ----

// The order of the pane's kind groups, its count bar and legend: what waits on the person first.
export const PANE_KINDS: readonly ItemKind[] = ['decision', 'bug', 'question', 'deferred']

/** `width` cells shared out by `values`, each part with any value at least one cell. */
export function splitCells(values: readonly number[], width: number): number[] {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total === 0) {
    return values.map(() => 0)
  }
  const out = values.map(value => (value > 0 ? Math.max(1, Math.round((value / total) * width)) : 0))
  // Rounding can miss the width by a cell or two: the largest part takes the difference.
  const largest = out.indexOf(Math.max(...out))
  out[largest] = Math.max(1, (out[largest] ?? 0) + width - out.reduce((sum, cell) => sum + cell, 0))

  return out
}

/** Oldest first or newest first, by when the item was resolved in the resolved list, else added. */
export function sortItems(items: readonly OpenItem[], newest: boolean, byDone: boolean): OpenItem[] {
  const at = (item: OpenItem): number => (byDone ? (item.doneAt ?? item.createdAt) : item.createdAt)

  return [...items].sort((a, b) => (newest ? at(b) - at(a) : at(a) - at(b)))
}

/** The items by branch: `current` first, the others in the order they first appear; '' has none. */
export function branchGroups(items: readonly OpenItem[], current: string): { branch: string; items: OpenItem[] }[] {
  const names = [...new Set(items.map(item => item.branch ?? ''))]
  const sorted = names.includes(current) ? [current, ...names.filter(name => name !== current)] : names

  return sorted.map(name => ({ branch: name, items: items.filter(item => (item.branch ?? '') === name) }))
}

/** The resolved list's dim line: how long ago it was resolved, its kind and branch. */
export function resolvedMeta(item: OpenItem, now: number, lang: Lang = 'en'): string {
  return [ageText(now - (item.doneAt ?? now), lang), kindShort(item.kind, lang).replace('　', ''), item.branch].filter(Boolean).join(' · ')
}
