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

import { accessSync, chmodSync, constants, mkdirSync, mkdtempSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
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

// Where an executable is on the PATH this process has. A test that hard-codes
// /usr/bin/git fails on a host that keeps it somewhere else.
export const onPath = (name) => {
  for (const dir of process.env.PATH.split(delimiter)) {
    const candidate = join(dir, name)
    try {
      accessSync(candidate, constants.X_OK)
      // An empty or relative PATH entry means a directory under the working
      // directory, and a symlink target is read from the link's own directory.
      if (statSync(candidate).isFile()) return resolve(candidate)
    } catch {
      // Not in this directory.
    }
  }
  throw new Error(`${name} is not on PATH`)
}

// Put the real tools in a directory fakeTools made, as symlinks, so a fake that
// runs on a PATH holding nothing else can still call them by name. A symlink
// keeps the path to the tool out of any shell command, where a space or an
// apostrophe in it would have to be quoted.
export const linkTools = (dir, names) => {
  for (const name of names) symlinkSync(onPath(name), join(dir, name))
}
