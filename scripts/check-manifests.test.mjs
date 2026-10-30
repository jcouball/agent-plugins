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

const manifestPath = 'plugins/demo/.claude-plugin/plugin.json'
const pluginJson = (fields) =>
  JSON.stringify({ name: 'jcouball-demo', version: '0.1.0', description, skills: ['./skills/do-thing'], ...fields })

test('reports a file that is not valid JSON', () => {
  const errors = run(tree({ '.claude-plugin/marketplace.json': '{' }))
  assert.match(errors[0], /^\.claude-plugin\/marketplace\.json is not valid JSON: /)
})

test('reports missing files', () => {
  const files = tree()
  delete files['.claude-plugin/marketplace.json']
  delete files['.release-please/demo-config.json']
  delete files['.release-please/demo-manifest.json']
  assert.deepEqual(run(files), [
    'missing file: .claude-plugin/marketplace.json',
    'jcouball-demo is not listed in the marketplace manifest',
    'missing file: .release-please/demo-config.json',
    'missing file: .release-please/demo-manifest.json',
  ])
})

test('reports a tree with no plugins', () => {
  assert.deepEqual(run({ '.claude-plugin/marketplace.json': JSON.stringify({ plugins: [] }) }), [
    'no plugins found under plugins/',
  ])
})

test('reports a marketplace plugins key that is not an array', () => {
  const errors = run(tree({ '.claude-plugin/marketplace.json': JSON.stringify({ plugins: {} }) }))
  assert.equal(errors[0], '.claude-plugin/marketplace.json has a plugins key that is not an array')
})

test('reports a marketplace entry whose name or source is not a string', () => {
  const entries = [{ source: './plugins/demo' }, { name: 'jcouball-demo', source: 7 }]
  assert.deepEqual(run(tree({ '.claude-plugin/marketplace.json': JSON.stringify({ plugins: entries }) })).slice(0, 2), [
    'marketplace plugin at index 0 has no name, or its name is not a string',
    'marketplace lists jcouball-demo with a source that is not a string',
  ])
})

test('reports a plugin listed twice', () => {
  const entry = { name: 'jcouball-demo', source: './plugins/demo', description }
  const errors = run(tree({ '.claude-plugin/marketplace.json': JSON.stringify({ plugins: [entry, entry] }) }))
  assert.deepEqual(errors, ['marketplace lists jcouball-demo more than once'])
})

test('reports a marketplace source that does not exist or points at the wrong directory', () => {
  const entry = { name: 'jcouball-demo', source: './plugins/gone', description }
  const errors = run(tree({ '.claude-plugin/marketplace.json': JSON.stringify({ plugins: [entry] }) }))
  assert.deepEqual(errors, [
    'marketplace lists jcouball-demo with a source that does not exist: ./plugins/gone',
    'marketplace source for jcouball-demo is ./plugins/gone, expected ./plugins/demo',
  ])
})

test('reports a marketplace entry with no description against a plugin.json that has one', () => {
  const entry = { name: 'jcouball-demo', source: './plugins/demo' }
  const errors = run(tree({ '.claude-plugin/marketplace.json': JSON.stringify({ plugins: [entry] }) }))
  assert.equal(errors.length, 1)
  assert.match(errors[0], /^description mismatch for jcouball-demo at character 0:/)
})

test('reports a plugin.json with no name, and skips the rest of its checks', () => {
  const errors = run(tree({ [manifestPath]: JSON.stringify({ version: '0.1.0' }) }))
  assert.deepEqual(errors, [
    `${manifestPath} has no name`,
    'marketplace lists jcouball-demo, but no plugin under plugins/ declares that name',
  ])
})

test('reports a plugin.json with no version', () => {
  const errors = run(tree({ [manifestPath]: pluginJson({ version: undefined }) }))
  assert.equal(errors[0], `${manifestPath} has no version`)
})

test('reports a plugin missing from the marketplace', () => {
  const marketplace = JSON.stringify({ plugins: [{ name: 'other', source: './plugins/demo', description }] })
  assert.deepEqual(run(tree({ '.claude-plugin/marketplace.json': marketplace })), [
    'jcouball-demo is not listed in the marketplace manifest',
    'marketplace lists other, but no plugin under plugins/ declares that name',
  ])
})

test('reports a release-please config that does not declare the plugin, or declares others', () => {
  const config = (packages) => ({ '.release-please/demo-config.json': JSON.stringify(packages) })
  assert.deepEqual(run(tree(config({}))), [
    '.release-please/demo-config.json does not declare plugins/demo under packages',
  ])
  assert.deepEqual(run(tree(config({ packages: { 'plugins/demo': {}, 'plugins/other': {} } }))), [
    '.release-please/demo-config.json declares packages beyond plugins/demo: plugins/other',
  ])
})

test('reports a plugin the release-please manifest does not track, or tracks at another version', () => {
  const versions = (content) => ({ '.release-please/demo-manifest.json': JSON.stringify(content) })
  assert.deepEqual(run(tree(versions({}))), ['plugins/demo is not tracked in .release-please/demo-manifest.json'])
  assert.deepEqual(run(tree(versions({ 'plugins/demo': '0.2.0' }))), [
    'version mismatch for jcouball-demo: plugin.json says 0.1.0, .release-please/demo-manifest.json says 0.2.0',
  ])
})

test('reports a skills key that is not an array, and a skill entry that is not a string', () => {
  assert.deepEqual(run(tree({ [manifestPath]: pluginJson({ skills: 'x' }) })), [
    `${manifestPath} has a skills key that is not an array`,
    `skill on disk but not declared in ${manifestPath}: ./skills/do-thing`,
  ])
  assert.deepEqual(run(tree({ [manifestPath]: pluginJson({ skills: ['./skills/do-thing', 3] }) })), [
    `${manifestPath} declares a skill that is not a string: 3`,
  ])
})

test('accepts a plugin that declares no skills and has none on disk', () => {
  const files = tree({ [manifestPath]: pluginJson({ skills: undefined }) })
  delete files[skillFile]
  assert.deepEqual(run(files), [])
})

test('reports a declared skill with no SKILL.md, and a skill directory with none', () => {
  const files = tree({ [manifestPath]: pluginJson({ skills: ['./skills/do-thing', './skills/gone'] }) })
  files['plugins/demo/skills/empty/README.md'] = ''
  assert.deepEqual(run(files), [
    'declared skill has no SKILL.md: plugins/demo/skills/gone/SKILL.md',
    'skill directory has no SKILL.md: plugins/demo/skills/empty',
  ])
})

test('reports a skill on disk that plugin.json does not declare', () => {
  const errors = run(tree({ [manifestPath]: pluginJson({ skills: [] }) }))
  assert.deepEqual(errors, [`skill on disk but not declared in ${manifestPath}: ./skills/do-thing`])
})

test('reports front matter that is never closed as no front matter', () => {
  assert.deepEqual(run(tree({ [skillFile]: '---\nname: do-thing\n' })), [`${skillFile} has no frontmatter block`])
})

test('reports front matter that parses to nothing or to a scalar as missing its fields', () => {
  for (const body of ['', 'just text']) {
    assert.deepEqual(run(tree({ [skillFile]: skill(body) })), [
      `${skillFile} frontmatter has no name`,
      `${skillFile} frontmatter has no description`,
    ])
  }
})

test('reports a skill with an empty name', () => {
  const errors = run(tree({ [skillFile]: skill('name: ""\ndescription: Use when') }))
  assert.deepEqual(errors, [`${skillFile} frontmatter has no name`])
})

test('reports a command file that is not markdown, and ignores dotfiles', () => {
  const errors = run(tree({ 'plugins/demo/commands/run.txt': '', 'plugins/demo/commands/.DS_Store': '', 'plugins/demo/commands/ok.md': '' }))
  assert.deepEqual(errors, ['command file is not markdown: plugins/demo/commands/run.txt'])
})

test('reports a plugin.json that is missing, and skips the rest of its checks', () => {
  const files = tree()
  delete files[manifestPath]
  assert.deepEqual(run(files), [
    `missing file: ${manifestPath}`,
    'marketplace lists jcouball-demo, but no plugin under plugins/ declares that name',
  ])
})
