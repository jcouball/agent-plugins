// A stand-in for a command-line tool, for tests that spawn a script which
// calls it. fakeTools writes one /bin/sh executable per entry into a fresh
// directory and returns an environment with that directory first on PATH.
// Each body is the shell the executable runs.

import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

export const fakeTools = (tools) => {
  const dir = mkdtempSync(join(tmpdir(), 'fake-tools-'))
  for (const [name, body] of Object.entries(tools)) {
    const path = join(dir, name)
    writeFileSync(path, `#!/bin/sh\n${body}\n`)
    chmodSync(path, 0o755)
  }
  return { dir, env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` } }
}
