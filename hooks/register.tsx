import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GhLink, GhState } from '../types'

const PANE = 'gh-links'
const TITLE = 'GitHub'
const links = atom({ plugin: 'gh-links', key: 'links' } as const, [], { shape: 'links-1' })
const URL_RE = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/(\d+)/g

export const extract = (text: string): GhLink[] =>
  [...text.matchAll(URL_RE)].map(([, repo, kind, num]) => ({
    url: `https://github.com/${repo}/${kind}/${num}`,
    repo: repo!,
    kind: kind as GhLink['kind'],
    num: Number(num),
  }))

type Node = { state?: string; isDraft?: boolean } | null

export const toState = (n: Node): GhState | undefined => {
  if (!n?.state) return undefined
  if (n.state === 'OPEN') return n.isDraft === undefined ? 'open' : n.isDraft ? 'draft' : 'ready'
  return n.state === 'MERGED' ? 'merged' : 'closed'
}

// ponytail: one GraphQL call for all non-merged links per turn, at most 100 by the list cap
async function refresh($: EngineInterface) {
  const todo = (await read($, links)).filter(l => l.state !== 'merged')
  if (todo.length === 0) return

  const fields = todo
    .map((l, i) => `r${i}: resource(url: ${JSON.stringify(l.url)}) { ... on PullRequest { state isDraft } ... on Issue { state } }`)
    .join(' ')
  const { exitCode, stdout } = await $.process.run(['gh', 'api', 'graphql', '-f', `query={ ${fields} }`])
  const data: Record<string, Node> | undefined = JSON.parse(stdout || '{}').data
  if (exitCode !== 0 && !data) return

  const states = new Map(todo.map((l, i) => [l.url, toState(data?.[`r${i}`] ?? null)]))
  await update($, links, list => list.map(l => (states.get(l.url) ? { ...l, state: states.get(l.url) } : l)))
}

const refreshQuietly = ($: EngineInterface) => refresh($).catch(err => $.ui.log(`gh-links: ${err}`))

async function collect($: EngineInterface, result: unknown) {
  const found = extract(JSON.stringify(result).replaceAll('\\/', '/'))
  if (found.length === 0) return

  const known = new Set((await read($, links)).map(l => l.url))
  const fresh = found.filter(l => !known.has(l.url) && known.add(l.url))
  if (fresh.length === 0) return

  await update($, links, list => [...fresh.reverse(), ...list].slice(0, 100))
  void $.ui.open({ id: PANE, title: TITLE })
  void refreshQuietly($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'gh-links', description: 'Show GitHub PRs and issues of this session' })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    void refreshQuietly($)
    return done
  })

  on('command.run', { command: 'gh-links' }, async $ => {
    void refreshQuietly($)
    await $.ui.open({ id: PANE, title: TITLE })
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
    const list = await read($, links)

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No PRs or issues yet.</Text>}
        {list.map(l => (
          <Text>
            {l.kind === 'pull' ? 'PR    ' : 'Issue '}
            <Link href={l.url} label={`${l.repo.split('/')[1]}#${l.num}`} />
            {l.state && <Text color={color[l.state]}> {l.state}</Text>}
          </Text>
        ))}
      </Box>
    )
  })
}
