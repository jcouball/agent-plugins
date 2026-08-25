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

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const targets = { x64: 'amd64', arm64: 'arm64' }
const target = `${platform()}_${targets[arch()] ?? arch()}`

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const fail = (message) => {
  console.error(`actionlint check failed: ${message}`)
  process.exit(1)
}

// One directory for everything this run writes: the binary, if it downloads
// one, and the pyflakes stub below. mkdtemp creates it atomically under a name
// no concurrent run holds, and the exit hook removes it whichever way this
// ends, `fail()` included. It sits under node_modules rather than the system
// temp directory because the binary has to be executable where it lands, and
// /tmp is mounted noexec on some hosts.
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

const versionOf = (binary) => {
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8' })
  if (result.status !== 0) return null
  return result.stdout.split('\n')[0].trim()
}

const download = async () => {
  if (!checksums[target]) {
    fail(
      `no pinned actionlint build for ${target}. ` +
        `Install actionlint ${version} yourself and put it on PATH: ` +
        'https://github.com/rhysd/actionlint/releases'
    )
  }

  const archive = `actionlint_${version}_${target}.tar.gz`
  const url = `https://github.com/rhysd/actionlint/releases/download/v${version}/${archive}`

  console.log(`downloading actionlint ${version} for ${target}`)

  let body
  try {
    const response = await fetch(url)
    if (!response.ok) fail(`GET ${url} returned ${response.status}`)
    body = Buffer.from(await response.arrayBuffer())
  } catch (error) {
    fail(`could not download ${url}: ${error.message}`)
  }

  const digest = createHash('sha256').update(body).digest('hex')
  if (digest !== checksums[target]) {
    fail(`checksum mismatch for ${archive}\n  expected ${checksums[target]}\n  got      ${digest}`)
  }

  const tarball = join(scratch, archive)
  writeFileSync(tarball, body)

  const untar = spawnSync('tar', ['-xzf', tarball, '-C', scratch], { encoding: 'utf8' })
  if (untar.status !== 0) fail(`could not extract ${archive}: ${untar.stderr ?? untar.error?.message}`)

  const extracted = join(scratch, 'actionlint')
  if (!existsSync(extracted)) fail(`${archive} did not contain an actionlint binary`)
  chmodSync(extracted, 0o755)

  return extracted
}

// Only an exact match. A different version would lint by different rules
// locally than CI enforces, which is the one thing pinning is for.
const actionlint = versionOf('actionlint') === version ? 'actionlint' : await download()

// actionlint lints the shell inside `run:` steps with shellcheck, and Python
// steps with pyflakes, but only when those commands are on PATH. Left silent,
// a machine without shellcheck passes a workflow that CI, which has it,
// rejects. Say so instead of letting the two disagree quietly.
const onPath = (command) => spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0

// pyflakes only ever runs on Python steps, so nagging about it in a repository
// that has none would be noise nobody reads. Which steps those are is a
// question about parsed YAML rather than about the text — a flow mapping can
// write `shell: python` mid-line, or split it across two — so rather than
// guess, hand actionlint a stub in place of the pyflakes it cannot find and
// let it answer. Nothing is lost by substituting it: with pyflakes missing
// those scripts go unchecked either way.
const args = []
let marker = null

// The stub is a `/bin/sh` script, so this probe is macOS and Linux only. A
// Windows host that installed actionlint by hand and lacks pyflakes therefore
// gets no notice — the shellcheck one above still reaches it. Closing that
// would mean an executable stub Windows can run and no way to test it from
// here, which is a poor trade for a platform nothing in this repository uses.
if (!onPath('pyflakes') && platform() !== 'win32') {
  marker = join(scratch, 'pyflakes-wanted')

  const stub = join(scratch, 'pyflakes-stub')
  writeFileSync(
    stub,
    // actionlint feeds the script in on stdin, so the stub has to drain it.
    `#!/bin/sh\ncat >/dev/null\ntouch '${marker.replaceAll("'", `'\\''`)}'\nexit 0\n`
  )
  chmodSync(stub, 0o755)
  args.push(`-pyflakes=${stub}`)
}

const result = spawnSync(actionlint, args, { cwd: root, stdio: 'inherit' })

const pythonWentUnchecked = marker !== null && existsSync(marker)

if (result.error) fail(result.error.message)

if (!onPath('shellcheck')) {
  console.warn(
    'note: shellcheck is not on PATH, so the shell in `run:` steps went unchecked.\n' +
      '      CI has it and will lint more than this run did. Packages for every\n' +
      '      platform: https://github.com/koalaman/shellcheck#installing'
  )
}

if (pythonWentUnchecked) {
  console.warn(
    'note: pyflakes is not on PATH, so the Python steps in these workflows went\n' +
      '      unchecked. Install it with: pip install pyflakes'
  )
}

// A signal kill leaves status null with no error set, and process.exit(null)
// exits 0. Without this the gate goes green on an actionlint that never ran to
// completion.
if (result.signal) fail(`actionlint was killed by ${result.signal}`)
if (result.status !== 0) process.exit(result.status)

console.log(`workflows ok: actionlint ${version} found no problems`)
