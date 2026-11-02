import { expect, test } from 'claude-code/testing'

import { extract, toState } from './register'

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

test('the pane shows the state gh reports', async ($, on) => {
  on('command.register', () => ({ value: { command: 'gh-links' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: { stdout: 'https://github.com/o/repo/pull/5\n' } }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '{"data":{"r0":{"state":"OPEN","isDraft":true}}}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --draft' })
  await $.command.run({ command: 'gh-links', args: '' })
  await new Promise(r => setTimeout(r, 50))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /draft/ }))?.text).toBe('PR    repo#5 draft')
  await ui.unmount()
})
