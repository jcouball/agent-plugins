// Placeholder test for check-links.mjs, the command-line wrapper around
// lib/check-links.mjs, which check-links.test.mjs already covers. This only
// spawns the wrapper, so it is loaded and counted.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-links.mjs')

test('check-links reports ok on this repository', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /^links ok: \d+ cross-file link\(s\) checked/)
})
