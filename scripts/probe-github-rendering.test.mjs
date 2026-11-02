// Tests for probeGithubRendering(), called in the test's own process. A fake
// render answers from the same exports the probe compares against (see
// fake-markdown.mjs), so these check the comparison and the reporting, not
// GitHub's rendering. The script, started as a process with a fake gh, is
// tested in probe-github-rendering.cli.test.mjs.

import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { anchorCases, headingCases } from './check-links.cases.mjs'
import { fakeMarkdown } from './fake-markdown.mjs'
import { keptElements, keptSchemes } from './lib/check-links.mjs'
import { probeGithubRendering } from './lib/probe-github-rendering.mjs'

// Run the probe with a render that answers as GitHub would, changed by `github`.
const probe = async (github = {}, render = fakeMarkdown(github)) => {
  const out = []
  const err = []
  const status = await probeGithubRendering({
    render: async (text) => render(text),
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
  })
  return { status, stdout: out.join(''), stderr: err.join('') }
}

const disagreement = (result) => {
  assert.equal(result.status, 1)
  const [heading, ...problems] = result.stderr.trimEnd().split('\n')
  assert.equal(heading, 'GitHub renders differently from what the link check assumes:')
  return problems.map((problem) => problem.trim())
}

test('probeGithubRendering reports agreement', async () => {
  const result = await probe()
  assert.equal(result.status, 0)
  assert.match(result.stdout, /^GitHub agrees: \d+ anchor case\(s\), \d+ element\(s\), \d+ scheme\(s\)\n$/)
  assert.equal(result.stderr, '')
})

test('probeGithubRendering reports an anchor case GitHub renders differently', async () => {
  const [name, , expected] = anchorCases.find(([, , anchors]) => anchors.length > 0)
  const problems = disagreement(await probe({ cases: { [name]: [...expected, 'extra'] } }))
  assert.deepEqual(problems, [
    `case ${name}: GitHub renders ${JSON.stringify(['top', ...expected, 'extra'])}, the case expects ${JSON.stringify(['top', ...expected])}`,
  ])
})

test('probeGithubRendering reports a heading case GitHub renders differently', async () => {
  const [name, , [slug]] = headingCases[0]
  const problems = disagreement(await probe({ cases: { [name]: [] } }))
  assert.deepEqual(problems, [`case ${name}: GitHub renders ["top"], the case expects ${JSON.stringify(['top', slug])}`])
})

test('probeGithubRendering reports an element GitHub keeps that keptElements lacks', async () => {
  const problems = disagreement(await probe({ elements: [...keptElements, 'abbr'] }))
  assert.deepEqual(problems, ['element <abbr>: GitHub keeps it, keptElements lacks it'])
})

test('probeGithubRendering reports an element GitHub removes that keptElements has', async () => {
  const problems = disagreement(await probe({ elements: [...keptElements].filter((element) => element !== 'div') }))
  assert.deepEqual(problems, ['element <div>: GitHub removes it, keptElements has it'])
})

test('probeGithubRendering reports a scheme GitHub keeps that keptSchemes lacks', async () => {
  const problems = disagreement(await probe({ schemes: [...keptSchemes, 'tel'] }))
  assert.deepEqual(problems, ['scheme tel: GitHub keeps it, keptSchemes lacks it'])
})

test('probeGithubRendering reports a scheme GitHub removes that keptSchemes has', async () => {
  const problems = disagreement(await probe({ schemes: [...keptSchemes].filter((scheme) => scheme !== 'mailto') }))
  assert.deepEqual(problems, ['scheme mailto: GitHub removes it, keptSchemes has it'])
})

test('probeGithubRendering exits 2 with the error gh printed when the render fails', async () => {
  const failure = Object.assign(new Error('Command failed: gh api markdown'), { stderr: 'gh: not logged in\n' })
  const result = await probe({}, () => {
    throw failure
  })
  assert.equal(result.status, 2)
  assert.equal(result.stderr, 'probe failed: gh: not logged in\n')
})

test('probeGithubRendering exits 2 with the error message when the render fails without gh stderr', async () => {
  const result = await probe({}, () => {
    throw new Error('spawn gh ENOENT')
  })
  assert.equal(result.status, 2)
  assert.equal(result.stderr, 'probe failed: spawn gh ENOENT\n')
})

test('probeGithubRendering asks for no front matter, and for a few renders at a time', async () => {
  assert.ok([...headingCases, ...anchorCases].some(([, markdown]) => markdown.startsWith('---')), 'a case with front matter')
  const asked = []
  let running = 0
  let most = 0
  const render = fakeMarkdown()
  const status = await probeGithubRendering({
    render: async (text) => {
      asked.push(text)
      running += 1
      most = Math.max(most, running)
      await new Promise((resolve) => setImmediate(resolve))
      running -= 1
      return render(text)
    },
    stdout: { write: () => {} },
    stderr: { write: () => {} },
  })
  assert.equal(status, 0)
  assert.ok(asked.length > 8)
  assert.equal(asked.filter((text) => text.startsWith('---')).length, 0)
  assert.equal(most, 8)
})

test('probeGithubRendering never calls process.exit', async () => {
  const exit = mock.method(process, 'exit', () => {
    throw new Error('process.exit was called')
  })
  try {
    assert.equal((await probe({ elements: [] })).status, 1)
    assert.equal((await probe({}, () => { throw new Error('no gh') })).status, 2)
    assert.equal(exit.mock.callCount(), 0)
  } finally {
    exit.mock.restore()
  }
})
