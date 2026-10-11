export type WatchedAgent = {
  id: string
  description: string
  type: string
  model?: string
  startedAt: number
  // 'running' while it works; 'killed' or 'failed' once it stopped without finishing.
  status: string
}

// What the stats pane shows: the period in days, the grouping (repo, session, model or type)
// and the key of the row opened to its spawns ('' for none).
export type StatsView = { days: number; by: string; item: string }

declare module 'claude-code' {
  interface PluginState {
    'agent-dispatch': { running: WatchedAgent[]; stopped: WatchedAgent[]; view: StatsView }
  }
}
