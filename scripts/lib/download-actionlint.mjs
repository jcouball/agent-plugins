// Fetch the pinned actionlint release, check it against a checksum recorded in
// the caller, and unpack it. Everything that varies is a parameter, so a test
// can supply an archive it built, a fetch that fails, or a platform nothing is
// pinned for, and the pin itself is never overridden.

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const architectures = { x64: 'amd64', arm64: 'arm64' }

// The path of the unpacked actionlint binary in `directory`. Throws an Error
// whose message says what went wrong, for the caller to report.
//
// `checksums` maps `<platform>_<architecture>` to the sha256 of the release
// archive. `tar` is the command that unpacks it, and `log` is told what is
// being downloaded.
export async function downloadActionlint({ version, checksums, platform, arch, fetch, tar, directory, log }) {
  const target = `${platform}_${architectures[arch] ?? arch}`

  if (!checksums[target]) {
    throw new Error(
      `no pinned actionlint build for ${target}. ` +
        `Install actionlint ${version} yourself and put it on PATH: ` +
        'https://github.com/rhysd/actionlint/releases'
    )
  }

  const archive = `actionlint_${version}_${target}.tar.gz`
  const url = `https://github.com/rhysd/actionlint/releases/download/v${version}/${archive}`

  log(`downloading actionlint ${version} for ${target}`)

  const couldNotDownload = (error) => new Error(`could not download ${url}: ${error.message}`)

  let response
  try {
    response = await fetch(url)
  } catch (error) {
    throw couldNotDownload(error)
  }
  if (!response.ok) throw new Error(`GET ${url} returned ${response.status}`)

  let body
  try {
    body = Buffer.from(await response.arrayBuffer())
  } catch (error) {
    throw couldNotDownload(error)
  }

  const digest = createHash('sha256').update(body).digest('hex')
  if (digest !== checksums[target]) {
    throw new Error(`checksum mismatch for ${archive}\n  expected ${checksums[target]}\n  got      ${digest}`)
  }

  const tarball = join(directory, archive)
  writeFileSync(tarball, body)

  const untar = spawnSync(tar, ['-xzf', tarball, '-C', directory], { encoding: 'utf8' })
  if (untar.status !== 0) throw new Error(`could not extract ${archive}: ${untar.stderr ?? untar.error?.message}`)

  const extracted = join(directory, 'actionlint')
  if (!existsSync(extracted)) throw new Error(`${archive} did not contain an actionlint binary`)
  chmodSync(extracted, 0o755)

  return extracted
}
