// Placeholder test for sync-plugins.mjs, which exports nothing: it runs when
// node loads it. This only spawns it, so the script is loaded and counted. A
// fake git and a fake claude stand in for the real ones, so the run touches
// neither the network nor any installed plugin. The cases that reach the
// install and verification branches come later.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fakeTools } from './fake-executable.mjs'

const script = join(dirname(fileURLToPath(import.meta.url)), 'sync-plugins.mjs')

test('sync-plugins exits non-zero when the marketplace refresh fails', () => {
  const { dir, env } = fakeTools({
    git: 'echo 0123456789abcdef0123456789abcdef01234567',
    claude: 'exit 1',
  })
  try {
    const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /could not refresh the jcouball marketplace/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
