// Tests for checkActions(), called in the test's own process. The commands it
// runs are a function that answers as the tools on a pretend PATH would, so
// the notices about shellcheck and pyflakes depend on what the test puts
// there, not on what the host has installed, and nothing is downloaded. The
// download itself is covered in download-actionlint.test.mjs. The script,
// started as a process, is tested in check-actions.cli.test.mjs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkActions } from './lib/check-actions.mjs'
import { downloadActionlint } from './lib/download-actionlint.mjs'

const version = '1.7.12'
const root = '/the/repository'

// Where a run writes, under node_modules as the script does, because it runs the
// stub it writes there and /tmp is mounted noexec on some hosts.
const parent = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'node_modules', '.cache', 'check-actions-test')

const unexpected = (what) => () => {
  throw new Error(`${what} must not be called`)
}

// Run checkActions(). `present` names the tools on the pretend PATH and the
// version each reports. `run` answers when actionlint itself is run, as
// spawnSync would, and sees the command and its arguments. `download` stands
// in for the release download.
async function check({
  present = {},
  run = () => ({ status: 0 }),
  download = unexpected('download'),
  platform = 'linux',
  arch = 'x64',
} = {}) {
  mkdirSync(parent, { recursive: true })
  const scratch = mkdtempSync(join(parent, 'run.'))
  const calls = []
  const spawn = (command, args, options) => {
    if (args.length === 1 && args[0] === '--version') {
      if (!(command in present)) return { status: null, error: new Error(`spawnSync ${command} ENOENT`) }
      return { status: 0, stdout: `${present[command]}\n` }
    }
    calls.push({ command, args, options })
    return run({ command, args, options })
  }
  const out = []
  const err = []
  const fetch = unexpected('fetch')
  let status
  let thrown
  try {
    status = await checkActions({
      version,
      checksums: {},
      root,
      platform,
      arch,
      fetch,
      spawn,
      download,
      scratch,
      stdout: { write: (text) => out.push(text) },
      stderr: { write: (text) => err.push(text) },
    })
  } catch (error) {
    thrown = error
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  return { status, thrown, stdout: out.join(''), stderr: err.join(''), calls, scratch, fetch }
}

test('checkActions lets a failure it does not expect end the run', async () => {
  const result = await check({
    present: { actionlint: version },
    run: () => {
      throw new Error('spawn broke')
    },
  })
  assert.equal(result.thrown.message, 'spawn broke')
  assert.equal(result.status, undefined)
})

test('checkActions passes when the actionlint on PATH finds no problems', async () => {
  const result = await check({ present: { actionlint: version, shellcheck: '' } })
  assert.equal(result.status, 0)
  assert.equal(result.stdout, `workflows ok: actionlint ${version} found no problems\n`)
  assert.equal(result.stderr, '')
  assert.equal(result.calls.length, 1)
  assert.equal(result.calls[0].command, 'actionlint')
  assert.deepEqual(result.calls[0].options, { cwd: root, stdio: 'inherit' })
})

test('checkActions exits with the status actionlint ends with', async () => {
  const result = await check({ present: { actionlint: version }, run: () => ({ status: 3 }) })
  assert.equal(result.status, 3)
  assert.doesNotMatch(result.stdout, /workflows ok/)
})

test('checkActions reports an actionlint that a signal ended', async () => {
  const result = await check({
    present: { actionlint: version, shellcheck: '' },
    run: () => ({ status: null, signal: 'SIGTERM' }),
  })
  assert.equal(result.status, 1)
  assert.equal(result.stderr, 'actionlint check failed: actionlint was killed by SIGTERM\n')
})

test('checkActions reports an actionlint that is gone by the time it runs', async () => {
  const result = await check({
    present: { actionlint: version, shellcheck: '' },
    run: () => ({ status: null, error: new Error('spawnSync actionlint ENOENT') }),
  })
  assert.equal(result.status, 1)
  assert.equal(result.stderr, 'actionlint check failed: spawnSync actionlint ENOENT\n')
})

test('checkActions downloads when the actionlint on PATH is another version', async () => {
  const seen = []
  const result = await check({
    present: { actionlint: '1.6.0' },
    download: async (options) => {
      seen.push(options)
      options.log('downloading actionlint 1.7.12 for linux_amd64')
      throw new Error('GET https://example.test/actionlint.tar.gz returned 404')
    },
  })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, 'downloading actionlint 1.7.12 for linux_amd64\n')
  assert.equal(result.stderr, 'actionlint check failed: GET https://example.test/actionlint.tar.gz returned 404\n')
  assert.equal(seen.length, 1)
  assert.deepEqual(
    { ...seen[0], log: undefined },
    {
      version,
      checksums: {},
      platform: 'linux',
      arch: 'x64',
      fetch: result.fetch,
      tar: 'tar',
      directory: result.scratch,
      log: undefined,
    },
  )
  assert.deepEqual(result.calls, [])
})

test('checkActions downloads when actionlint is not on PATH at all', async () => {
  const result = await check({
    download: async () => {
      throw new Error('GET https://example.test/actionlint.tar.gz returned 503')
    },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /returned 503\n$/)
})

test('checkActions runs the actionlint it downloaded', async () => {
  const result = await check({ download: async () => '/scratch/actionlint', present: { shellcheck: '' } })
  assert.equal(result.status, 0)
  assert.deepEqual(result.calls.map((call) => call.command), ['/scratch/actionlint'])
})

test('checkActions says no build is pinned for a platform it has none for', async () => {
  const result = await check({ platform: 'sunos', download: downloadActionlint })
  assert.equal(result.status, 1)
  assert.match(
    result.stderr,
    /^actionlint check failed: no pinned actionlint build for sunos_amd64\. Install actionlint 1\.7\.12 yourself/,
  )
})

test('checkActions notes that shellcheck is missing, and not when it is there', async () => {
  const missing = await check({ present: { actionlint: version } })
  assert.match(missing.stderr, /^note: shellcheck is not on PATH, so the shell in `run:` steps went unchecked\./)
  const present = await check({ present: { actionlint: version, shellcheck: '' } })
  assert.equal(present.stderr, '')
})

// An actionlint that runs the pyflakes it is given on a Python script, as the
// real one does for a `shell: python` step.
const runsPython = ({ args }) => {
  for (const arg of args) {
    if (arg.startsWith('-pyflakes=')) spawnSync(arg.slice('-pyflakes='.length), { input: 'print(1)' })
  }
  return { status: 0 }
}

test('checkActions notes that pyflakes is missing only when a workflow has a Python step', async () => {
  const python = await check({ present: { actionlint: version, shellcheck: '' }, run: runsPython })
  assert.equal(python.status, 0)
  assert.match(python.stderr, /^note: pyflakes is not on PATH, so the Python steps in these workflows went\n/)
  const none = await check({ present: { actionlint: version, shellcheck: '' } })
  assert.equal(none.stderr, '')
})

test('checkActions leaves pyflakes to actionlint when it is installed', async () => {
  const result = await check({ present: { actionlint: version, pyflakes: '', shellcheck: '' } })
  assert.equal(result.status, 0)
  assert.deepEqual(result.calls[0].args, [])
  assert.equal(result.stderr, '')
})

test('checkActions hands actionlint a stand-in for the missing pyflakes, except on Windows', async () => {
  const present = { actionlint: version, shellcheck: '' }
  const unix = await check({ present })
  assert.match(unix.calls[0].args[0], /^-pyflakes=\S+pyflakes-stub$/)
  const windows = await check({ present, platform: 'win32' })
  assert.deepEqual(windows.calls[0].args, [])
})
