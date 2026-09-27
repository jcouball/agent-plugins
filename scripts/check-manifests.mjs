#!/usr/bin/env node
//
// Run the manifest check on this repository. The check itself lives in
// lib/check-manifests.mjs, which runs nothing on import, so tests can load it
// and this file needs no test for whether it was run directly.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkManifests } from './lib/check-manifests.mjs'

const { errors, plugins } = checkManifests(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
if (errors.length > 0) {
  console.error('manifest check failed:')
  for (const error of errors) console.error(`  ${error}`)
  process.exit(1)
}
console.log(`manifests ok: ${plugins} plugin(s) checked`)
