// Placeholder test for probe-github-rendering.mjs, which exports nothing: it
// runs when node loads it. This only spawns it, so the script is loaded and
// counted. The cases that check its comparison and reporting come later.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fakeTools } from './fake-executable.mjs'

const script = join(dirname(fileURLToPath(import.meta.url)), 'probe-github-rendering.mjs')

test('probe-github-rendering exits non-zero when gh fails', () => {
  const { dir, env } = fakeTools({ gh: 'echo "gh: not logged in" >&2\nexit 1' })
  try {
    const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8' })
    assert.notEqual(result.status, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
