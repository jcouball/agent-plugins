// Tests for probe-github-rendering.mjs as a program. What it does is tested in
// probe-github-rendering.test.mjs, which calls probeGithubRendering() in the
// test's own process. These start the script, for what only a running program
// has: the gh it runs, the request it writes to it, and its exit status. A fake
// gh answers from the same exports the probe compares against (see
// fake-markdown.mjs), so these check the wiring, not GitHub's rendering.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fakeTools } from './fake-executable.mjs'
import { keptElements } from './lib/check-links.mjs'

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

test('probe-github-rendering exits 1 and prints each disagreement when GitHub renders differently', () => {
  const problems = disagreement(probe({ elements: [...keptElements, 'abbr'] }))
  assert.deepEqual(problems, ['element <abbr>: GitHub keeps it, keptElements lacks it'])
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
