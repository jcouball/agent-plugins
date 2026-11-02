// Tests for checkActions(), called in the test's own process. The commands it
// runs are a function that answers as the tools on a pretend PATH would, so
// the notices about shellcheck and pyflakes depend on what the test puts
// there, not on what the host has installed, and nothing is downloaded. The
// download itself is covered in download-actionlint.test.mjs. The script,
// started as a process, is tested in check-actions.cli.test.mjs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkActions } from './lib/check-actions.mjs'
import { downloadActionlint } from './lib/download-actionlint.mjs'

const version = '1.7.12'
const root = '/the/repository'

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
  const scratch = mkdtempSync(join(tmpdir(), 'check-actions-'))
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
