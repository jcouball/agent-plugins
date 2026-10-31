// Tests for fake-executable.mjs, for the parts a test of another script does
// not reach. linkTools runs in a child process, because what it must get right
// depends on the working directory and on the PATH the process started with.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const module = pathToFileURL(join(here, 'fake-executable.mjs')).href

// Link `tool` into a fake directory from a process whose working directory is
// `cwd` and whose PATH starts with `path`. Returns whether the link led to a
// file, or the error if there was none, and the directory the process made,
// which it removes before it ends.
const link = (cwd, path, tool) => {
  const script = `
    import { existsSync } from 'node:fs'
    import { join } from 'node:path'
    import { fakeTools, linkTools } from ${JSON.stringify(module)}
    import { rmSync } from 'node:fs'
    const { dir } = fakeTools({})
    console.log(dir)
    try {
      linkTools(dir, [${JSON.stringify(tool)}])
      console.log(existsSync(join(dir, ${JSON.stringify(tool)})))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${path}${delimiter}${process.env.PATH}` },
  })
  const [dir, linked] = result.stdout.trim().split('\n')
  return { dir, outcome: linked ?? result.stderr }
}

test('linkTools links a tool found through an empty or relative PATH entry to a file', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'fake-executable-'))
  try {
    writeFileSync(join(cwd, 'footool'), '#!/bin/sh\n')
    chmodSync(join(cwd, 'footool'), 0o755)
    for (const entry of ['', '.']) assert.equal(link(cwd, entry, 'footool').outcome, 'true', `PATH entry ${JSON.stringify(entry)}`)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('the directory the child process makes is removed, whether linking works or not', () => {
  for (const tool of ['sh', 'no-such-tool-anywhere']) {
    const { dir } = link(tmpdir(), '', tool)
    assert.match(dir, /fake-tools/)
    assert.equal(existsSync(dir), false, `${dir} was left behind for ${tool}`)
  }
})

test('linkTools says which tool is missing when it is on no PATH entry', () => {
  assert.match(link(tmpdir(), '', 'no-such-tool-anywhere').outcome, /no-such-tool-anywhere is not on PATH/)
})
