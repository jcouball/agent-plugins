// Tests for the actionlint download. The archive is one the test builds, and
// the checksums it passes name that archive, so the download is checked
// against a pin without needing a release whose hash is known in advance.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadActionlint } from './lib/download-actionlint.mjs'

const version = '1.2.3'

// A gzipped tarball holding the given files.
const archiveOf = (files) => {
  const base = mkdtempSync(join(tmpdir(), 'download-actionlint-'))
  try {
    mkdirSync(join(base, 'content'))
    for (const [name, text] of Object.entries(files)) writeFileSync(join(base, 'content', name), text)
    execFileSync('tar', ['-czf', join(base, 'archive.tgz'), '-C', join(base, 'content'), ...Object.keys(files)])
    return readFileSync(join(base, 'archive.tgz'))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

const sha256 = (body) => createHash('sha256').update(body).digest('hex')
const respond = (body) => async () => ({ ok: true, status: 200, arrayBuffer: async () => body })

// Run the download for linux on x64 with a fetch and checksums that agree on
// `body`, changed by `overrides`. Returns what it resolved or rejected with,
// and what it was told.
const download = async (body, overrides = {}) => {
  const directory = mkdtempSync(join(tmpdir(), 'download-actionlint-'))
  const requests = []
  const logs = []
  try {
    const options = {
      version,
      checksums: { linux_amd64: sha256(body) },
      platform: 'linux',
      arch: 'x64',
      fetch: async (url) => {
        requests.push(url)
        return respond(body)(url)
      },
      tar: 'tar',
      directory,
      log: (message) => logs.push(message),
      ...overrides,
    }
    const outcome = await downloadActionlint(options).then(
      (path) => ({ path, mode: statSync(path).mode & 0o777, content: readFileSync(path, 'utf8') }),
      (error) => ({ error }),
    )
    return { ...outcome, requests, logs, directory }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('unpacks the binary from an archive that matches its checksum', async () => {
  const body = archiveOf({ actionlint: '#!/bin/sh\n' })
  const result = await download(body)
  assert.equal(result.error, undefined)
  assert.equal(result.content, '#!/bin/sh\n')
  assert.equal(result.mode, 0o755)
  assert.deepEqual(result.requests, [
    `https://github.com/rhysd/actionlint/releases/download/v${version}/actionlint_${version}_linux_amd64.tar.gz`,
  ])
  assert.deepEqual(result.logs, [`downloading actionlint ${version} for linux_amd64`])
})

test('maps arm64 to the name the release uses, and leaves other architectures as they are', async () => {
  const body = archiveOf({ actionlint: 'x' })
  const arm = await download(body, { arch: 'arm64', checksums: { linux_arm64: sha256(body) } })
  assert.equal(arm.error, undefined)
  const other = await download(body, { arch: 'ia32' })
  assert.match(other.error.message, /^no pinned actionlint build for linux_ia32\. Install actionlint 1\.2\.3 yourself/)
})

test('refuses a platform nothing is pinned for, before it downloads anything', async () => {
  const result = await download(archiveOf({ actionlint: 'x' }), { platform: 'win32' })
  assert.match(result.error.message, /^no pinned actionlint build for win32_amd64\./)
  assert.deepEqual(result.requests, [])
  assert.deepEqual(result.logs, [])
})

test('reports a request that fails', async () => {
  const result = await download(archiveOf({ actionlint: 'x' }), {
    fetch: async () => {
      throw new Error('getaddrinfo ENOTFOUND github.com')
    },
  })
  assert.match(result.error.message, /^could not download https:\/\/.*actionlint_1\.2\.3_linux_amd64\.tar\.gz: getaddrinfo ENOTFOUND github\.com$/)
})

test('reports a response that is not ok', async () => {
  const result = await download(archiveOf({ actionlint: 'x' }), { fetch: async () => ({ ok: false, status: 404 }) })
  assert.match(result.error.message, /^GET https:\/\/.*actionlint_1\.2\.3_linux_amd64\.tar\.gz returned 404$/)
})

test('reports a body that cannot be read', async () => {
  const result = await download(archiveOf({ actionlint: 'x' }), {
    fetch: async () => ({
      ok: true,
      arrayBuffer: async () => {
        throw new Error('terminated')
      },
    }),
  })
  assert.match(result.error.message, /^could not download https:\/\/.*: terminated$/)
})

test('reports an archive whose checksum differs from the pin', async () => {
  const body = archiveOf({ actionlint: 'x' })
  const result = await download(body, { checksums: { linux_amd64: sha256('something else') } })
  assert.equal(
    result.error.message,
    `checksum mismatch for actionlint_${version}_linux_amd64.tar.gz\n  expected ${sha256('something else')}\n  got      ${sha256(body)}`,
  )
})

test('reports an archive that matches its checksum but cannot be unpacked', async () => {
  const result = await download(Buffer.from('not a tarball'))
  assert.match(result.error.message, /^could not extract actionlint_1\.2\.3_linux_amd64\.tar\.gz: [\s\S]*\S/)
})

test('reports an unpack command that cannot run', async () => {
  const result = await download(archiveOf({ actionlint: 'x' }), { tar: 'no-such-unpack-command' })
  assert.match(result.error.message, /^could not extract actionlint_1\.2\.3_linux_amd64\.tar\.gz: .*ENOENT/)
})

test('reports an archive with no actionlint binary in it', async () => {
  const result = await download(archiveOf({ README: 'x' }))
  assert.equal(result.error.message, `actionlint_${version}_linux_amd64.tar.gz did not contain an actionlint binary`)
})
