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
// duration), how many rows are listed, the spawn opened in place ('' for none), and the period's
// last day (`YYYY-MM-DD`, '' for today). A view saved before the last four existed lacks them.
export type StatsView = { days: number; by: string; item: string; sort: string; limit: number; spawn: string; end: string }

declare module 'claude-code' {
  interface PluginState {
    'subagent-dispatch': { running: WatchedAgent[]; stopped: WatchedAgent[]; view: StatsView }
  }
}
