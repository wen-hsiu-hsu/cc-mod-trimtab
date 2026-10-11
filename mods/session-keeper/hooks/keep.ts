import type { CacheMeter } from '../types'
import { TTL_MS } from './meter'

// Below this much context a cold cache is cheap to re-write, so it is not kept.
export const MIN_KEEP_TOKENS = 30_000
// Sent to the model only, so always English.
export const KEEP_PROMPT = 'Reply with OK only'

export type KeepConfig = { isOn: boolean; idleMs: number; maxKeeps: number }

// Reads the manifest's options, clamped: past 59 minutes a 1h cache has already lapsed.
export function keepConfig(options: Record<string, unknown>): KeepConfig {
  const num = (value: unknown, fallback: number, min: number, max: number) => {
    const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback

    return Math.min(max, Math.max(min, n))
  }

  return {
    isOn: options.keep_warm === true,
    idleMs: num(options.idle_minutes, 55, 5, 59) * 60_000,
    maxKeeps: num(options.max_keeps, 3, 1, 10),
  }
}

// When the next keep is due, or null when none will be sent this idle stretch.
export function keepDueAt(meter: CacheMeter, config: KeepConfig): number | null {
  if (!config.isOn || meter.requests === 0 || meter.keeps >= config.maxKeeps) {
    return null
  }

  return meter.lastAt + config.idleMs
}

// Why a due keep is not sent; undefined when it should be.
export function skipReason(meter: CacheMeter, sessionId: string, now: number, config: KeepConfig): string | undefined {
  if (meter.sessionId !== sessionId) {
    return 'another conversation'
  }
  if (meter.ttl !== '1h') {
    return `ttl ${meter.ttl ?? 'unknown'}`
  }
  if (meter.lastInput < MIN_KEEP_TOKENS) {
    return `context ${meter.lastInput} < ${MIN_KEEP_TOKENS}`
  }
  if (meter.keeps >= config.maxKeeps) {
    return `${meter.keeps}/${config.maxKeeps} used`
  }
  if (now - meter.lastAt >= TTL_MS['1h']) {
    return 'already cold'
  }

  return undefined
}
