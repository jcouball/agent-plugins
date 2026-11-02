// Tests for check-actions.mjs as a program. What it does is tested in
// check-actions.test.mjs, which calls checkActions() in the test's own process.
// These start the script, for what only a running program has: the actionlint
// it finds on PATH and really runs, the platform and fetch it hands to the
// download, and the scratch directory it removes when a signal ends it. A fake
// actionlint on a PATH that holds nothing else stands in for the real one, so
// the run downloads nothing. A preload (fake-environment.mjs) makes fetch fail
// or hang, so a version mismatch reaches the download and stops there.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fakeTools, linkTools, onPath } from './fake-executable.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'check-actions.mjs')
const preload = pathToFileURL(join(here, 'fake-environment.mjs')).href

// What a fake actionlint does when asked for its version, and then when run.
const versioned = (run, version = '1.7.12') => `if [ "$1" = --version ]; then echo ${version}; exit 0; fi\n${run}`

// Run the script with only the given tools on PATH, and the real tools named
// in `real` linked beside them.
const check = (tools, env = {}, real = []) => {
  const { dir, env: base } = fakeTools(tools)
  try {
    linkTools(dir, real)
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

test('check-actions reports an actionlint that is gone by the time it runs', () => {
  const result = check({ actionlint: versioned('exit 0').replace('exit 0; fi', 'rm "$0"; exit 0; fi') }, {}, ['rm'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /^actionlint check failed: spawnSync actionlint ENOENT\n/)
})

test('check-actions finds the real tools its fakes use when a PATH directory has a space in its name', () => {
  const spaced = mkdtempSync(join(tmpdir(), 'check-actions path '))
  const before = process.env.PATH
  try {
    symlinkSync(onPath('rm'), join(spaced, 'rm'))
    process.env.PATH = `${spaced}${delimiter}${before}`
    const result = check({ actionlint: versioned('exit 0').replace('exit 0; fi', 'rm "$0"; exit 0; fi') }, {}, ['rm'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /spawnSync actionlint ENOENT/)
  } finally {
    process.env.PATH = before
    rmSync(spaced, { recursive: true, force: true })
  }
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

// The scratch directories a run leaves under node_modules, where it makes them.
const scratchDirectories = () => {
  try {
    return readdirSync(join(here, '..', 'node_modules', '.cache', 'actionlint'))
  } catch {
    return []
  }
}

// Only a script waiting on the network can act on a signal: while it waits on
// actionlint, the event loop is blocked and the exit hook does the cleaning.
// So the fetch never answers, and the signal arrives during the download.
for (const [signal, status] of [['SIGHUP', 129], ['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`check-actions removes its scratch directory and exits ${status} on ${signal}`, async () => {
    const { dir, env } = fakeTools({})
    const before = scratchDirectories()
    try {
      const child = spawn(process.execPath, [script], {
        env: { ...env, PATH: dir, NODE_OPTIONS: `--import=${preload}`, FAKE_FETCH_HANG: '1' },
      })
      let output = ''
      const downloading = new Promise((resolve) => {
        child.stdout.on('data', (chunk) => {
          output += chunk
          if (output.includes('downloading actionlint')) resolve()
        })
      })
      const closed = new Promise((resolve) => child.on('close', (code, ended) => resolve({ code, ended })))
      await downloading
      child.kill(signal)
      assert.deepEqual(await closed, { code: status, ended: null })
      assert.deepEqual(
        scratchDirectories().filter((name) => !before.includes(name)),
        [],
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
