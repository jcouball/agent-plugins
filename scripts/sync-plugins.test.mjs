// Tests for syncPlugins(), called in the test's own process. A fixture
// repository whose origin is a local bare repository stands in for the
// marketplace, a temporary directory for the home that holds the install
// record, and a function for the claude command, which logs what it is asked
// and fails on request. Nothing touches the network or an installed plugin.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkManifests } from './lib/check-manifests.mjs'
import { syncPlugins } from './lib/sync-plugins.mjs'
import { both, fixture, install, isolatedEnv, record, recordFile, json } from './fake-marketplace.mjs'

const scripts = dirname(fileURLToPath(import.meta.url))

// Run syncPlugins() on a fixture. `installed` and `after` build the install
// record before the run and the one an install writes, from the sha of
// origin/main, which is known only once the fixture exists. `fail` names the
// claude commands that fail: refresh, update, install.
const sync = ({ only, installed, after, fail = {}, rootFromEnv = false, breakOrigin = false, ...options } = {}) => {
  const repository = fixture(options)
  try {
    if (breakOrigin) rmSync(join(repository.base, 'origin.git'), { recursive: true, force: true })
    if (installed) writeFileSync(recordFile(repository.home), installed(repository.head))
    const calls = []
    // The manifest check runs as a node command; run the check itself here.
    const visible = (command, args) => {
      if (command === process.execPath) return checkManifests(repository.root).errors.length === 0
      assert.equal(command, 'claude')
      calls.push(args.join(' '))
      switch (args[1]) {
        case 'marketplace': return !fail.refresh
        case 'update': return !fail.update
        case 'uninstall': return true
        default:
          if (after) writeFileSync(recordFile(repository.home), after(repository.head))
          return !fail.install
      }
    }
    const out = []
    const err = []
    let status
    let thrown
    try {
      status = syncPlugins({
        only,
        root: repository.root,
        home: repository.home,
        env: isolatedEnv({ HOME: repository.home }),
        rootFromEnv,
        scripts,
        visible,
        stdout: { write: (text) => out.push(text) },
        stderr: { write: (text) => err.push(text) },
      })
    } catch (error) {
      thrown = error
    }
    return { status, thrown, stdout: out.join(''), stderr: err.join(''), calls, head: repository.head, root: repository.root }
  } finally {
    rmSync(repository.base, { recursive: true, force: true })
  }
}

const problems = (result) => result.stderr.split('\n').slice(2, -1).map((line) => line.trim())

test('the fixture builds under a git configuration that signs every commit with a failing program', () => {
  const base = mkdtempSync(join(tmpdir(), 'sync-plugins-config-'))
  const ambient = process.env.GIT_CONFIG_GLOBAL
  try {
    writeFileSync(join(base, 'gitconfig'), '[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = false\n')
    process.env.GIT_CONFIG_GLOBAL = join(base, 'gitconfig')
    const repository = fixture()
    rmSync(repository.base, { recursive: true, force: true })
    assert.match(repository.head, /^[0-9a-f]{40}$/)
  } finally {
    if (ambient === undefined) delete process.env.GIT_CONFIG_GLOBAL
    else process.env.GIT_CONFIG_GLOBAL = ambient
    rmSync(base, { recursive: true, force: true })
  }
})

test('syncPlugins updates every plugin and verifies what is installed', () => {
  const result = sync({ rootFromEnv: true, installed: (head) => both('1.0.0', head) })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.calls, [
    'plugin marketplace update fixture',
    'plugin update jcouball-alpha@fixture',
    'plugin update jcouball-beta@fixture',
  ])
  assert.match(result.stdout, /working on .*, from SYNC_PLUGINS_ROOT/)
  assert.match(result.stdout, /jcouball-alpha@fixture 1\.0\.0 at [0-9a-f]{10}\n/)
  assert.match(result.stdout, /Done\. Run \/reload-plugins/)
})

test('syncPlugins runs git apart from the developer\'s git configuration', () => {
  const base = mkdtempSync(join(tmpdir(), 'sync-plugins-config-'))
  const ambient = process.env.GIT_CONFIG_GLOBAL
  try {
    // A configuration that refuses a fetch from a local path, as a developer's might.
    writeFileSync(join(base, 'gitconfig'), '[protocol "file"]\n\tallow = never\n')
    process.env.GIT_CONFIG_GLOBAL = join(base, 'gitconfig')
    const result = sync({ installed: (head) => both('1.0.0', head) })
    assert.equal(result.status, 0, result.stderr)
  } finally {
    if (ambient === undefined) delete process.env.GIT_CONFIG_GLOBAL
    else process.env.GIT_CONFIG_GLOBAL = ambient
    rmSync(base, { recursive: true, force: true })
  }
})

test('syncPlugins says nothing of SYNC_PLUGINS_ROOT when the root did not come from it', () => {
  const result = sync({ installed: (head) => both('1.0.0', head) })
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stdout, /SYNC_PLUGINS_ROOT/)
})

test('syncPlugins syncs one plugin, named by directory or by name', () => {
  for (const only of ['beta', 'jcouball-beta']) {
    const result = sync({ only, installed: (head) => both('1.0.0', head) })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(result.calls, ['plugin marketplace update fixture', 'plugin update jcouball-beta@fixture'])
  }
})

test('syncPlugins stops when no plugin matches the name', () => {
  const result = sync({ only: 'gamma' })
  assert.equal(result.status, 1)
  assert.equal(result.stderr, "error: no plugin matching 'gamma' in the marketplace manifest\n")
  assert.deepEqual(result.calls, [])
})

test('syncPlugins stops when the manifests are invalid', () => {
  const result = sync({ files: { 'plugins/alpha/.claude-plugin/plugin.json': '{' } })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /error: manifest check failed\. Fix the manifests before syncing\./)
  assert.deepEqual(result.calls, [])
})

test('syncPlugins lets a failure it does not expect end the run', () => {
  const result = sync({ breakOrigin: true })
  assert.match(result.thrown.message, /Command failed: git fetch origin --quiet/)
  assert.equal(result.status, undefined)
  assert.deepEqual(result.calls, [])
})

test('syncPlugins stops when the marketplace refresh fails', () => {
  const result = sync({ fail: { refresh: true } })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /error: could not refresh the fixture marketplace/)
  assert.deepEqual(result.calls, ['plugin marketplace update fixture'])
})

test('syncPlugins installs a plugin whose update fails', () => {
  const result = sync({ only: 'alpha', installed: (head) => both('1.0.0', head), fail: { update: true } })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /update failed, trying a fresh install/)
  assert.deepEqual(result.calls.slice(1), ['plugin update jcouball-alpha@fixture', 'plugin install jcouball-alpha@fixture'])
})

test('syncPlugins stops when the fallback install fails', () => {
  const result = sync({ only: 'alpha', fail: { update: true, install: true } })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /error: could not install jcouball-alpha@fixture/)
})

test('syncPlugins reinstalls a plugin installed at an older commit', () => {
  const result = sync({
    only: 'alpha',
    installed: () => record({ 'jcouball-alpha@fixture': install('1.0.0', 'old') }),
    after: (head) => record({ 'jcouball-alpha@fixture': install('1.0.0', head) }),
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /same version at a new commit, reinstalling to re-pin/)
  assert.deepEqual(result.calls.slice(1), [
    'plugin update jcouball-alpha@fixture',
    'plugin uninstall jcouball-alpha@fixture',
    'plugin install jcouball-alpha@fixture',
  ])
})

test('syncPlugins stops when the reinstall fails', () => {
  const result = sync({
    only: 'alpha',
    installed: () => record({ 'jcouball-alpha@fixture': install('1.0.0', 'old') }),
    fail: { install: true },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /error: could not reinstall jcouball-alpha@fixture/)
})

test('syncPlugins stops when there is no install record', () => {
  const result = sync({ only: 'alpha' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /error: no install record at .*installed_plugins\.json/)
})

test('syncPlugins treats a record with no plugins as a plugin installed at no commit', () => {
  const result = sync({ only: 'alpha', installed: () => json({}), after: () => json({}) })
  assert.equal(result.status, 1)
  assert.deepEqual(problems(result), ['jcouball-alpha@fixture is not installed'])
})

test('syncPlugins reports a plugin that is not installed', () => {
  const result = sync({
    installed: (head) => record({ 'jcouball-alpha@fixture': install('1.0.0', head) }),
    after: (head) => record({ 'jcouball-alpha@fixture': install('1.0.0', head) }),
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /^\nverification failed:\n/)
  assert.deepEqual(problems(result), ['jcouball-beta@fixture is not installed'])
})

test('syncPlugins reports a plugin with no manifest on origin/main', () => {
  const result = sync({ only: 'beta', unpushed: 'beta', installed: (head) => both('1.0.0', head) })
  assert.equal(result.status, 1)
  assert.deepEqual(problems(result), ['jcouball-beta@fixture has no manifest on origin/main. Has the plugin been merged?'])
})

test('syncPlugins reports an installed version that differs from origin/main', () => {
  const result = sync({ only: 'alpha', installed: (head) => both('0.9.0', head) })
  assert.equal(result.status, 1)
  assert.deepEqual(problems(result), ['jcouball-alpha@fixture installed version is 0.9.0, origin/main says 1.0.0'])
})

test('syncPlugins reports an installed sha that differs from origin/main', () => {
  const result = sync({
    only: 'alpha',
    installed: () => both('1.0.0', 'abcdef0123456789'),
    after: () => both('1.0.0', 'abcdef0123456789'),
  })
  assert.equal(result.status, 1)
  assert.deepEqual(problems(result), [
    `jcouball-alpha@fixture installed sha is abcdef0123, origin/main is ${result.head.slice(0, 10)}`,
  ])
})

test('syncPlugins reports both a version and a sha that differ', () => {
  const result = sync({
    only: 'alpha',
    installed: () => both('0.9.0', 'abcdef0123456789'),
    after: () => both('0.9.0', 'abcdef0123456789'),
  })
  assert.equal(result.status, 1)
  assert.equal(problems(result).length, 2)
})

test('syncPlugins reports an install with no recorded sha as an empty one', () => {
  const result = sync({
    only: 'alpha',
    installed: () => record({ 'jcouball-alpha@fixture': [{ version: '1.0.0' }] }),
    after: () => record({ 'jcouball-alpha@fixture': [{ version: '1.0.0' }] }),
  })
  assert.equal(result.status, 1)
  assert.match(problems(result)[0], /^jcouball-alpha@fixture installed sha is , origin\/main is [0-9a-f]{10}$/)
})

test('syncPlugins never calls process.exit', () => {
  const real = process.exit
  process.exit = () => {
    throw new Error('process.exit was called')
  }
  try {
    assert.equal(sync({ only: 'gamma' }).status, 1)
    assert.equal(sync({ fail: { refresh: true } }).status, 1)
    assert.equal(sync({ only: 'alpha', installed: (head) => both('0.9.0', head) }).status, 1)
  } finally {
    process.exit = real
  }
})
