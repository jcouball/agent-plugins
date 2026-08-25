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

import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const only = process.argv[2]

const die = (message) => {
  console.error(`error: ${message}`)
  process.exit(1)
}

const step = (message) => console.log(`\n${message}`)
const note = (message) => console.log(`  ${message}`)

const run = (command, args) =>
  execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const runVisible = (command, args) => {
  try {
    execFileSync(command, args, { cwd: root, stdio: 'inherit' })
    return true
  } catch {
    return false
  }
}

// The marketplace clone pulls from GitHub, so only what has been merged and
// pushed can be installed. Comparing against the working tree would report
// success for a version that exists nowhere but this machine.
const atDefaultBranch = (path) => {
  try {
    return JSON.parse(run('git', ['show', `origin/main:${path}`]))
  } catch {
    return null
  }
}

// Validate before reading anything. check-manifests.mjs reports a missing or
// malformed manifest in terms you can act on. Parsing it here first would
// report the same problem as a stack trace.
step('Validating manifests')
if (!runVisible(process.execPath, [join(root, 'scripts/check-manifests.mjs')])) {
  die('manifest check failed. Fix the manifests before syncing.')
}

const marketplace = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'))
const marketplaceName = marketplace.name

step('Fetching origin')
run('git', ['fetch', 'origin', '--quiet'])
const head = run('git', ['rev-parse', 'origin/main'])
note(`origin/main is at ${head.slice(0, 10)}`)

const targets = marketplace.plugins
  .map((entry) => ({ name: entry.name, directory: entry.source.replace(/^\.\/plugins\//, '') }))
  .filter((target) => !only || target.directory === only || target.name === only)

if (targets.length === 0) die(`no plugin matching '${only}' in the marketplace manifest`)

step(`Refreshing the ${marketplaceName} marketplace`)
if (!runVisible('claude', ['plugin', 'marketplace', 'update', marketplaceName])) {
  die(`could not refresh the ${marketplaceName} marketplace`)
}

// 'claude plugin details' reads the marketplace source, not the installed
// copy, so it cannot confirm an upgrade. Read the install record instead.
const recordPath = join(homedir(), '.claude/plugins/installed_plugins.json')

const readRecord = () => {
  if (!existsSync(recordPath)) die(`no install record at ${recordPath}`)
  return JSON.parse(readFileSync(recordPath, 'utf8'))
}

const installedSha = (record, qualified) => record.plugins?.[qualified]?.[0]?.gitCommitSha

for (const target of targets) {
  const qualified = `${target.name}@${marketplaceName}`

  step(`Upgrading ${qualified}`)
  // 'install' silently no-ops when the plugin is already installed, so update
  // first. 'update' needs the marketplace-qualified name or it reports the
  // plugin as not found.
  if (!runVisible('claude', ['plugin', 'update', qualified])) {
    note('update failed, trying a fresh install')
    if (!runVisible('claude', ['plugin', 'install', qualified])) die(`could not install ${qualified}`)
  }

  // 'update' compares version numbers, not commits. When content reaches the
  // default branch without a version bump it reports the plugin as already up
  // to date and leaves the install pinned to the old commit. Uninstalling
  // first is the only way to re-pin it.
  if (installedSha(readRecord(), qualified) !== head) {
    note('same version at a new commit, reinstalling to re-pin')
    runVisible('claude', ['plugin', 'uninstall', qualified])
    if (!runVisible('claude', ['plugin', 'install', qualified])) die(`could not reinstall ${qualified}`)
  }
}

step('Verifying what is actually installed')
const record = readRecord()

const problems = []
for (const target of targets) {
  const qualified = `${target.name}@${marketplaceName}`
  const install = record.plugins?.[qualified]?.[0]

  if (!install) {
    problems.push(`${qualified} is not installed`)
    continue
  }

  const manifest = atDefaultBranch(`plugins/${target.directory}/.claude-plugin/plugin.json`)
  if (!manifest) {
    problems.push(`${qualified} has no manifest on origin/main. Has the plugin been merged?`)
    continue
  }

  if (install.version !== manifest.version) {
    problems.push(`${qualified} installed version is ${install.version}, origin/main says ${manifest.version}`)
  }
  if (install.gitCommitSha !== head) {
    problems.push(
      `${qualified} installed sha is ${(install.gitCommitSha ?? '').slice(0, 10)}, origin/main is ${head.slice(0, 10)}`
    )
  }
  if (install.version === manifest.version && install.gitCommitSha === head) {
    note(`${qualified} ${install.version} at ${head.slice(0, 10)}`)
    note(`${install.installPath}`)
  }
}

if (problems.length > 0) {
  console.error('\nverification failed:')
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}

step('Done. Run /reload-plugins in a running session, or restart Claude Code.')
