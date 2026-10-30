// Tests for check-links.mjs, the command-line wrapper around
// lib/check-links.mjs, which check-links.test.mjs covers. The wrapper checks
// the repository it sits in unless given a directory, which the failing case
// does.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-links.mjs')

test('check-links reports ok on this repository', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /^links ok: \d+ cross-file link\(s\) checked/)
})

test('check-links lists each broken link and exits 1', () => {
  const root = mkdtempSync(join(tmpdir(), 'check-links-cli-'))
  try {
    writeFileSync(join(root, 'README.md'), '[gone](missing.md)\n')
    const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.equal(result.stderr, 'link check failed:\n  README.md: missing.md\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
