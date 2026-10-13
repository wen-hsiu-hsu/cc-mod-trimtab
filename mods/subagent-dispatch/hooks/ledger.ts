import { pick, type KeySpec, type Lang } from './config'

// What one session wrote under `ledger:<sessionId>` in $.store. Each session writes only its
// own key, so concurrent sessions never overwrite each other; `stats` reads every key.
export type Tally = { input: number; cacheWrite: number; cacheRead: number; output: number; steps: number }

// One Agent spawn and the tokens its steps used. `type` is `fork` for a fork and `unknown`
// for steps of an agent id the ledger never saw spawn (one spawned before a hot reload).
export type Spawn = Tally & {
  agentId?: string
  // ms of the spawn and of its last step: the duration is `last - at`.
  at: number
  last: number
  description: string
  type: string
  // The Agent tool's `model` as given; absent when the spawn took the default.
  requested?: string
  // The model the spawn resolved to.
  model: string
  fork: boolean
  background: boolean
}

export type Ledger = {
  // ms of the last write; keys not written for 90 days are deleted at session start.
  updated: number
  // The main working tree's root, so worktrees of one repo group together.
  repo: string
  started: number
  // The first 40 characters of the session's first prompt.
  prompt: string
  // Local day (`2026-10-12`) -> model -> the main session's own tokens that day.
  daily: Record<string, Record<string, Tally>>
  // Oldest first, at most SPAWN_CAP.
  spawns: Spawn[]
  // Set on a ledger rebuilt from the session's transcript rather than recorded live.
  source?: 'transcript'
}

// What the session knows before anything is written; merged into the ledger on each write.
export type SessionMeta = { repo: string; started: number; prompt: string }

export const LEDGER_PREFIX = 'ledger:'
export const RETENTION_MS = 90 * 86_400_000
export const SPAWN_CAP = 500
export const PROMPT_CHARS = 40
export const DEFAULT_DAYS = 30
export const MAX_DAYS = 90
export const DAY_PREFIX = 'day:'
// Day rows are kept this many days, the heatmap's 53 weeks.
export const DAY_KEEP = 366
// The heatmap reads the ledgers for this many days ending today and the day rows before. One day
// short of the retention: a ledger last written on the 90th day back is pruned partway through it.
export const LIVE_DAYS = MAX_DAYS - 1
export const MAX_WEEKS = 53
export const MIN_WEEKS = 4

export const LEDGER_SPEC: KeySpec = {
  category: 'plain',
  type: 'boolean',
  default: true,
  repo: 'never',
  description: {
    en: 'Record each spawn and the token use of the main session and every subagent in a local ledger, for /subagent-dispatch stats. Off records nothing; existing records stay',
    'zh-TW': '把每次派出，以及主 session 與各 subagent 的 token 用量記進本機帳本，供 /subagent-dispatch stats 使用。關閉後不再記錄，已有的紀錄保留',
  },
}

export function emptyLedger(): Ledger {
  return { updated: 0, repo: '', started: 0, prompt: '', daily: {}, spawns: [] }
}

export function promptSummary(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > PROMPT_CHARS ? `${flat.slice(0, PROMPT_CHARS)}…` : flat
}

// Fills what the ledger does not have yet: a resumed session keeps its first start and prompt.
export function applyMeta(ledger: Ledger, meta: SessionMeta): void {
  ledger.repo ||= meta.repo
  ledger.started ||= meta.started
  ledger.prompt ||= meta.prompt
}

function zero(): Tally {
  return { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, steps: 0 }
}

export function recordSpawn(
  ledger: Ledger,
  at: number,
  spawn: { agentId?: string; type: string; model: string; requested?: string; fork: boolean; background: boolean; description: string },
): void {
  ledger.spawns = [
    ...ledger.spawns,
    {
      ...zero(),
      ...(spawn.agentId === undefined ? {} : { agentId: spawn.agentId }),
      at,
      last: at,
      description: spawn.description,
      type: spawn.fork ? 'fork' : spawn.type,
      ...(spawn.requested === undefined || spawn.fork ? {} : { requested: spawn.requested }),
      model: spawn.model,
      fork: spawn.fork,
      background: spawn.background,
    },
  ].slice(-SPAWN_CAP)
  ledger.updated = at
}

export function recordStep(
  ledger: Ledger,
  at: number,
  step: { agentId?: string; model: string; input: number; cacheWrite: number; cacheRead: number; output: number },
): void {
  let tally: Tally
  if (step.agentId === undefined) {
    tally = (ledger.daily[dayOf(at)] ??= {})[step.model] ??= zero()
  } else {
    let spawn = ledger.spawns.findLast(item => item.agentId === step.agentId)
    if (spawn === undefined) {
      spawn = { ...zero(), agentId: step.agentId, at, last: at, description: '', type: 'unknown', model: step.model, fork: false, background: false }
      ledger.spawns = [...ledger.spawns, spawn].slice(-SPAWN_CAP)
    }
    spawn.last = at
    tally = spawn
  }
  tally.input += step.input
  tally.cacheWrite += step.cacheWrite
  tally.cacheRead += step.cacheRead
  tally.output += step.output
  tally.steps += 1
  ledger.updated = at
}

// The local calendar day of a time.
export function dayOf(ms: number): string {
  const d = new Date(ms)

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// A local day without the year: `Oct 12`, `10/12`.
function monthDay(lang: Lang, month: number, day: number): string {
  return pick(lang, { en: `${MONTHS[month - 1]} ${day}`, 'zh-TW': `${month}/${day}` })
}

// A session's start in local time, named with its prompt: `Oct 12 02:11`, `10/12 02:11`.
export function stamp(lang: Lang, ms: number): string {
  const d = new Date(ms)
  const two = (value: number) => String(value).padStart(2, '0')

  return `${monthDay(lang, d.getMonth() + 1, d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

// A local time of day to the second: `19:04:05`.
export function clockTime(ms: number): string {
  const d = new Date(ms)
  const two = (value: number) => String(value).padStart(2, '0')

  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

// The local day of a time: `Oct 12`, `10/12`.
export function dayLabel(lang: Lang, ms: number): string {
  const d = new Date(ms)

  return monthDay(lang, d.getMonth() + 1, d.getDate())
}

// The days a report covers: `Sep 13 – Oct 12`, `9/13 至 10/12`.
export function range(lang: Lang, report: Report): string {
  const label = (day: string) => {
    const [, month, date] = day.split('-').map(Number) as [number, number, number]

    return monthDay(lang, month, date)
  }

  return pick(lang, { en: `${label(report.from)} – ${label(report.to)}`, 'zh-TW': `${label(report.from)} 至 ${label(report.to)}` })
}

// A period: `1 day`, `30 days`, `30 天`.
export function daysLabel(lang: Lang, days: number): string {
  return pick(lang, { en: days === 1 ? '1 day' : `${days} days`, 'zh-TW': `${days} 天` })
}

// The first day a report covers: `days` local days ending today, today included.
function firstDay(now: number, days: number): string {
  const d = new Date(now)
  d.setDate(d.getDate() - (days - 1))

  return dayOf(d.getTime())
}

// A local day `count` days after `day` (before, when negative).
export function addDays(day: string, count: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]

  return dayOf(new Date(year, month - 1, date + count).getTime())
}

const WEEKDAYS = {
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  'zh-TW': ['一', '二', '三', '四', '五', '六', '日'],
} as const

// Monday 0 to Sunday 6.
export function weekday(day: string): number {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]

  return (new Date(year, month - 1, date).getDay() + 6) % 7
}

// A chosen day: `Fri Oct 2`, `10/02 週五`.
export function dayName(lang: Lang, day: string): string {
  const [, month, date] = day.split('-').map(Number) as [number, number, number]
  const two = (value: number) => String(value).padStart(2, '0')

  return pick(lang, {
    en: `${WEEKDAYS.en[weekday(day)]} ${monthDay(lang, month, date)}`,
    'zh-TW': `${two(month)}/${two(date)} 週${WEEKDAYS['zh-TW'][weekday(day)]}`,
  })
}

// A chosen day at the head of a sentence: `Sat Oct 4`, `10/04（六）`.
export function dayHead(lang: Lang, day: string): string {
  const [, month, date] = day.split('-').map(Number) as [number, number, number]
  const two = (value: number) => String(value).padStart(2, '0')

  return pick(lang, { en: dayName(lang, day), 'zh-TW': `${two(month)}/${two(date)}（${WEEKDAYS['zh-TW'][weekday(day)]}）` })
}

// The heatmap's row labels, Monday first: only Monday, Wednesday and Friday are named.
export function weekdayLabels(lang: Lang): string[] {
  return WEEKDAYS[lang].map((name, i) => (i % 2 === 0 && i < 5 ? name : ''))
}

export function tokens(t: Tally): number {
  return t.input + t.cacheWrite + t.output
}

export type SessionRow = { repo: string; started: number; prompt: string; main: number; mainByModel: [string, number][]; cacheRead: number; spawns: Spawn[] }

export type Report = {
  // When the ledgers were read.
  at: number
  days: number
  from: string
  to: string
  main: number
  sub: number
  cacheRead: number
  spawned: { all: number; explicit: number; opus: number; forks: number; defaults: number }
  // Newest session first.
  sessions: SessionRow[]
}

// Adds `spawns` to `counts` by where their model came from, in three kinds that never overlap:
// a fork runs on the main session's model, so it named none and took no default. A spawn the
// ledger only saw step is not counted.
function addKinds(counts: Report['spawned'], spawns: Spawn[]): void {
  for (const spawn of spawns.filter(spawn => spawn.type !== 'unknown')) {
    counts.all += 1
    if (spawn.fork) {
      counts.forks += 1
    } else if (spawn.requested !== undefined) {
      counts.explicit += 1
      if (spawn.requested.toLowerCase().includes('opus')) {
        counts.opus += 1
      }
    } else {
      counts.defaults += 1
    }
  }
}

export function countKinds(spawns: Spawn[]): Report['spawned'] {
  const counts = { all: 0, explicit: 0, opus: 0, forks: 0, defaults: 0 }
  addKinds(counts, spawns)

  return counts
}

// A stored ledger in the current format, or undefined for anything else, such as a ledger of the
// unreleased first format (spawns per day). A ledger written before 0.4.0 kept the main
// session's tokens per model only, as `main`: they count on the day of its last write.
export function readLedger(value: unknown): Ledger | undefined {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as Ledger).spawns)) {
    return undefined
  }
  const { main, ...rest } = value as Ledger & { main?: Record<string, Tally> }
  if (typeof rest.daily === 'object' && rest.daily !== null) {
    return { ...emptyLedger(), ...rest }
  }
  if (typeof main !== 'object' || main === null) {
    return undefined
  }

  return { ...emptyLedger(), ...rest, daily: Object.keys(main).length === 0 ? {} : { [dayOf(rest.updated)]: main } }
}

// Every session written to in the window, with its main tokens of the days in the window and
// its spawns whose last step falls in it. The window is `days` days ending today, or `day` alone.
export function buildReport(stored: unknown[], days: number, now: number, day?: string): Report {
  const from = day ?? firstDay(now, days)
  const to = day ?? dayOf(now)
  const report: Report = { at: now, days: day === undefined ? days : 1, from, to, main: 0, sub: 0, cacheRead: 0, spawned: { all: 0, explicit: 0, opus: 0, forks: 0, defaults: 0 }, sessions: [] }
  for (const ledger of stored.map(readLedger)) {
    if (ledger === undefined || dayOf(ledger.updated) < from) {
      continue
    }
    const spawns = ledger.spawns.filter(spawn => dayOf(spawn.last) >= from && dayOf(spawn.last) <= to)
    const main = new Map<string, number>()
    let cacheRead = 0
    for (const [day, models] of Object.entries(ledger.daily)) {
      if (day < from || day > to) {
        continue
      }
      for (const [model, tally] of Object.entries(models)) {
        main.set(model, (main.get(model) ?? 0) + tokens(tally))
        cacheRead += tally.cacheRead
      }
    }
    const mainByModel = [...main]
    const row: SessionRow = {
      repo: ledger.repo,
      started: ledger.started || ledger.updated,
      prompt: ledger.prompt,
      main: mainByModel.reduce((sum, [, count]) => sum + count, 0),
      mainByModel,
      cacheRead,
      spawns,
    }
    if (row.main === 0 && spawns.length === 0) {
      continue
    }
    report.sessions.push(row)
    report.main += row.main
    report.cacheRead += row.cacheRead
    for (const spawn of spawns) {
      report.sub += tokens(spawn)
      report.cacheRead += spawn.cacheRead
    }
    addKinds(report.spawned, spawns)
  }
  report.sessions.sort((a, b) => b.started - a.started)

  return report
}

// --- Day rows: one per local day under `day:YYYY-MM-DD`, kept DAY_KEEP days, so the heatmap
// outlives the ledgers. Each is computed whole from the ledgers, never added to (ADR 0024).

export type DayRow = {
  // The main session's tokens that day, by model.
  main: Record<string, Tally>
  // The tokens of the spawns whose last step fell that day, by the model each resolved to.
  sub: Record<string, Tally>
  spawned: Report['spawned']
  // When the row was computed.
  at: number
}

export function readDayRow(value: unknown): DayRow | undefined {
  const row = value as DayRow | undefined
  const isObject = (part: unknown) => typeof part === 'object' && part !== null
  if (!isObject(row) || !isObject(row!.main) || !isObject(row!.sub) || !isObject(row!.spawned)) {
    return undefined
  }

  return row
}

function add(into: Tally, from: Tally): void {
  into.input += from.input
  into.cacheWrite += from.cacheWrite
  into.cacheRead += from.cacheRead
  into.output += from.output
  into.steps += from.steps
}

// The days a ledger has a record of: from its start to its last write, at most DAY_KEEP of them
// back from the last, and any day it counted tokens on (a ledger of the old format has no start).
export function recordedDays(ledger: Ledger): Set<string> {
  const days = new Set(Object.keys(ledger.daily))
  const last = dayOf(ledger.updated)
  const first = dayOf(ledger.started || ledger.updated)
  for (let day = last, i = 0; day >= first && i < DAY_KEEP; day = addDays(day, -1), i += 1) {
    days.add(day)
  }

  return days
}

export function dayRow(ledgers: Ledger[], day: string, at: number): DayRow {
  const row: DayRow = { main: {}, sub: {}, spawned: { all: 0, explicit: 0, opus: 0, forks: 0, defaults: 0 }, at }
  for (const ledger of ledgers) {
    for (const [model, tally] of Object.entries(ledger.daily[day] ?? {})) {
      add((row.main[model] ??= zero()), tally)
    }
    const spawns = ledger.spawns.filter(spawn => dayOf(spawn.last) === day)
    for (const spawn of spawns) {
      add((row.sub[spawn.model] ??= zero()), spawn)
    }
    addKinds(row.spawned, spawns)
  }

  return row
}

// The days a ledger recorded up to the day before yesterday (yesterday a session may still write
// to), oldest first: the days a day row may be computed for.
export function settledDays(ledgers: Ledger[], now: number): string[] {
  const last = addDays(dayOf(now), -2)
  const days = new Set<string>()
  for (const ledger of ledgers) {
    for (const day of recordedDays(ledger)) {
      if (day <= last) {
        days.add(day)
      }
    }
  }

  return [...days].sort()
}

function sumTokens(tallies: Record<string, Tally>): number {
  return Object.values(tallies).reduce((total, tally) => total + tokens(tally), 0)
}

// A one-day report from a day row alone: the cards' figures, no sessions.
export function dayReport(row: DayRow, day: string, now: number): Report {
  const cacheRead = [...Object.values(row.main), ...Object.values(row.sub)].reduce((total, tally) => total + tally.cacheRead, 0)

  return { at: now, days: 1, from: day, to: day, main: sumTokens(row.main), sub: sumTokens(row.sub), cacheRead, spawned: { ...row.spawned }, sessions: [] }
}

// The first day the heatmap and a chosen day read from the ledgers; before it, from day rows.
export function liveFrom(now: number): string {
  return firstDay(now, LIVE_DAYS)
}

// --- The calendar heatmap.

// One day: its tokens (main session and spawns, without cache read), 0 for a day recorded with no
// use, null for a day nothing recorded.
export type HeatDay = { day: string; tokens: number | null }

// How many weeks a pane of `bodyColumns` fits: a week takes two columns after four for the labels.
export function heatWeeks(bodyColumns: number): number {
  return Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, Math.floor((bodyColumns - 4) / 2)))
}

// The heatmap's first day: the Monday `weeks - 1` weeks before this week's.
export function heatStart(weeks: number, now: number): string {
  const today = dayOf(now)

  return addDays(today, -weekday(today) - (weeks - 1) * 7)
}

// `weeks` weeks of days, Monday first, ending today: the last LIVE_DAYS days from the ledgers, as
// the rest of the pane counts them, and the days before from their day rows.
export function buildHeatmap(stored: unknown[], dayRows: Record<string, unknown>, weeks: number, now: number): { days: HeatDay[] } {
  const today = dayOf(now)
  const live = liveFrom(now)
  const recorded = new Set<string>()
  const used = new Map<string, number>()
  const count = (day: string, value: number) => used.set(day, (used.get(day) ?? 0) + value)
  for (const ledger of stored.map(readLedger)) {
    if (ledger === undefined) {
      continue
    }
    for (const day of recordedDays(ledger)) {
      recorded.add(day)
    }
    for (const [day, models] of Object.entries(ledger.daily)) {
      count(day, sumTokens(models))
    }
    for (const spawn of ledger.spawns) {
      count(dayOf(spawn.last), tokens(spawn))
    }
  }
  const days: HeatDay[] = []
  for (let day = heatStart(weeks, now); day <= today; day = addDays(day, 1)) {
    if (day >= live) {
      days.push({ day, tokens: recorded.has(day) ? (used.get(day) ?? 0) : null })
    } else {
      const row = readDayRow(dayRows[day])
      days.push({ day, tokens: row === undefined ? null : sumTokens(row.main) + sumTokens(row.sub) })
    }
  }

  return { days }
}

// The level 1–4 of a day's tokens among the used days drawn, by quartile; 0 for no use.
export function heatLevels(days: HeatDay[]): (value: number | null) => number {
  const values = days.flatMap(item => (item.tokens !== null && item.tokens > 0 ? [item.tokens] : [])).sort((a, b) => a - b)
  const at = (p: number) => values[Math.max(0, Math.ceil(values.length * p) - 1)] ?? 0
  const [q1, q2, q3] = [at(0.25), at(0.5), at(0.75)]

  return value => (value === null || value <= 0 ? 0 : value <= q1 ? 1 : value <= q2 ? 2 : value <= q3 ? 3 : 4)
}

// The month row over the heatmap's weeks: a label where a month first shows (the week whose
// Sunday falls in it); on the first week only when its Monday is the 1st.
export function monthMarks(lang: Lang, days: HeatDay[]): { week: number; label: string }[] {
  const marks: { week: number; label: string }[] = []
  let last = ''
  for (let week = 0; week * 7 < days.length; week += 1) {
    const monday = days[week * 7]!.day
    const sunday = addDays(monday, 6)
    if (sunday.slice(0, 7) !== last && (week > 0 || monday.endsWith('-01'))) {
      const month = Number(sunday.slice(5, 7))
      marks.push({ week, label: pick(lang, { en: MONTHS[month - 1]!, 'zh-TW': `${month}月` }) })
    }
    last = sunday.slice(0, 7)
  }

  return marks
}

// A count in a few characters: `950`, `12k`, `1.2M`, `15M`; rounding never reads `1000k` or `10.0M`.
export function shortCount(value: number): string {
  const millions = value / 1e6
  if (millions >= 9.95) {
    return `${Math.round(millions)}M`
  }
  if (value >= 999_500) {
    return `${millions.toFixed(1)}M`
  }

  return value >= 999.5 ? `${Math.round(value / 1e3)}k` : String(Math.round(value))
}

// --- Rebuilding ledgers from transcripts: `<projects>/<project>/<sid>.jsonl` is a session, and
// `<project>/<sid>/subagents/agent-<id>.jsonl` with its `.meta.json` one of its spawns.

export type ParsedStep = { at: number; model: string; tally: Tally }
export type Parsed = { started: number; updated: number; prompt: string; cwd: string; steps: ParsedStep[] }

type Line = {
  type?: string
  timestamp?: string
  cwd?: string
  isSidechain?: boolean
  isMeta?: boolean
  message?: { id?: string; model?: string; content?: unknown; usage?: Record<string, number | undefined> }
}

function promptText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }

  return content.flatMap(block => ((block as { type?: string }).type === 'text' ? [String((block as { text?: unknown }).text ?? '')] : [])).join(' ')
}

// A transcript's first and last time, first prompt, first directory and steps. A reply is written
// as a line per content block: one step, with the usage of its last line. The lines of a subagent
// (`isSidechain`) count only with `sidechain`, for a subagent's own transcript.
export function parseTranscript(text: string, sidechain = false): Parsed {
  const parsed: Parsed = { started: 0, updated: 0, prompt: '', cwd: '', steps: [] }
  const steps = new Map<string, ParsedStep>()
  for (const raw of text.split('\n')) {
    let line: Line
    try {
      line = JSON.parse(raw) as Line
    } catch {
      continue
    }
    if (typeof line !== 'object' || line === null) {
      continue
    }
    const at = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : Number.NaN
    if (!Number.isNaN(at)) {
      parsed.started ||= at
      parsed.updated = Math.max(parsed.updated, at)
    }
    parsed.cwd ||= typeof line.cwd === 'string' ? line.cwd : ''
    if (line.isSidechain === true && !sidechain) {
      continue
    }
    if (line.type === 'user' && parsed.prompt === '' && line.isMeta !== true) {
      const words = promptText(line.message?.content).trim()
      if (words !== '' && !words.startsWith('<')) {
        parsed.prompt = promptSummary(words)
      }
    }
    const usage = line.message?.usage
    const model = line.message?.model ?? ''
    if (line.type !== 'assistant' || typeof usage !== 'object' || model === '' || model === '<synthetic>' || Number.isNaN(at)) {
      continue
    }
    steps.set(line.message?.id ?? `${at}:${steps.size}`, {
      at,
      model,
      tally: {
        input: usage.input_tokens ?? 0,
        cacheWrite: usage.cache_creation_input_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        steps: 1,
      },
    })
  }
  parsed.steps = [...steps.values()]

  return parsed
}

// What a subagent's `.meta.json` holds: `model` is the Agent tool's as given, `inherit` on a fork.
type SubagentMeta = { agentType?: string; description?: string; model?: string; requestShape?: string; isFork?: boolean }

// A spawn from a subagent's transcript and its meta; undefined for a transcript with no time in it.
export function parseSubagent(meta: unknown, text: string, agentId: string): Spawn | undefined {
  const info = (typeof meta === 'object' && meta !== null ? meta : {}) as SubagentMeta
  const parsed = parseTranscript(text, true)
  const first = parsed.steps[0]
  const at = first?.at ?? parsed.started
  if (at === 0) {
    return undefined
  }
  const fork = info.isFork === true || info.agentType === 'fork'
  const spawn: Spawn = {
    ...zero(),
    agentId,
    at,
    last: parsed.steps.at(-1)?.at ?? at,
    description: info.description ?? '',
    type: fork ? 'fork' : (info.agentType ?? 'general-purpose'),
    ...(fork || typeof info.model !== 'string' ? {} : { requested: info.model }),
    model: first?.model ?? 'unknown',
    fork,
    background: info.requestShape !== 'foreground',
  }
  for (const step of parsed.steps) {
    add(spawn, step.tally)
  }

  return spawn
}

// A session's ledger rebuilt from its transcript and its spawns'.
export function transcriptLedger(parsed: Parsed, spawns: Spawn[], repo: string): Ledger {
  const ledger: Ledger = { ...emptyLedger(), repo, started: parsed.started, prompt: parsed.prompt, source: 'transcript' }
  for (const step of parsed.steps) {
    add(((ledger.daily[dayOf(step.at)] ??= {})[step.model] ??= zero()), step.tally)
  }
  ledger.spawns = [...spawns].sort((a, b) => a.at - b.at).slice(-SPAWN_CAP)
  ledger.updated = Math.max(parsed.updated, ...ledger.spawns.map(spawn => spawn.last))

  return ledger
}

// Tokens per model over the report: the main session's by the model each step named, a
// spawn's by the model it resolved to.
export function byModel(report: Report): [string, number][] {
  const totals = new Map<string, number>()
  for (const session of report.sessions) {
    for (const [model, count] of session.mainByModel) {
      totals.set(model, (totals.get(model) ?? 0) + count)
    }
    for (const spawn of session.spawns) {
      totals.set(spawn.model, (totals.get(spawn.model) ?? 0) + tokens(spawn))
    }
  }

  return [...totals].sort((a, b) => b[1] - a[1])
}

// The report's sessions grouped by repo, the repo of the newest session first.
export function byRepo(report: Report): [string, SessionRow[]][] {
  const groups = new Map<string, SessionRow[]>()
  for (const session of report.sessions) {
    groups.set(session.repo, [...(groups.get(session.repo) ?? []), session])
  }

  return [...groups]
}

export type GroupBy = 'repo' | 'session' | 'model' | 'type'
export const GROUP_BYS: readonly GroupBy[] = ['repo', 'session', 'model', 'type']

// One row of the pane's grouping, and what it opens to: per session, the main tokens that
// fall in the group and the spawns that do.
export type Group = { key: string; label: string; tokens: number; spawns: number; detail: { session: SessionRow; main: number; spawns: Spawn[] }[] }

export function groups(lang: Lang, report: Report, by: GroupBy): Group[] {
  const found = new Map<string, Group>()
  const add = (key: string, label: string, session: SessionRow, main: number, spawns: Spawn[]) => {
    let group = found.get(key)
    if (group === undefined) {
      group = { key, label, tokens: 0, spawns: 0, detail: [] }
      found.set(key, group)
    }
    group.tokens += main + spawns.reduce((sum, spawn) => sum + tokens(spawn), 0)
    group.spawns += spawns.filter(spawn => spawn.type !== 'unknown').length
    const last = group.detail.at(-1)
    if (last?.session === session) {
      last.main += main
      last.spawns.push(...spawns)
    } else {
      group.detail.push({ session, main, spawns: [...spawns] })
    }
  }
  for (const session of report.sessions) {
    if (by === 'repo') {
      add(session.repo, repoName(lang, session.repo), session, session.main, session.spawns)
    } else if (by === 'session') {
      add(`${session.repo}|${session.started}`, sessionName(lang, session), session, session.main, session.spawns)
    } else if (by === 'model') {
      for (const [model, count] of session.mainByModel) {
        add(model, model, session, count, [])
      }
      for (const spawn of session.spawns) {
        add(spawn.model, spawn.model, session, 0, [spawn])
      }
    } else {
      if (session.main > 0) {
        add('main', pick(lang, { en: 'main session', 'zh-TW': '主 session' }), session, session.main, [])
      }
      for (const spawn of session.spawns) {
        add(spawn.type, spawn.type, session, 0, [spawn])
      }
    }
  }

  return [...found.values()].sort((a, b) => b.tokens - a.tokens)
}

export const n = (value: number): string => value.toLocaleString('en-US')

// Characters a terminal draws two cells wide (CJK, full-width forms, emoji).
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u

export function cells(text: string): number {
  let count = 0
  for (const ch of text) {
    count += WIDE.test(ch) ? 2 : 1
  }

  return count
}

// Cut to `width` cells, ending in "…" when cut: a Button's text does not truncate on its own and
// wraps instead once CJK and Latin mix.
export function fit(text: string, width: number): string {
  if (cells(text) <= width) {
    return text
  }
  let out = ''
  let used = 0
  for (const ch of text) {
    const w = WIDE.test(ch) ? 2 : 1
    if (used + w > width - 1) {
      break
    }
    out += ch
    used += w
  }

  return `${out}…`
}

export function share(part: number, whole: number): string {
  return whole === 0 ? '0%' : `${Math.round((part / whole) * 100)}%`
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) {
    return `${s}s`
  }
  const m = Math.floor(s / 60)
  if (m < 60) {
    return `${m}m${String(s % 60).padStart(2, '0')}s`
  }

  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export function sessionName(lang: Lang, session: SessionRow): string {
  return `${stamp(lang, session.started)} ${session.prompt || pick(lang, { en: '(no prompt)', 'zh-TW': '（沒有 prompt）' })}`
}

// A repo by its folder's name, as the pane's rows show it.
export function repoName(lang: Lang, repo: string): string {
  return repo.split('/').filter(Boolean).at(-1) ?? pick(lang, { en: '(no repo)', 'zh-TW': '（沒有 repo）' })
}

// A spawn in three parts: what it was asked, what ran it, and what it cost.
export function spawnParts(lang: Lang, spawn: Spawn): [string, string, string] {
  return [
    spawn.description || pick(lang, { en: '(spawned before the ledger saw it)', 'zh-TW': '（派出時帳本沒看到）' }),
    `${spawn.type} · ${spawn.requested ?? pick(lang, { en: 'default', 'zh-TW': '預設' })} → ${spawn.model}`,
    [
      ...(spawn.background ? [pick(lang, { en: 'background', 'zh-TW': '背景' })] : []),
      pick(lang, { en: `${n(tokens(spawn))} tokens`, 'zh-TW': `${n(tokens(spawn))} token` }),
      pick(lang, { en: `${spawn.steps} steps`, 'zh-TW': `${spawn.steps} 步` }),
      elapsed(spawn.last - spawn.at),
    ].join(' · '),
  ]
}

export function spawnLine(lang: Lang, spawn: Spawn): string {
  return spawnParts(lang, spawn).join(' · ')
}

export function emptyText(lang: Lang): string {
  return pick(lang, {
    en: 'No usage recorded yet (recording starts once the ledger setting is on and subagent-dispatch is loaded).',
    'zh-TW': '還沒有用量紀錄（ledger 設定開啟且載入 subagent-dispatch 後才開始記）。',
  })
}

export function summaryLines(lang: Lang, report: Report): string[] {
  const all = report.main + report.sub
  const s = report.spawned

  return [
    pick(lang, {
      en: `Tokens (input + cache write + output): ${n(all)}`,
      'zh-TW': `Token（input + cache write + output）：${n(all)}`,
    }),
    pick(lang, { en: `  main session  ${n(report.main)}`, 'zh-TW': `  主 session  ${n(report.main)}` }),
    pick(lang, {
      en: `  subagents     ${n(report.sub)} (${share(report.sub, all)} of all tokens)`,
      'zh-TW': `  subagent    ${n(report.sub)}（佔全部 ${share(report.sub, all)}）`,
    }),
    pick(lang, { en: `Cache read (not counted above): ${n(report.cacheRead)}`, 'zh-TW': `Cache read（不含在上面）：${n(report.cacheRead)}` }),
    pick(lang, {
      en: `Spawns: ${s.all} (named a model ${s.explicit}, Opus among them ${s.opus}; default model ${s.defaults}; fork ${s.forks})`,
      'zh-TW': `派出：${s.all} 次（指定模型 ${s.explicit}，其中 Opus ${s.opus}；沿用預設 ${s.defaults}；fork ${s.forks}）`,
    }),
  ]
}

export const NOT_INCLUDED: Record<Lang, string> = {
  en: "Not included: mods' own model calls ($.model.fork/complete), cloud sessions, and sessions whose transcripts this machine no longer had when the ledger was installed.",
  'zh-TW': '不含：各 mod 自己呼叫模型（$.model.fork/complete）的用量、雲端 session，以及安裝帳本時這台電腦已經沒有 transcript 的 session。',
}

// `/subagent-dispatch stats --text [days]`, and what `stats` prints where no pane can be placed.
export function renderStats(lang: Lang, report: Report): string {
  if (report.sessions.length === 0) {
    return emptyText(lang)
  }
  const all = report.main + report.sub
  const lines: string[] = [
    pick(lang, {
      en: `subagent-dispatch usage, ${daysLabel(lang, report.days)}: ${range(lang, report)}`,
      'zh-TW': `subagent-dispatch 用量，${daysLabel(lang, report.days)}：${range(lang, report)}`,
    }),
    '',
    ...summaryLines(lang, report),
    '',
    pick(lang, { en: 'Tokens per model', 'zh-TW': '各模型 token' }),
    ...byModel(report).map(([model, count]) => `  ${model.padEnd(28)}${n(count)} (${share(count, all)})`),
    '',
    pick(lang, { en: 'Sessions', 'zh-TW': '各 session' }),
  ]
  for (const [repo, sessions] of byRepo(report)) {
    lines.push(repo || pick(lang, { en: '(no repo)', 'zh-TW': '（沒有 repo）' }))
    for (const session of sessions) {
      lines.push(
        `  ${sessionName(lang, session)}  ` +
          pick(lang, {
            en: `main ${n(session.main)} · ${session.spawns.length} spawn(s)`,
            'zh-TW': `主 ${n(session.main)} · 派出 ${session.spawns.length} 次`,
          }),
      )
      lines.push(...session.spawns.map(spawn => `    - ${spawnLine(lang, spawn)}`))
    }
  }
  lines.push('', NOT_INCLUDED[lang])

  return lines.join('\n')
}
