// Tests for check-manifests.mjs. Each builds a small marketplace with one
// plugin and one skill, breaks one thing about it, and checks the report.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { checkManifests } from './lib/check-manifests.mjs'

const description = 'Does one thing'
const skill = (frontmatter) => `---\n${frontmatter}\n---\n\n# Skill\n`

// A marketplace that passes, with any file replaced through overrides.
const tree = (overrides = {}) => ({
  '.claude-plugin/marketplace.json': JSON.stringify({
    plugins: [{ name: 'jcouball-demo', source: './plugins/demo', description }],
  }),
  'plugins/demo/.claude-plugin/plugin.json': JSON.stringify({
    name: 'jcouball-demo',
    version: '0.1.0',
    description,
    skills: ['./skills/do-thing'],
  }),
  '.release-please/demo-config.json': JSON.stringify({ packages: { 'plugins/demo': {} } }),
  '.release-please/demo-manifest.json': JSON.stringify({ 'plugins/demo': '0.1.0' }),
  'plugins/demo/skills/do-thing/SKILL.md': skill('name: do-thing\ndescription: Use when a thing needs doing'),
  ...overrides,
})

const run = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'check-manifests-'))
  try {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), content)
    }
    return checkManifests(root).errors
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const skillFile = 'plugins/demo/skills/do-thing/SKILL.md'

test('passes a marketplace whose files agree', () => {
  assert.deepEqual(run(tree()), [])
})

test('reads front matter with CRLF line endings', () => {
  const crlf = skill('name: do-thing\ndescription: Use when a thing needs doing').replace(/\n/g, '\r\n')
  assert.deepEqual(run(tree({ [skillFile]: crlf })), [])
})

test('reports a skill with no description', () => {
  assert.deepEqual(run(tree({ [skillFile]: skill('name: do-thing') })), [`${skillFile} frontmatter has no description`])
})

test('reports a skill whose name does not match its directory', () => {
  assert.deepEqual(run(tree({ [skillFile]: skill('name: other\ndescription: Use when') })), [
    `${skillFile} frontmatter name is "other", expected "do-thing" to match its directory`,
  ])
})

test('reports a skill with no front matter', () => {
  assert.deepEqual(run(tree({ [skillFile]: '# Skill\n' })), [`${skillFile} has no frontmatter block`])
})

test('reports a marketplace description that differs from plugin.json', () => {
  const marketplace = JSON.stringify({
    plugins: [{ name: 'jcouball-demo', source: './plugins/demo', description: 'Does two things' }],
  })
  const errors = run(tree({ '.claude-plugin/marketplace.json': marketplace }))
  assert.equal(errors.length, 1)
  assert.match(errors[0], /^description mismatch for jcouball-demo at character 5:/)
})
