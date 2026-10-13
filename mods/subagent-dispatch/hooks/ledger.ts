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
}

// What the session knows before anything is written; merged into the ledger on each write.
export type SessionMeta = { repo: string; started: number; prompt: string }

export const LEDGER_PREFIX = 'ledger:'
export const RETENTION_MS = 90 * 86_400_000
export const SPAWN_CAP = 500
export const PROMPT_CHARS = 40
export const DEFAULT_DAYS = 30
export const MAX_DAYS = 90

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
// its spawns whose last step falls in it.
export function buildReport(stored: unknown[], days: number, now: number): Report {
  const from = firstDay(now, days)
  const to = dayOf(now)
  const report: Report = { at: now, days, from, to, main: 0, sub: 0, cacheRead: 0, spawned: { all: 0, explicit: 0, opus: 0, forks: 0, defaults: 0 }, sessions: [] }
  for (const ledger of stored.map(readLedger)) {
    if (ledger === undefined || dayOf(ledger.updated) < from) {
      continue
    }
    const spawns = ledger.spawns.filter(spawn => dayOf(spawn.last) >= from)
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
  en: "Not included: mods' own model calls ($.model.fork/complete), cloud sessions, and anything before the ledger was installed.",
  'zh-TW': '不含：各 mod 自己呼叫模型（$.model.fork/complete）的用量、雲端 session，以及安裝帳本之前的紀錄。',
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
