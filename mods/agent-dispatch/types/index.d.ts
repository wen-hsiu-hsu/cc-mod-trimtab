export type WatchedAgent = {
  id: string
  description: string
  type: string
  model?: string
  startedAt: number
  // 'running' while it works; 'killed' or 'failed' once it stopped without finishing.
  status: string
}

// What the stats pane shows: the period in days, the grouping (repo, session, model or type),
// the key of the row opened to its spawns ('' for none), their order (tokens, time or
// duration), how many are listed, and the spawn opened in place ('' for none). A view saved
// before the last three existed lacks them.
export type StatsView = { days: number; by: string; item: string; sort: string; limit: number; spawn: string }

declare module 'claude-code' {
  interface PluginState {
    'agent-dispatch': { running: WatchedAgent[]; stopped: WatchedAgent[]; view: StatsView }
  }
}
