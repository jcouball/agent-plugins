#!/usr/bin/env node
//
// Refresh the local marketplace clone, upgrade the installed plugins, and
// verify that what is installed matches what is on the default branch.
//
// This is a local development convenience, not a release step. release-please
// owns versions, changelogs, and tags; nothing here writes to the repository.
//
// Usage:
//   npm run sync              # every plugin
//   npm run sync -- writing   # one plugin
//
// It works on the repository it sits in. SYNC_PLUGINS_ROOT names another one,
// which is how a test points the script at a fixture. The script says so when
// it is set. The work is in lib/sync-plugins.mjs.

import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncPlugins } from './lib/sync-plugins.mjs'

const scripts = dirname(fileURLToPath(import.meta.url))
// Absolute, because every command runs with root as its working directory and
// some are handed root as an argument; a relative path would resolve twice.
const root = resolve(process.env.SYNC_PLUGINS_ROOT ?? join(scripts, '..'))

const visible = (command, args) => {
  try {
    execFileSync(command, args, { cwd: root, stdio: 'inherit' })
    return true
  } catch {
    return false
  }
}

process.exitCode = syncPlugins({
  only: process.argv[2],
  root,
  home: homedir(),
  env: process.env,
  rootFromEnv: Boolean(process.env.SYNC_PLUGINS_ROOT),
  scripts,
  visible,
  stdout: process.stdout,
  stderr: process.stderr,
})
