export type GhState = 'draft' | 'ready' | 'open' | 'merged' | 'closed'
export type GhCi = 'pass' | 'fail' | 'pending'
export type GhReview = 'approved' | 'changes' | 'review'
export type GhLink = { url: string; repo: string; kind: 'pull' | 'issues'; num: number; state?: GhState; ci?: GhCi; review?: GhReview }

declare module 'claude-code' {
  interface PluginState {
    'gh-links': { links: Shaped<GhLink[]> }
  }
}
