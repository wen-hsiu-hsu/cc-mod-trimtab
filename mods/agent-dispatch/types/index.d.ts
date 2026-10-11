export type WatchedAgent = {
  id: string
  description: string
  type: string
  model?: string
  startedAt: number
  // 'running' while it works; 'killed' or 'failed' once it stopped without finishing.
  status: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-dispatch': { running: WatchedAgent[]; stopped: WatchedAgent[]; now: number }
  }
}
