export type ItemKind = 'decision' | 'question' | 'deferred' | 'bug'

// 'done' = resolved, 'dropped' = will not be done (not counted as resolved).
export type Outcome = 'done' | 'dropped'

export type OpenItem = {
  id: string
  // Stable across sessions (ids are renumbered on load); what stored lists are merged by.
  uid: string
  kind: ItemKind
  text: string
  // 'model' = the track tool, 'auto' = parsed from a partly chosen option list.
  source: 'model' | 'auto'
  isDone: boolean
  createdAt: number
  doneAt?: number
  outcome?: Outcome
  // Why it was dropped, or for a decision what was decided and why.
  note?: string
  // The branch and commit the session was on when the item was added.
  branch?: string
  head?: string
}

// A resolved item in the store: kept so a session that still has it open cannot bring it back.
export type Tombstone = { uid: string; doneAt: number }

// The store's value per repo: the open items and the tombstones of resolved ones.
export type Stored = { items: OpenItem[]; done: Tombstone[] }

// One entry of the repo's resolution log: a decision resolved with a note, or a dropped item.
// Kept without expiry so a later session can look up why something was decided or dropped.
export type LogEntry = {
  uid: string
  kind: ItemKind
  text: string
  outcome: Outcome
  note: string
  at: number
  branch?: string
}

export type OptionRef = { label: string; text: string }

// Answers that ended with a question, and how many of those turns called no `track`.
export type MissStats = { questions: number; missed: number }

declare module 'claude-code' {
  interface PluginState {
    // loadedFor: the session id whose stored items were last brought in.
    // announce: stored items were brought in and the model has not been told yet.
    // autoDeferred: uids of the items the latest prompt deferred, undoable until the next prompt.
    // panelResolved: uids resolved or dropped in the pane since the last prompt, told to the model with the next.
    // tracked: the main loop called `track` since its last answer.
    'open-items': {
      items: OpenItem[]
      options: OptionRef[]
      loadedFor: string
      announce: boolean
      autoDeferred: string[]
      panelResolved: string[]
      tracked: boolean
    }
  }
}
