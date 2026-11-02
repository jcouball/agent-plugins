#!/usr/bin/env node
//
// Lint the GitHub Actions workflows with actionlint.
//
// actionlint is a Go binary, not an npm package, so this script fetches the
// pinned official release, checks it against a checksum recorded below, and
// runs it out of a directory it deletes on the way out. That keeps the
// repository free of dependencies it cannot audit and lets `npm run ci` work
// on a fresh clone with nothing installed by hand.
//
// A copy already on PATH is used when it reports the pinned version, so a
// maintainer who installed actionlint by hand pays no download. Everyone else
// downloads once per run.
//
// Nothing is kept between runs on purpose. A cache would have to be keyed by
// version and platform both, and populated without two runs racing to fill it,
// and it would earn nothing here: CI deletes node_modules before every job, and
// a maintainer with actionlint installed never reads it.
//
// The download covers macOS and Linux on x64 and arm64, which is every machine
// this repository is worked on. Anything else is told which build it wanted and
// left to install actionlint itself and put it on PATH: Windows, because it
// ships a zip rather than a tarball, and 32-bit or armv6 Linux, because upstream
// publishes those but no checksum for them is pinned below.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkActions } from './lib/check-actions.mjs'
import { downloadActionlint } from './lib/download-actionlint.mjs'

const version = '1.7.12'

// From actionlint_<version>_checksums.txt in the release. Pinning them here
// rather than downloading the checksum file means the archive is checked
// against something that was reviewed, not against a second unverified fetch.
const checksums = {
  'darwin_amd64': '5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644',
  'darwin_arm64': 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
  'linux_amd64': '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
  'linux_arm64': '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6',
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// One directory for everything this run writes: the binary, if it downloads
// one, and the pyflakes stub below. mkdtemp creates it atomically under a name
// no concurrent run holds, and the exit hook removes it whichever way this
// ends. It sits under node_modules rather than the system temp directory
// because the binary has to be executable where it lands, and /tmp is mounted
// noexec on some hosts.
const parent = join(root, 'node_modules', '.cache', 'actionlint')
mkdirSync(parent, { recursive: true })
const scratch = mkdtempSync(join(parent, 'run.'))
const clean = () => rmSync(scratch, { recursive: true, force: true })
process.on('exit', clean)

// An `exit` handler does not run when a signal ends the process, and stopping
// a run with Ctrl-C is ordinary rather than exceptional. Clean up on the way
// out and report the status a shell expects, 128 plus the signal number.
// SIGKILL cannot be caught, so that one still leaves the directory behind.
for (const [name, number] of Object.entries({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 })) {
  process.on(name, () => {
    clean()
    process.exit(128 + number)
  })
}

process.exitCode = await checkActions({
  version,
  checksums,
  root,
  platform: platform(),
  arch: arch(),
  fetch,
  spawn: spawnSync,
  download: downloadActionlint,
  scratch,
  stdout: process.stdout,
  stderr: process.stderr,
})
