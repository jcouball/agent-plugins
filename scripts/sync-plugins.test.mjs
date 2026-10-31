// Tests for sync-plugins.mjs, which exports nothing: it runs when node loads
// it, so a test spawns it. SYNC_PLUGINS_ROOT points the original script at a
// fixture repository whose origin is a local bare repository, HOME at a
// temporary directory holding the install record, and a fake claude on PATH
// logs what the script asks of it and fails on request. Nothing touches the
// network or an installed plugin.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { devNull, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fakeTools } from './fake-executable.mjs'

const script = join(dirname(fileURLToPath(import.meta.url)), 'sync-plugins.mjs')

// What the fake claude does for each subcommand. FAIL_<COMMAND> is an exit
// status, and an install copies RECORD_AFTER over the install record, as a
// real install would write one.
const claude = `
echo "$*" >> "$CLAUDE_LOG"
case "$*" in
  "plugin marketplace update"*) exit "\${FAIL_REFRESH:-0}" ;;
  "plugin update"*) exit "\${FAIL_UPDATE:-0}" ;;
  "plugin uninstall"*) exit 0 ;;
  "plugin install"*)
    [ -z "$RECORD_AFTER" ] || cp "$RECORD_AFTER" "$HOME/.claude/plugins/installed_plugins.json"
    exit "\${FAIL_INSTALL:-0}" ;;
esac`

// Git run on the fixture, apart from the developer's user and system
// configuration: a signing key, a hooks directory, or a URL rewrite there
// would change or break every fixture.
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

const json = (value) => `${JSON.stringify(value, null, 2)}\n`

// The files of a plugin that passes the manifest check.
const pluginFiles = (directory, version = '1.0.0') => ({
  [`plugins/${directory}/.claude-plugin/plugin.json`]: json({
    name: `jcouball-${directory}`,
    version,
    description: `The ${directory} plugin`,
  }),
  [`.release-please/${directory}-config.json`]: json({ packages: { [`plugins/${directory}`]: {} } }),
  [`.release-please/${directory}-manifest.json`]: json({ [`plugins/${directory}`]: version }),
})

// A repository named `fixture` with plugins alpha and beta, pushed to a local
// bare origin. `unpushed` names a plugin whose manifest stays out of the
// commit, so origin/main has no manifest for it. `files` overrides or adds
// files before the commit.
const fixture = ({ unpushed, files = {} } = {}) => {
  const base = mkdtempSync(join(tmpdir(), 'sync-plugins-'))
  const root = join(base, 'repository')
  const home = join(base, 'home')
  mkdirSync(join(home, '.claude/plugins'), { recursive: true })
  const all = {
    '.claude-plugin/marketplace.json': json({
      name: 'fixture',
      plugins: ['alpha', 'beta'].map((directory) => ({
        name: `jcouball-${directory}`,
        source: `./plugins/${directory}`,
        description: `The ${directory} plugin`,
      })),
    }),
    ...pluginFiles('alpha'),
    ...pluginFiles('beta'),
    ...files,
  }
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  git(base, 'init', '--quiet', '--bare', '--initial-branch=main', 'origin.git')
  git(root, 'init', '--quiet', '--initial-branch=main')
  git(root, 'remote', 'add', 'origin', join(base, 'origin.git'))
  const skipped = unpushed ? [`:!plugins/${unpushed}/.claude-plugin/plugin.json`] : []
  git(root, 'add', '--all', '--', '.', ...skipped)
  git(root, 'commit', '--quiet', '--message', 'fixture')
  git(root, 'push', '--quiet', 'origin', 'main')
  git(root, 'fetch', '--quiet', 'origin')
  const head = git(root, 'rev-parse', 'origin/main')
  return { base, root, home, head }
}

const install = (version, gitCommitSha) => [{ version, gitCommitSha, installPath: '/installed/path' }]
const record = (plugins) => json({ plugins })
const recordFile = (home) => join(home, '.claude/plugins/installed_plugins.json')

// Run the script on a fixture. `installed` and `after` build the install
// record before the run and the one an install writes, from the sha of
// origin/main, which is known only once the fixture exists. `env` steers the
// fake claude. `relative` names the root by its path from the directory above
// it, and runs the script from there.
const sync = ({ args = [], installed, after, env = {}, relative = false, ...options } = {}) => {
  const repository = fixture(options)
  const tools = fakeTools({ claude })
  try {
    const afterPath = join(repository.base, 'after.json')
    if (installed) writeFileSync(recordFile(repository.home), installed(repository.head))
    if (after) writeFileSync(afterPath, after(repository.head))
    const log = join(repository.base, 'claude.log')
    const result = spawnSync(process.execPath, [script, ...args], {
      env: {
        ...tools.env,
        HOME: repository.home,
        SYNC_PLUGINS_ROOT: relative ? basename(repository.root) : repository.root,
        CLAUDE_LOG: log,
        ...(after ? { RECORD_AFTER: afterPath } : {}),
        ...env,
      },
      cwd: relative ? repository.base : undefined,
      encoding: 'utf8',
    })
    let calls = []
    try {
      calls = readFileSync(log, 'utf8').trimEnd().split('\n')
    } catch {
      // The script stopped before it called claude.
    }
    return { ...result, calls, head: repository.head, root: repository.root }
  } finally {
    rmSync(repository.base, { recursive: true, force: true })
    rmSync(tools.dir, { recursive: true, force: true })
  }
}

const both = (version, sha) =>
  record({ 'jcouball-alpha@fixture': install(version, sha), 'jcouball-beta@fixture': install(version, sha) })
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

test('sync-plugins updates every plugin and verifies what is installed', () => {
  const result = sync({ installed: (head) => both('1.0.0', head) })
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

test('sync-plugins accepts a SYNC_PLUGINS_ROOT relative to the directory it runs from', () => {
  const result = sync({ relative: true, installed: (head) => both('1.0.0', head) })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /working on \/.*\/repository, from SYNC_PLUGINS_ROOT/)
})

test('sync-plugins syncs one plugin, named by directory or by name', () => {
  for (const only of ['beta', 'jcouball-beta']) {
    const result = sync({ args: [only], installed: (head) => both('1.0.0', head) })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(result.calls, ['plugin marketplace update fixture', 'plugin update jcouball-beta@fixture'])
  }
})

test('sync-plugins stops when no plugin matches the name', () => {
  const result = sync({ args: ['gamma'] })
  assert.equal(result.status, 1)
  assert.equal(result.stderr, "error: no plugin matching 'gamma' in the marketplace manifest\n")
  assert.deepEqual(result.calls, [])
})

test('sync-plugins stops when the manifests are invalid', () => {
  const result = sync({ files: { 'plugins/alpha/.claude-plugin/plugin.json': '{' } })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /error: manifest check failed\. Fix the manifests before syncing\./)
  assert.deepEqual(result.calls, [])
})

test('sync-plugins stops when the marketplace refresh fails', () => {
  const result = sync({ env: { FAIL_REFRESH: '1' } })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /error: could not refresh the fixture marketplace/)
  assert.deepEqual(result.calls, ['plugin marketplace update fixture'])
})

test('sync-plugins installs a plugin whose update fails', () => {
  const result = sync({ args: ['alpha'], installed: (head) => both('1.0.0', head), env: { FAIL_UPDATE: '1' } })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /update failed, trying a fresh install/)
  assert.deepEqual(result.calls.slice(1), ['plugin update jcouball-alpha@fixture', 'plugin install jcouball-alpha@fixture'])
})

test('sync-plugins stops when the fallback install fails', () => {
  const result = sync({ args: ['alpha'], env: { FAIL_UPDATE: '1', FAIL_INSTALL: '1' } })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /error: could not install jcouball-alpha@fixture/)
})

test('sync-plugins reinstalls a plugin installed at an older commit', () => {
  const result = sync({
    args: ['alpha'],
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

test('sync-plugins stops when the reinstall fails', () => {
  const result = sync({
    args: ['alpha'],
    installed: () => record({ 'jcouball-alpha@fixture': install('1.0.0', 'old') }),
    env: { FAIL_INSTALL: '1' },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /error: could not reinstall jcouball-alpha@fixture/)
})

test('sync-plugins stops when there is no install record', () => {
  const result = sync({ args: ['alpha'] })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /error: no install record at .*installed_plugins\.json/)
})

test('sync-plugins treats a record with no plugins as a plugin installed at no commit', () => {
  const result = sync({ args: ['alpha'], installed: () => json({}), after: () => json({}) })
  assert.equal(result.status, 1)
  assert.deepEqual(problems(result), ['jcouball-alpha@fixture is not installed'])
})

test('sync-plugins reports a plugin that is not installed', () => {
  const result = sync({
    installed: (head) => record({ 'jcouball-alpha@fixture': install('1.0.0', head) }),
    after: (head) => record({ 'jcouball-alpha@fixture': install('1.0.0', head) }),
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /^\nverification failed:\n/)
  assert.deepEqual(problems(result), ['jcouball-beta@fixture is not installed'])
})

test('sync-plugins reports a plugin with no manifest on origin/main', () => {
  const result = sync({ args: ['beta'], unpushed: 'beta', installed: (head) => both('1.0.0', head) })
  assert.equal(result.status, 1)
  assert.deepEqual(problems(result), ['jcouball-beta@fixture has no manifest on origin/main. Has the plugin been merged?'])
})

test('sync-plugins reports an installed version that differs from origin/main', () => {
  const result = sync({ args: ['alpha'], installed: (head) => both('0.9.0', head) })
  assert.equal(result.status, 1)
  assert.deepEqual(problems(result), ['jcouball-alpha@fixture installed version is 0.9.0, origin/main says 1.0.0'])
})

test('sync-plugins reports an installed sha that differs from origin/main', () => {
  const result = sync({
    args: ['alpha'],
    installed: () => both('1.0.0', 'abcdef0123456789'),
    after: () => both('1.0.0', 'abcdef0123456789'),
  })
  assert.equal(result.status, 1)
  assert.deepEqual(problems(result), [
    `jcouball-alpha@fixture installed sha is abcdef0123, origin/main is ${result.head.slice(0, 10)}`,
  ])
})

test('sync-plugins reports both a version and a sha that differ', () => {
  const result = sync({
    args: ['alpha'],
    installed: () => both('0.9.0', 'abcdef0123456789'),
    after: () => both('0.9.0', 'abcdef0123456789'),
  })
  assert.equal(result.status, 1)
  assert.equal(problems(result).length, 2)
})

test('sync-plugins reports an install with no recorded sha as an empty one', () => {
  const result = sync({
    args: ['alpha'],
    installed: () => record({ 'jcouball-alpha@fixture': [{ version: '1.0.0' }] }),
    after: () => record({ 'jcouball-alpha@fixture': [{ version: '1.0.0' }] }),
  })
  assert.equal(result.status, 1)
  assert.match(problems(result)[0], /^jcouball-alpha@fixture installed sha is , origin\/main is [0-9a-f]{10}$/)
})

test('sync-plugins works on its own repository, and says nothing of SYNC_PLUGINS_ROOT, when it is unset', () => {
  // A fake git and claude keep this run, which reads the real repository, off
  // the network and away from any installed plugin.
  const tools = fakeTools({ git: 'echo 0123456789abcdef0123456789abcdef01234567', claude: 'exit 1' })
  try {
    const env = { ...tools.env }
    delete env.SYNC_PLUGINS_ROOT
    const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /could not refresh the jcouball marketplace/)
    assert.doesNotMatch(result.stdout, /SYNC_PLUGINS_ROOT/)
  } finally {
    rmSync(tools.dir, { recursive: true, force: true })
  }
})
