// A stand-in for a command-line tool, for tests that spawn a script which
// calls it. fakeTools writes one /bin/sh executable per entry into a fresh
// directory and returns an environment with that directory first on PATH.
// Each body is the shell the executable runs.
//
// The directory sits under node_modules rather than the system temp directory,
// as check-actions.mjs does for its binary, because /tmp is mounted noexec on
// some hosts. A fake that cannot execute is skipped by command lookup, which
// carries on down PATH to the real tool, so a test meant to be isolated would
// fetch origin, refresh installed plugins, or call GitHub.

import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const parent = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'node_modules', '.cache', 'fake-tools')

export const fakeTools = (tools) => {
  mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, 'run.'))
  for (const [name, body] of Object.entries(tools)) {
    const path = join(dir, name)
    writeFileSync(path, `#!/bin/sh\n${body}\n`)
    chmodSync(path, 0o755)
  }
  return { dir, env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` } }
}
