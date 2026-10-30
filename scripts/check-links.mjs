#!/usr/bin/env node
//
// Run the link check on this repository, or on the directory given as the
// first argument, which is how a test points it at a fixture. The check itself
// lives in lib/check-links.mjs, which runs nothing on import, so tests can load
// it and this file needs no test for whether it was run directly.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkLinks } from './lib/check-links.mjs'

const root = process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { broken, checked } = checkLinks(root)
if (broken.length > 0) {
  console.error('link check failed:')
  for (const link of broken) console.error(`  ${link}`)
  process.exit(1)
}
console.log(`links ok: ${checked} cross-file link(s) checked`)
