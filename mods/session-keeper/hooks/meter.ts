import type { CacheMeter, CacheTtl } from '../types'

// A request that reads this many fewer tokens than the previous one sent counts as a miss.
const MISS_MIN_TOKENS = 2048
const MISS_MIN_RATIO = 0.2
export const TTL_MS: Record<CacheTtl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }
// Yellow once this little is left: 5 minutes of an hour, 1 minute of five.
const WARN_MS: Record<CacheTtl, number> = { '5m': 60_000, '1h': 5 * 60_000 }

export const EMPTY: CacheMeter = {
  sessionId: '',
  requests: 0,
  inputTokens: 0,
  readTokens: 0,
  writeTokens: 0,
  lastAt: 0,
  lastModel: '',
  lastInput: 0,
  nextTokens: 0,
  toolsKey: '',
  ttl: null,
  ttlCheckedAt: 0,
  misses: 0,
  missTokens: 0,
  lastCauses: [],
  expectRebuild: false,
  keeps: 0,
}

export type Step = {
  at: number
  model: string
  toolsKey: string
  input: number
  output: number
  read: number
  write: number
}

// Short, order-independent fingerprint of the tool list.
export function toolsKey(names: readonly string[]): string {
  let hash = 5381
  for (const char of [...names].sort().join(',')) {
    hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0
  }

  return `${names.length}:${hash.toString(36)}`
}

// Which local change most likely invalidated the cache; the API does not say.
export function guessCauses(meter: CacheMeter, step: Step): string[] {
  const causes: string[] = []
  if (meter.lastModel !== '' && step.model !== meter.lastModel) {
    causes.push('model?')
  }
  if (meter.toolsKey !== '' && step.toolsKey !== meter.toolsKey) {
    causes.push('tools?')
  }
  if (step.at - meter.lastAt > TTL_MS[meter.ttl ?? '5m']) {
    causes.push('ttl?')
  }

  return causes.length > 0 ? causes : ['unknown']
}

export function record(meter: CacheMeter, step: Step): CacheMeter {
  const sent = step.input + step.read + step.write
  const lost = meter.lastInput - step.read
  const isMiss =
    meter.requests > 0 && !meter.expectRebuild && lost > Math.max(MISS_MIN_TOKENS, meter.lastInput * MISS_MIN_RATIO)

  return {
    ...meter,
    requests: meter.requests + 1,
    inputTokens: meter.inputTokens + sent,
    readTokens: meter.readTokens + step.read,
    writeTokens: meter.writeTokens + step.write,
    lastAt: step.at,
    lastModel: step.model,
    lastInput: sent,
    nextTokens: sent + step.output,
    toolsKey: step.toolsKey,
    misses: meter.misses + (isMiss ? 1 : 0),
    missTokens: meter.missTokens + (isMiss ? step.write : 0),
    lastCauses: isMiss ? guessCauses(meter, step) : meter.lastCauses,
    expectRebuild: false,
    keeps: 0,
  }
}

// The TTL of the latest cache write the transcript records.
export function ttlFromTranscript(text: string): CacheTtl | null {
  let ttl: CacheTtl | null = null
  for (const match of text.matchAll(/"ephemeral_(5m|1h)_input_tokens":(\d+)/g)) {
    if (Number(match[2]) > 0) {
      ttl = match[1] as CacheTtl
    }
  }

  return ttl
}

export function fmtTokens(n: number): string {
  if (n < 1000) {
    return String(n)
  }
  const [value, unit] = n < 1_000_000 ? [n / 1000, 'k'] : [n / 1_000_000, 'M']

  return `${value.toFixed(1).replace(/\.0$/, '')}${unit}`
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) {
    return `${s}s`
  }
  const m = Math.floor(s / 60)
  if (m < 60) {
    return `${m}m`
  }

  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export function fmtClock(ms: number): string {
  const date = new Date(ms)

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// 'dim' is normal, 'warn' needs attention (yellow), 'hot' is the cold cache (red).
export type Segment = { text: string; tone: 'dim' | 'warn' | 'hot' }

export function segments(meter: CacheMeter, now: number, maxKeeps = 0): Segment[] {
  if (meter.readTokens + meter.writeTokens === 0) {
    return [{ text: '—', tone: 'dim' }]
  }
  const parts: Segment[] = []
  if (meter.ttl === null) {
    parts.push({ text: 'warm', tone: 'dim' })
  } else {
    const expires = meter.lastAt + TTL_MS[meter.ttl]
    const left = expires - now
    parts.push(
      left > 0
        ? {
            text: `warm ${meter.ttl} [${fmtClock(expires)}] ${fmtDuration(left)} left`,
            tone: left < WARN_MS[meter.ttl] ? 'warn' : 'dim',
          }
        : { text: `cold, next +${fmtTokens(meter.nextTokens)}`, tone: 'hot' },
    )
  }
  if (meter.keeps > 0) {
    parts.push({ text: `kept ${meter.keeps}/${maxKeeps}`, tone: 'dim' })
  }
  parts.push({ text: `hit ${Math.round((meter.readTokens / meter.inputTokens) * 100)}%`, tone: 'dim' })
  if (meter.misses > 0) {
    const [first, ...rest] = meter.lastCauses
    const cause = rest.length > 0 ? `${first} +${rest.length}` : first
    parts.push({ text: `miss ${meter.misses} +${fmtTokens(meter.missTokens)} (${cause})`, tone: 'warn' })
  }

  return parts
}
