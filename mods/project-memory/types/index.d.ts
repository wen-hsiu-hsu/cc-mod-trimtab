// Changes of the latest distills, carried by the next prompt the person sends.
export type PendingChanges = { changes: string[]; dir: string }

declare module 'claude-code' {
  interface PluginState {
    'project-memory': {
      pending: PendingChanges | null
      promoted: boolean
      // When each feature switched on by `/project-memory on` goes back.
      onUntil: Record<string, number>
      now: number
    }
  }
}
