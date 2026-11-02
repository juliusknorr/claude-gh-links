export type GhState = 'draft' | 'ready' | 'open' | 'merged' | 'closed'
export type GhLink = { url: string; repo: string; kind: 'pull' | 'issues'; num: number; state?: GhState }

declare module 'claude-code' {
  interface PluginState {
    'gh-links': { links: Shaped<GhLink[]> }
  }
}
