// Placeholder test for check-actions.mjs, which exports nothing: it runs when
// node loads it. This only spawns it, so the script is loaded and counted. A
// fake actionlint at the pinned version stands in for the real one, so the run
// downloads nothing. The cases that reach the download come later.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fakeTools } from './fake-executable.mjs'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-actions.mjs')

test('check-actions passes when the actionlint on PATH finds no problems', () => {
  const { dir, env } = fakeTools({ actionlint: '[ "$1" = --version ] && echo 1.7.12\nexit 0' })
  try {
    const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8' })
    assert.equal(result.status, 0)
    assert.match(result.stdout, /workflows ok: actionlint 1\.7\.12/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
