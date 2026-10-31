// Tests for check-manifests.mjs, the command-line wrapper around
// lib/check-manifests.mjs, which check-manifests.test.mjs covers. The wrapper
// checks the repository it sits in unless given a directory, which the failing
// case does.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-manifests.mjs')

test('check-manifests reports ok on this repository', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /^manifests ok: \d+ plugin\(s\) checked/)
})

test('check-manifests lists each problem and exits 1', () => {
  const root = mkdtempSync(join(tmpdir(), 'check-manifests-cli-'))
  try {
    const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.equal(
      result.stderr,
      'manifest check failed:\n  missing file: .claude-plugin/marketplace.json\n  no plugins found under plugins/\n',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
