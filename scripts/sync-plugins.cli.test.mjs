// Tests for sync-plugins.mjs as a program. What it does is tested in
// sync-plugins.test.mjs, which calls syncPlugins() in the test's own process.
// These start the script, for what only a running program has: the root it
// takes from SYNC_PLUGINS_ROOT, the commands it runs for real, and its exit
// status. SYNC_PLUGINS_ROOT points it at a fixture repository whose origin is
// a local bare repository, HOME at a temporary directory holding the install
// record, and a fake claude on PATH logs what the script asks of it and fails
// on request. Nothing touches the network or an installed plugin.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fakeTools } from './fake-executable.mjs'
import { both, fixture, recordFile } from './fake-marketplace.mjs'

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

// Run the script on a fixture. `installed` and `after` build the install
// record before the run and the one an install writes, from the sha of
// origin/main, which is known only once the fixture exists. `env` steers the
// fake claude. `relative` names the root by its path from the directory above
// it, and runs the script from there.
const sync = ({ args = [], installed, after, env = {}, relative = false, breakOrigin = false, ...options } = {}) => {
  const repository = fixture(options)
  if (breakOrigin) rmSync(join(repository.base, 'origin.git'), { recursive: true, force: true })
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

test('sync-plugins syncs only the plugin named on the command line', () => {
  const result = sync({ args: ['beta'], installed: (head) => both('1.0.0', head) })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.calls, ['plugin marketplace update fixture', 'plugin update jcouball-beta@fixture'])
})

test('sync-plugins accepts a SYNC_PLUGINS_ROOT relative to the directory it runs from', () => {
  const result = sync({ relative: true, installed: (head) => both('1.0.0', head) })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /working on \/.*\/repository, from SYNC_PLUGINS_ROOT/)
})

test('sync-plugins lets a failure it does not expect end the run, with the error on stderr', () => {
  const result = sync({ breakOrigin: true })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Command failed: git fetch origin --quiet/)
  assert.deepEqual(result.calls, [])
})

test('sync-plugins stops when the marketplace refresh fails', () => {
  const result = sync({ env: { FAIL_REFRESH: '1' } })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /error: could not refresh the fixture marketplace/)
  assert.deepEqual(result.calls, ['plugin marketplace update fixture'])
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
