import { pick, type KeySpec, type Lang } from './config'

// What one session wrote under `ledger:<sessionId>` in $.store. Each session writes only its
// own key, so concurrent sessions never overwrite each other; `stats` sums every key.
export type Tally = { input: number; cacheWrite: number; cacheRead: number; output: number; steps: number }

export type Ledger = {
  // ms of the last write; keys not written for 90 days are deleted at session start.
  updated: number
  // Local day `YYYY-MM-DD` -> `<who>|<model>` -> tokens. `who` is `main`, the agent type
  // (`fork` for a fork) or `unknown` (an agent id the ledger never saw spawn).
  steps: Record<string, Record<string, Tally>>
  // Local day -> `<type>|<model>` -> spawns; the model is the one the spawn resolved to.
  spawns: Record<string, Record<string, number>>
  // Local day -> spawns that named a model, named an Opus one (not a fork), and forks.
  counts: Record<string, { explicit: number; opus: number; forks: number }>
  // The explicit-Opus spawns, oldest first, at most OPUS_CAP.
  opus: { day: string; type: string; description: string }[]
  // agentId -> what it was spawned as, so steps after a hot reload are still attributed.
  agents: Record<string, { type: string; model: string }>
}

export const LEDGER_PREFIX = 'ledger:'
export const RETENTION_MS = 90 * 86_400_000
export const OPUS_CAP = 200
export const AGENTS_CAP = 500
export const DEFAULT_DAYS = 30
export const MAX_DAYS = 90

export const LEDGER_SPEC: KeySpec = {
  category: 'plain',
  type: 'boolean',
  default: true,
  repo: 'never',
  description: {
    en: 'Record token use by the main session and each subagent in a local ledger, for /agent-dispatch stats. Off records nothing; existing records stay',
    'zh-TW': '把主 session 與各 subagent 的 token 用量記進本機帳本，供 /agent-dispatch stats 使用。關閉後不再記錄，已有的紀錄保留',
  },
}

export function emptyLedger(): Ledger {
  return { updated: 0, steps: {}, spawns: {}, counts: {}, opus: [], agents: {} }
}

// The local calendar day of a time, the key the ledger buckets by.
export function dayOf(ms: number): string {
  const d = new Date(ms)

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function recordSpawn(
  ledger: Ledger,
  at: number,
  spawn: { agentId?: string; type: string; model: string; requested?: string; fork: boolean; description: string },
): void {
  const day = dayOf(at)
  const type = spawn.fork ? 'fork' : spawn.type
  const key = `${type}|${spawn.model}`
  const spawns = (ledger.spawns[day] ??= {})
  spawns[key] = (spawns[key] ?? 0) + 1
  const counts = (ledger.counts[day] ??= { explicit: 0, opus: 0, forks: 0 })
  if (spawn.requested !== undefined) {
    counts.explicit += 1
  }
  if (spawn.fork) {
    counts.forks += 1
  } else if (spawn.requested?.toLowerCase().includes('opus')) {
    counts.opus += 1
    ledger.opus = [...ledger.opus, { day, type, description: spawn.description }].slice(-OPUS_CAP)
  }
  if (spawn.agentId !== undefined) {
    delete ledger.agents[spawn.agentId]
    ledger.agents[spawn.agentId] = { type, model: spawn.model }
    for (const old of Object.keys(ledger.agents).slice(0, -AGENTS_CAP)) {
      delete ledger.agents[old]
    }
  }
  ledger.updated = at
}

export function recordStep(
  ledger: Ledger,
  at: number,
  step: { agentId?: string; model: string; input: number; cacheWrite: number; cacheRead: number; output: number },
): void {
  const who = step.agentId === undefined ? 'main' : (ledger.agents[step.agentId]?.type ?? 'unknown')
  const day = (ledger.steps[dayOf(at)] ??= {})
  const tally = (day[`${who}|${step.model}`] ??= { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, steps: 0 })
  tally.input += step.input
  tally.cacheWrite += step.cacheWrite
  tally.cacheRead += step.cacheRead
  tally.output += step.output
  tally.steps += 1
  ledger.updated = at
}

// The first day `stats` covers: `days` local days ending today, today included.
function firstDay(now: number, days: number): string {
  const d = new Date(now)
  d.setDate(d.getDate() - (days - 1))

  return dayOf(d.getTime())
}

function tokens(t: Tally): number {
  return t.input + t.cacheWrite + t.output
}

const n = (value: number): string => value.toLocaleString('en-US')

function share(part: number, whole: number): string {
  return whole === 0 ? '0%' : `${Math.round((part / whole) * 100)}%`
}

function isLedger(value: unknown): value is Ledger {
  return typeof value === 'object' && value !== null && typeof (value as Ledger).steps === 'object' && (value as Ledger).steps !== null
}

// `/agent-dispatch stats [days]`: the ledgers of every session summed over the window.
export function renderStats(lang: Lang, stored: unknown[], days: number, now: number): string {
  const from = firstDay(now, days)
  const to = dayOf(now)
  const inWindow = (day: string): boolean => day >= from && day <= to
  const total = { main: 0, sub: 0, cacheRead: 0 }
  const byModel = new Map<string, number>()
  const byAgent = new Map<string, { type: string; model: string; spawns: number; tokens: number }>()
  const spawned = { all: 0, explicit: 0, opus: 0, forks: 0 }
  const opus: Ledger['opus'] = []
  const agentRow = (type: string, model: string) => {
    const key = `${type}|${model}`
    let row = byAgent.get(key)
    if (row === undefined) {
      row = { type, model, spawns: 0, tokens: 0 }
      byAgent.set(key, row)
    }

    return row
  }
  let any = false
  for (const ledger of stored.filter(isLedger)) {
    for (const [day, buckets] of Object.entries(ledger.steps)) {
      if (!inWindow(day)) {
        continue
      }
      for (const [key, tally] of Object.entries(buckets)) {
        const [who, model] = key.split('|') as [string, string]
        any = true
        total.cacheRead += tally.cacheRead
        byModel.set(model, (byModel.get(model) ?? 0) + tokens(tally))
        if (who === 'main') {
          total.main += tokens(tally)
        } else {
          total.sub += tokens(tally)
          agentRow(who, model).tokens += tokens(tally)
        }
      }
    }
    for (const [day, buckets] of Object.entries(ledger.spawns ?? {})) {
      if (!inWindow(day)) {
        continue
      }
      for (const [key, count] of Object.entries(buckets)) {
        const [type, model] = key.split('|') as [string, string]
        any = true
        spawned.all += count
        agentRow(type, model).spawns += count
      }
    }
    for (const [day, c] of Object.entries(ledger.counts ?? {})) {
      if (inWindow(day)) {
        spawned.explicit += c.explicit
        spawned.opus += c.opus
        spawned.forks += c.forks
      }
    }
    opus.push(...(ledger.opus ?? []).filter(item => inWindow(item.day)))
  }
  if (!any) {
    return pick(lang, {
      en: 'No usage recorded yet (recording starts once the ledger setting is on and agent-dispatch is loaded).',
      'zh-TW': '還沒有用量紀錄（ledger 設定開啟且載入 agent-dispatch 後才開始記）。',
    })
  }
  const all = total.main + total.sub
  const models = [...byModel].sort((a, b) => b[1] - a[1])
  const agents = [...byAgent.values()].sort((a, b) => b.tokens - a.tokens || b.spawns - a.spawns)
  // Newest first: reverse the oldest-first lists, then a stable sort on the day.
  const latest = opus
    .reverse()
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
    .slice(0, 10)
  const lines: string[] = [
    pick(lang, {
      en: `agent-dispatch usage, ${days} day(s): ${from} to ${to}`,
      'zh-TW': `agent-dispatch 用量，${days} 天：${from} 到 ${to}`,
    }),
    '',
    pick(lang, {
      en: `Tokens (input + cache write + output): ${n(all)}`,
      'zh-TW': `Token（input + cache write + output）：${n(all)}`,
    }),
    pick(lang, { en: `  main session  ${n(total.main)}`, 'zh-TW': `  主 session  ${n(total.main)}` }),
    pick(lang, {
      en: `  subagents     ${n(total.sub)} (${share(total.sub, all)} of all tokens)`,
      'zh-TW': `  subagent    ${n(total.sub)}（佔全部 ${share(total.sub, all)}）`,
    }),
    pick(lang, { en: `Cache read (not counted above): ${n(total.cacheRead)}`, 'zh-TW': `Cache read（不含在上面）：${n(total.cacheRead)}` }),
    '',
    pick(lang, { en: 'Tokens per model', 'zh-TW': '各模型 token' }),
    ...models.map(([model, count]) => `  ${model.padEnd(28)}${n(count)} (${share(count, all)})`),
    '',
    pick(lang, { en: 'Agent type x model', 'zh-TW': 'agent 種類 × 模型' }),
    ...agents.map(
      row =>
        `  ${`${row.type} / ${row.model}`.padEnd(44)}` +
        pick(lang, { en: `${row.spawns} spawn(s)  ${n(row.tokens)} tokens`, 'zh-TW': `${row.spawns} 次  ${n(row.tokens)} token` }),
    ),
    '',
    pick(lang, {
      en: `Spawns: ${spawned.all} (explicit model ${spawned.explicit}/${spawned.all}, explicit Opus ${spawned.opus}, forks ${spawned.forks})`,
      'zh-TW': `派出：${spawned.all} 次（指定模型 ${spawned.explicit}/${spawned.all}，指定 Opus ${spawned.opus}，fork ${spawned.forks}）`,
    }),
  ]
  if (latest.length > 0) {
    lines.push(pick(lang, { en: 'Latest explicit-Opus spawns:', 'zh-TW': '最近指定 Opus 的派出：' }))
    lines.push(...latest.map(item => `  ${item.day} ${item.type}: ${item.description}`))
  }
  lines.push(
    '',
    pick(lang, {
      en: "Not included: mods' own model calls ($.model.fork/complete), cloud sessions, and anything before the ledger was installed.",
      'zh-TW': '不含：各 mod 自己呼叫模型（$.model.fork/complete）的用量、雲端 session，以及安裝帳本之前的紀錄。',
    }),
  )

  return lines.join('\n')
}
