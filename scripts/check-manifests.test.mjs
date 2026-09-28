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

test('reports front matter that is not valid YAML', () => {
  const errors = run(tree({ [skillFile]: skill('name: do-thing\ndescription: Use when: a thing needs doing') }))
  assert.equal(errors.length, 1)
  assert.match(errors[0], /^plugins\/demo\/skills\/do-thing\/SKILL\.md front matter is not valid YAML: /)
})

test('reads quoted front matter values without their quotes', () => {
  assert.deepEqual(run(tree({ [skillFile]: skill('name: "do-thing"\ndescription: \'Use when a thing needs doing\'') })), [])
})

test('reports a name that YAML reads as something other than a string', () => {
  const numbered = 'plugins/demo/skills/2048/SKILL.md'
  const manifest = JSON.stringify({ name: 'jcouball-demo', version: '0.1.0', description, skills: ['./skills/2048'] })
  const files = (name) => {
    const all = tree({ 'plugins/demo/.claude-plugin/plugin.json': manifest, [numbered]: skill(`name: ${name}\ndescription: Use when`) })
    delete all[skillFile]
    return all
  }
  assert.deepEqual(run(files('2048')), [`${numbered} frontmatter name is not a string; quote it`])
  assert.deepEqual(run(files('"2048"')), [])
})

test('reports a description that YAML reads as something other than a string', () => {
  for (const value of ['2048', '[a, b]']) {
    assert.deepEqual(run(tree({ [skillFile]: skill(`name: do-thing\ndescription: ${value}`) })), [
      `${skillFile} frontmatter description is not a string; quote it`,
    ])
  }
})

test('reports a description that is empty once parsed', () => {
  assert.deepEqual(run(tree({ [skillFile]: skill('name: do-thing\ndescription: ""') })), [
    `${skillFile} frontmatter has no description`,
  ])
})

test('reports a plugin.json with no description once, not also as a mismatch', () => {
  const manifestPath = 'plugins/demo/.claude-plugin/plugin.json'
  for (const missing of [{}, { description: '' }]) {
    const manifest = JSON.stringify({ name: 'jcouball-demo', version: '0.1.0', skills: ['./skills/do-thing'], ...missing })
    assert.deepEqual(run(tree({ [manifestPath]: manifest })), [`${manifestPath} has no description`])
  }
})

test('reports a marketplace entry that is not an object instead of throwing', () => {
  const entries = [null, 'jcouball-demo', ['jcouball-demo'], { name: 'jcouball-demo', source: './plugins/demo', description }]
  assert.deepEqual(run(tree({ '.claude-plugin/marketplace.json': JSON.stringify({ plugins: entries }) })), [
    'marketplace plugin at index 0 is not an object',
    'marketplace plugin at index 1 is not an object',
    'marketplace plugin at index 2 is not an object',
  ])
})

test('reports a marketplace description that is not a string', () => {
  const marketplace = JSON.stringify({ plugins: [{ name: 'jcouball-demo', source: './plugins/demo', description: 42 }] })
  assert.deepEqual(run(tree({ '.claude-plugin/marketplace.json': marketplace })), [
    'marketplace lists jcouball-demo with a description that is not a string',
  ])
})

test('reports descriptions that are not strings even when they match', () => {
  const manifestPath = 'plugins/demo/.claude-plugin/plugin.json'
  const errors = run(
    tree({
      '.claude-plugin/marketplace.json': JSON.stringify({
        plugins: [{ name: 'jcouball-demo', source: './plugins/demo', description: 42 }],
      }),
      [manifestPath]: JSON.stringify({
        name: 'jcouball-demo',
        version: '0.1.0',
        description: 42,
        skills: ['./skills/do-thing'],
      }),
    }),
  )
  assert.deepEqual(errors, [
    'marketplace lists jcouball-demo with a description that is not a string',
    `${manifestPath} has a description that is not a string`,
  ])
})
