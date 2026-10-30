// Tests for probe-github-rendering.mjs, which exports nothing: it runs when
// node loads it, so a test spawns it. A fake gh answers from the same exports
// the probe compares against (see fake-gh.mjs), so these check the comparison
// and the reporting, not GitHub's rendering.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fakeTools } from './fake-executable.mjs'
import { anchorCases, headingCases } from './check-links.cases.mjs'
import { keptElements, keptSchemes } from './lib/check-links.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'probe-github-rendering.mjs')
const quoted = (text) => `'${text.replace(/'/g, `'\\''`)}'`

// Run the probe with a gh that answers as GitHub would, changed by `github`.
const probe = (github = {}, tools = {}) => {
  const gh = `exec ${quoted(process.execPath)} ${quoted(join(here, 'fake-gh.mjs'))}`
  const { dir, env } = fakeTools({ gh, ...tools })
  try {
    return spawnSync(process.execPath, [script], { env: { ...env, FAKE_GH: JSON.stringify(github) }, encoding: 'utf8' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const disagreement = (result) => {
  assert.equal(result.status, 1)
  const [heading, ...problems] = result.stderr.trimEnd().split('\n')
  assert.equal(heading, 'GitHub renders differently from what the link check assumes:')
  return problems.map((problem) => problem.trim())
}

test('probe-github-rendering reports agreement', () => {
  const result = probe()
  assert.equal(result.status, 0)
  assert.match(result.stdout, /^GitHub agrees: \d+ anchor case\(s\), \d+ element\(s\), \d+ scheme\(s\)\n$/)
  assert.equal(result.stderr, '')
})

test('probe-github-rendering reports an anchor case GitHub renders differently', () => {
  const [name, , expected] = anchorCases.find(([, , anchors]) => anchors.length > 0)
  const problems = disagreement(probe({ cases: { [name]: [...expected, 'extra'] } }))
  assert.deepEqual(problems, [
    `case ${name}: GitHub renders ${JSON.stringify(['top', ...expected, 'extra'])}, the case expects ${JSON.stringify(['top', ...expected])}`,
  ])
})

test('probe-github-rendering reports a heading case GitHub renders differently', () => {
  const [name, , [slug]] = headingCases[0]
  const problems = disagreement(probe({ cases: { [name]: [] } }))
  assert.deepEqual(problems, [`case ${name}: GitHub renders ["top"], the case expects ${JSON.stringify(['top', slug])}`])
})

test('probe-github-rendering reports an element GitHub keeps that keptElements lacks', () => {
  const problems = disagreement(probe({ elements: [...keptElements, 'abbr'] }))
  assert.deepEqual(problems, ['element <abbr>: GitHub keeps it, keptElements lacks it'])
})

test('probe-github-rendering reports an element GitHub removes that keptElements has', () => {
  const problems = disagreement(probe({ elements: [...keptElements].filter((element) => element !== 'div') }))
  assert.deepEqual(problems, ['element <div>: GitHub removes it, keptElements has it'])
})

test('probe-github-rendering reports a scheme GitHub keeps that keptSchemes lacks', () => {
  const problems = disagreement(probe({ schemes: [...keptSchemes, 'tel'] }))
  assert.deepEqual(problems, ['scheme tel: GitHub keeps it, keptSchemes lacks it'])
})

test('probe-github-rendering reports a scheme GitHub removes that keptSchemes has', () => {
  const problems = disagreement(probe({ schemes: [...keptSchemes].filter((scheme) => scheme !== 'mailto') }))
  assert.deepEqual(problems, ['scheme mailto: GitHub removes it, keptSchemes has it'])
})

test('probe-github-rendering exits 2 with gh\'s error when gh fails', () => {
  const result = probe({}, { gh: 'echo "gh: not logged in" >&2\nexit 1' })
  assert.equal(result.status, 2, result.stderr)
  assert.equal(result.stderr, 'probe failed: gh: not logged in\n')
})

test('probe-github-rendering exits 2 when gh is not installed', () => {
  const { dir } = fakeTools({})
  try {
    const result = spawnSync(process.execPath, [script], { env: { ...process.env, PATH: dir }, encoding: 'utf8' })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /^probe failed: .*gh/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
