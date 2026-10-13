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
// `item`: the resolved item itself, kept while it is in the pane's last 7 days list.
export type Tombstone = { uid: string; doneAt: number; item?: OpenItem }

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

// Answers that ended with a question; how many of those turns called no `track`; and how many of
// those the person then answered at length, the ones that may have left something untracked.
export type MissStats = { questions: number; untracked: number; missed: number }

// A row closed or reopened in the pane while it is open: it stays in place until the list
// switches or the pane opens again. `was` and `note` are what reopening took off a resolved item,
// so pressing the same key again puts them back.
export type KeptRow = { id: string; was?: Outcome; note?: string }

// Which list the pane shows.
export type PaneView = 'open' | 'resolved'

export type PaneGroup = 'kind' | 'none' | 'branch'

export type PaneOrder = 'old' | 'new'

declare module 'claude-code' {
  interface PluginState {
    // loadedFor: the session id whose stored items were last brought in.
    // announce: stored items were brought in and the model has not been told yet.
    // autoDeferred: uids of the items the latest prompt deferred, undoable until the next prompt.
    // panelResolved: uids resolved or dropped in the pane since the last prompt, told to the model with the next.
    // tracked: the main loop called `track` since its last answer.
    // asked: the last line of the latest answer that ended with a question and no `track` call, until the next prompt.
    // view: the pane's list. focused: the key of the pane row the focus ring last landed on ('' for none).
    // kept: rows closed or reopened in the pane since it opened.
    // group, order: how the pane groups and sorts its list. unfolded: the deferred group is open.
    // branch: the branch the session was on when the pane opened ('' when unknown).
    'open-items': {
      items: OpenItem[]
      options: OptionRef[]
      loadedFor: string
      announce: boolean
      autoDeferred: string[]
      panelResolved: string[]
      tracked: boolean
      asked: string
      view: PaneView
      focused: string
      kept: KeptRow[]
      group: PaneGroup
      order: PaneOrder
      unfolded: boolean
      branch: string
    }
  }
}
