import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GhCi, GhLink, GhReview, GhState } from '../types'

const PANE = 'gh-links'
const OPEN = { id: PANE, title: 'GitHub', columns: 30 }
const links = atom({ plugin: 'gh-links', key: 'links' } as const, [], { shape: 'links-1' })
const URL_RE = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/(\d+)/g

export const extract = (text: string): GhLink[] =>
  [...text.matchAll(URL_RE)].map(([, repo, kind, num]) => ({
    url: `https://github.com/${repo}/${kind}/${num}`,
    repo: repo!,
    kind: kind as GhLink['kind'],
    num: Number(num),
  }))

type Node = {
  state?: string
  isDraft?: boolean
  reviewDecision?: string | null
  commits?: { nodes?: { commit?: { statusCheckRollup?: { state?: string } | null } }[] }
} | null

export const toState = (n: Node): GhState | undefined => {
  if (!n?.state) return undefined
  if (n.state === 'OPEN') return n.isDraft === undefined ? 'open' : n.isDraft ? 'draft' : 'ready'
  return n.state === 'MERGED' ? 'merged' : 'closed'
}

export const toCi = (n: Node): GhCi | undefined => {
  const rollup = n?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state
  if (rollup === 'SUCCESS') return 'pass'
  if (rollup === 'FAILURE' || rollup === 'ERROR') return 'fail'
  return rollup ? 'pending' : undefined
}

export const toReview = (n: Node): GhReview | undefined =>
  ({ APPROVED: 'approved', CHANGES_REQUESTED: 'changes', REVIEW_REQUIRED: 'review' } as const)[n?.reviewDecision ?? ''] ?? undefined

const PR_FIELDS = 'state isDraft reviewDecision commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }'

// ponytail: one GraphQL call for all non-merged links per turn, at most 100 by the list cap
async function refresh($: EngineInterface) {
  const todo = (await read($, links)).filter(l => l.state !== 'merged')
  if (todo.length === 0) return

  const fields = todo
    .map((l, i) => `r${i}: resource(url: ${JSON.stringify(l.url)}) { ... on PullRequest { ${PR_FIELDS} } ... on Issue { state } }`)
    .join(' ')
  const { exitCode, stdout } = await $.process.run(['gh', 'api', 'graphql', '-f', `query={ ${fields} }`])
  const data: Record<string, Node> | undefined = JSON.parse(stdout || '{}').data
  if (exitCode !== 0 && !data) return

  const nodes = new Map(todo.map((l, i) => [l.url, data?.[`r${i}`] ?? null]))
  await update($, links, list =>
    list.map(l => {
      const n = nodes.get(l.url)
      return n?.state ? { ...l, state: toState(n), ci: toCi(n), review: toReview(n) } : l
    }),
  )
}

const refreshQuietly = ($: EngineInterface) => refresh($).catch(err => $.ui.log(`gh-links: ${err}`))

async function collect($: EngineInterface, result: unknown) {
  const found = extract(JSON.stringify(result).replaceAll('\\/', '/'))
  if (found.length === 0) return

  const known = new Set((await read($, links)).map(l => l.url))
  const fresh = found.filter(l => !known.has(l.url) && known.add(l.url))
  if (fresh.length === 0) return

  await update($, links, list => [...fresh.reverse(), ...list].slice(0, 100))
  void $.ui.open(OPEN)
  void refreshQuietly($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'gh-links', description: 'Show GitHub PRs and issues of this session' })
    $.clock.every(5 * 60_000, () => refreshQuietly($))
    void refreshQuietly($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    void refreshQuietly($)
    return done
  })

  on('command.run', { command: 'gh-links' }, async $ => {
    void refreshQuietly($)
    await $.ui.open(OPEN)
    return { text: 'GitHub links pane opened.' }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if ('result' in ran && ran.result !== undefined) {
      await collect($, ran.result).catch(err => $.ui.log(`gh-links: ${err}`))
    }
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Link } = $.ui.resolve(e)
    const color = { draft: 'gray', ready: 'green', open: 'green', merged: 'magenta', closed: 'red' } as const
    const review = { approved: 'green', changes: 'red', review: 'yellow' } as const
    const ci = { pass: ['✓', 'green'], fail: ['✗', 'red'], pending: ['…', 'yellow'] } as const
    const list = await read($, links)

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No PRs or issues yet.</Text>}
        {list.map(l => (
          <Text wrap="truncate-middle">
            <Text color={l.state ? color[l.state] : 'gray'}>{l.kind === 'pull' ? '● ' : '○ '}</Text>
            <Link href={l.url} label={`${l.repo.split('/')[1]}#${l.num}`} />
            {l.state && <Text dimColor> {l.state}</Text>}
            {l.review && l.state !== 'merged' && l.state !== 'closed' && <Text color={review[l.review]}> {l.review}</Text>}
            {l.ci && l.state !== 'merged' && <Text color={ci[l.ci][1]}> {ci[l.ci][0]}</Text>}
          </Text>
        ))}
      </Box>
    )
  })
}
