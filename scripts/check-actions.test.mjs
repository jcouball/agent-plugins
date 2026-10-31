// Tests for check-actions.mjs, which exports nothing: it runs when node loads
// it, so a test spawns it. A fake actionlint on a PATH that holds nothing else
// stands in for the real one, so the run downloads nothing and the notices
// about shellcheck and pyflakes depend on what the test puts there, not on what
// the host has installed. The download itself is covered in
// download-actionlint.test.mjs; here a preload (fake-environment.mjs) makes
// fetch fail, so a version mismatch reaches the download and stops there.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fakeTools } from './fake-executable.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'check-actions.mjs')
const preload = pathToFileURL(join(here, 'fake-environment.mjs')).href

// What a fake actionlint does when asked for its version, and then when run.
const versioned = (run, version = '1.7.12') => `if [ "$1" = --version ]; then echo ${version}; exit 0; fi\n${run}`

// Run the script with only the given tools on PATH.
const check = (tools, env = {}) => {
  const { dir, env: base } = fakeTools(tools)
  try {
    return spawnSync(process.execPath, [script], {
      env: { ...base, PATH: dir, NODE_OPTIONS: `--import=${preload}`, ...env },
      encoding: 'utf8',
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('check-actions passes when the actionlint on PATH finds no problems', () => {
  const result = check({ actionlint: versioned('exit 0') })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /^workflows ok: actionlint 1\.7\.12 found no problems\n$/)
})

test('check-actions exits with the status actionlint ends with', () => {
  const result = check({ actionlint: versioned('echo "ci.yml:1:1: a problem"\nexit 3') })
  assert.equal(result.status, 3)
  assert.match(result.stdout, /ci\.yml:1:1: a problem/)
  assert.doesNotMatch(result.stdout, /workflows ok/)
})

test('check-actions reports an actionlint that a signal ended', () => {
  const result = check({ actionlint: versioned('kill -TERM $$'), shellcheck: 'exit 0' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /^actionlint check failed: actionlint was killed by SIGTERM\n/)
})

test('check-actions reports an actionlint that is gone by the time it runs', () => {
  const result = check({ actionlint: versioned('exit 0').replace('exit 0; fi', '/bin/rm "$0"; exit 0; fi') })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /^actionlint check failed: spawnSync actionlint ENOENT\n/)
})

test('check-actions downloads when the actionlint on PATH is another version', () => {
  const result = check({ actionlint: versioned('exit 0', '1.6.0') }, { FAKE_FETCH_STATUS: '404' })
  assert.equal(result.status, 1)
  assert.match(result.stdout, /^downloading actionlint 1\.7\.12 for \w+_\w+\n$/)
  assert.match(
    result.stderr,
    /^actionlint check failed: GET https:\/\/github\.com\/rhysd\/actionlint\/releases\/download\/v1\.7\.12\/actionlint_1\.7\.12_\w+\.tar\.gz returned 404\n$/,
  )
})

test('check-actions downloads when actionlint is not on PATH at all', () => {
  const result = check({}, { FAKE_FETCH_STATUS: '503' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /returned 503\n$/)
})

test('check-actions says no build is pinned for a platform it has none for', () => {
  const result = check({}, { FAKE_PLATFORM: 'sunos' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /^actionlint check failed: no pinned actionlint build for sunos_\w+\. Install actionlint 1\.7\.12 yourself/)
})

test('check-actions notes that shellcheck is missing, and not when it is there', () => {
  const missing = check({ actionlint: versioned('exit 0') })
  assert.match(missing.stderr, /^note: shellcheck is not on PATH, so the shell in `run:` steps went unchecked\./)
  const present = check({ actionlint: versioned('exit 0'), shellcheck: 'exit 0' })
  assert.equal(present.stderr, '')
})

// A fake actionlint that runs the pyflakes it is given on a Python script, as
// actionlint does for a `shell: python` step.
const runsPython = versioned('for a in "$@"; do case "$a" in -pyflakes=*) echo "print(1)" | "${a#-pyflakes=}" ;; esac; done')

// The stand-in for pyflakes is a shell script that runs cat and touch, which a
// PATH holding only the fakes does not have.
const coreutils = { cat: 'exec /bin/cat "$@"', touch: 'exec /usr/bin/touch "$@"' }

test('check-actions notes that pyflakes is missing only when a workflow has a Python step', () => {
  const python = check({ actionlint: runsPython, shellcheck: 'exit 0', ...coreutils })
  assert.equal(python.status, 0)
  assert.match(python.stderr, /^note: pyflakes is not on PATH, so the Python steps in these workflows went\n/)
  const none = check({ actionlint: versioned('exit 0'), shellcheck: 'exit 0' })
  assert.equal(none.stderr, '')
})

test('check-actions leaves pyflakes to actionlint when it is installed', () => {
  const result = check({ actionlint: versioned('echo "$*"'), pyflakes: 'exit 0', shellcheck: 'exit 0' })
  assert.equal(result.status, 0)
  assert.doesNotMatch(result.stdout, /-pyflakes/)
  assert.equal(result.stderr, '')
})

test('check-actions hands actionlint a stand-in for the missing pyflakes, except on Windows', () => {
  const unix = check({ actionlint: versioned('echo "$*"'), shellcheck: 'exit 0' })
  assert.match(unix.stdout, /-pyflakes=\S+pyflakes-stub/)
  const windows = check({ actionlint: versioned('echo "$*"'), shellcheck: 'exit 0' }, { FAKE_PLATFORM: 'win32' })
  assert.doesNotMatch(windows.stdout, /-pyflakes/)
})
