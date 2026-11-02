import { expect, mock, test } from 'claude-code/testing'

import { extract, toCi, toReview, toState } from './register'

const PANE = {
  plugin: 'gh-links',
  component: 'Pane',
  requestId: 'gh-links',
  props: { title: 'GitHub', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

test('extract finds PR and issue URLs', () => {
  const got = extract('see https://github.com/Euro-Office/web-apps/pull/282 and https://github.com/a/b/issues/7#x')
  expect(got.map(l => l.url)).toEqual([
    'https://github.com/Euro-Office/web-apps/pull/282',
    'https://github.com/a/b/issues/7',
  ])
})

test('links from tool output show once in the pane', async ($, on) => {
  on('command.register', () => ({ value: { command: 'gh-links' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: { stdout: 'https://github.com/o/repo/pull/5\n' } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'gh pr create' })
  await $.tool.call({ tool: 'Bash', command: 'gh pr view' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = await ui.findAll({ type: 'Link' })
  expect(rows.length).toBe(1)
  expect(rows[0]?.text).toBe('repo#5')
  await ui.unmount()
})

test('toState maps GitHub states', () => {
  expect(toState({ state: 'OPEN', isDraft: true })).toBe('draft')
  expect(toState({ state: 'OPEN', isDraft: false })).toBe('ready')
  expect(toState({ state: 'OPEN' })).toBe('open')
  expect(toState({ state: 'MERGED', isDraft: false })).toBe('merged')
  expect(toState({ state: 'CLOSED' })).toBe('closed')
  expect(toState(null)).toBe(undefined)
})

test('toReview maps the review decision', () => {
  expect(toReview({ reviewDecision: 'APPROVED' })).toBe('approved')
  expect(toReview({ reviewDecision: 'CHANGES_REQUESTED' })).toBe('changes')
  expect(toReview({ reviewDecision: 'REVIEW_REQUIRED' })).toBe('review')
  expect(toReview({ reviewDecision: null })).toBe(undefined)
  expect(toReview({ state: 'OPEN' })).toBe(undefined)
})

test('toCi maps the check rollup', () => {
  const rollup = (state: string) => ({ commits: { nodes: [{ commit: { statusCheckRollup: { state } } }] } })
  expect(toCi(rollup('SUCCESS'))).toBe('pass')
  expect(toCi(rollup('FAILURE'))).toBe('fail')
  expect(toCi(rollup('ERROR'))).toBe('fail')
  expect(toCi(rollup('PENDING'))).toBe('pending')
  expect(toCi({ state: 'OPEN', commits: { nodes: [{ commit: { statusCheckRollup: null } }] } })).toBe(undefined)
})

test('state and CI are polled every 5 minutes', async ($, on) => {
  const clock = mock.clock(on)
  const answers = ['PENDING', 'SUCCESS']
  let calls = 0
  on('command.register', () => ({ value: { command: 'gh-links' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: { stdout: 'https://github.com/o/repo/pull/5\n' } }))
  on('process.run', () => {
    const state = answers[Math.min(calls++, 1)]
    const r0 = { state: 'OPEN', isDraft: false, reviewDecision: 'APPROVED', commits: { nodes: [{ commit: { statusCheckRollup: { state } } }] } }
    return { value: { exitCode: 0, stdout: JSON.stringify({ data: { r0 } }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'gh pr create' })
  await clock.settle()
  expect(calls).toBe(1)

  await clock.advance(4 * 60_000)
  expect(calls).toBe(1)
  await clock.advance(60_000)
  expect(calls).toBe(2)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /repo#5/ }))?.text).toBe('● repo#5 ready approved ✓')
  await ui.unmount()
})

test('the pane shows the state gh reports', async ($, on) => {
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'gh-links' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: { stdout: 'https://github.com/o/repo/pull/5\n' } }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '{"data":{"r0":{"state":"OPEN","isDraft":true}}}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --draft' })
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /draft/ }))?.text).toBe('● repo#5 draft')
  await ui.unmount()
})
