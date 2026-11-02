// The work of check-actions.mjs: find an actionlint of the pinned version, or
// download it, and lint the workflows with it. The script supplies everything
// outside this repository: the pin, the platform, `fetch`, the function that
// runs a command (`spawn`, as spawnSync is called) and the one that downloads
// the release (`download`, as downloadActionlint is), the directory this run
// may write to, and where the output goes. Cleaning that directory up, on exit
// or on a signal, is the script's, since it is the process's.

import { chmodSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Ends the run with this exit code, after the message for it was written.
class Stop extends Error {
  constructor(code) {
    super(`exit ${code}`)
    this.code = code
  }
}

// Returns the exit code.
export async function checkActions({
  version,
  checksums,
  root,
  platform,
  arch,
  fetch,
  spawn,
  download,
  scratch,
  stdout,
  stderr,
}) {
  const fail = (message) => {
    stderr.write(`actionlint check failed: ${message}\n`)
    throw new Stop(1)
  }

  const versionOf = (binary) => {
    const result = spawn(binary, ['--version'], { encoding: 'utf8' })
    if (result.status !== 0) return null
    return result.stdout.split('\n')[0].trim()
  }

  const downloaded = async () => {
    try {
      return await download({
        version,
        checksums,
        platform,
        arch,
        fetch,
        tar: 'tar',
        directory: scratch,
        log: (message) => stdout.write(`${message}\n`),
      })
    } catch (error) {
      return fail(error.message)
    }
  }

  // Only an exact match. A different version would lint by different rules
  // locally than CI enforces, which is the one thing pinning is for.
  const locate = async () => (versionOf('actionlint') === version ? 'actionlint' : downloaded())

  try {
    const actionlint = await locate()

    // actionlint lints the shell inside `run:` steps with shellcheck, and Python
    // steps with pyflakes, but only when those commands are on PATH. Left silent,
    // a machine without shellcheck passes a workflow that CI, which has it,
    // rejects. Say so instead of letting the two disagree quietly.
    const onPath = (command) => spawn(command, ['--version'], { encoding: 'utf8' }).status === 0

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
    if (!onPath('pyflakes') && platform !== 'win32') {
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

    const result = spawn(actionlint, args, { cwd: root, stdio: 'inherit' })

    const pythonWentUnchecked = marker !== null && existsSync(marker)

    // A binary that vanished between the version check and here never ran, which
    // leaves status null and, without this, exits 0 below.
    if (result.error) fail(result.error.message)

    if (!onPath('shellcheck')) {
      stderr.write(
        'note: shellcheck is not on PATH, so the shell in `run:` steps went unchecked.\n' +
          '      CI has it and will lint more than this run did. Packages for every\n' +
          '      platform: https://github.com/koalaman/shellcheck#installing\n'
      )
    }

    if (pythonWentUnchecked) {
      stderr.write(
        'note: pyflakes is not on PATH, so the Python steps in these workflows went\n' +
          '      unchecked. Install it with: pip install pyflakes\n'
      )
    }

    // A signal kill leaves status null with no error set, and an exit code of
    // null is 0. Without this the gate goes green on an actionlint that never
    // ran to completion.
    if (result.signal) fail(`actionlint was killed by ${result.signal}`)
    if (result.status !== 0) throw new Stop(result.status)

    stdout.write(`workflows ok: actionlint ${version} found no problems\n`)
    return 0
  } catch (error) {
    if (error instanceof Stop) return error.code
    throw error
  }
}
