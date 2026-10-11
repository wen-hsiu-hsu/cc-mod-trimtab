export type CacheTtl = '5m' | '1h'

// Prompt cache figures of the main thread, summed over its requests.
export type CacheMeter = {
  sessionId: string
  requests: number
  // Every input token sent: uncached, cache-written and cache-read together.
  inputTokens: number
  readTokens: number
  writeTokens: number
  // When the latest response arrived; the cache entry lives `ttl` from then.
  lastAt: number
  lastModel: string
  // Input tokens of the latest request: what the next one should read from cache.
  lastInput: number
  // Input + output of the latest request: what a cold cache re-writes next.
  nextTokens: number
  toolsKey: string
  // Read off the transcript; null until a cache write shows which one is used.
  ttl: CacheTtl | null
  ttlCheckedAt: number
  misses: number
  missTokens: number
  // Guessed causes of the latest miss, most likely first.
  lastCauses: string[]
  // Set by a compaction: its rebuild is expected, not a miss.
  expectRebuild: boolean
  // Forks sent to keep the cache warm since the latest request of the main thread.
  keeps: number
}

// Why a handoff runs: `/session-keeper handoff`, the new-task gate, or a cold cache under a large context.
export type HandoffKind = 'manual' | 'new-task' | 'away'

// An offer to hand off, drawn above the prompt with its two buttons.
export type Offer = {
  kind: 'new-task' | 'away'
  // The prompt the offer is about: held back from the session when `isHeld`, else already sent.
  prompt: string
  isHeld: boolean
  context: number
  at: number
}

// A handoff under way; prompts typed meanwhile are held and go into the new session's draft.
export type Handing = { kind: HandoffKind; startedAt: number; held: string[] }

// A handoff summary written by the last keep, while the cache was still warm. Valid while the
// main thread has made no request since (`lastAt` still the meter's).
export type AwaySummary = { sessionId: string; lastAt: number; text: string }

// After the person kept working here, no new-task offer until the context passes `tokens`.
export type GateQuiet = { sessionId: string; tokens: number }

declare module 'claude-code' {
  interface PluginState {
    'session-keeper': {
      meter: CacheMeter
      now: number
      offer: Offer | null
      handing: Handing | null
      away: AwaySummary | null
      quiet: GateQuiet
      // When each feature switched on by `/session-keeper on` goes back.
      onUntil: Record<string, number>
    }
  }
}
