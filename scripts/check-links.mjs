#!/usr/bin/env node
//
// Run the link check on this repository. The check itself lives in
// lib/check-links.mjs, which runs nothing on import, so tests can load it and
// this file needs no test for whether it was run directly.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkLinks } from './lib/check-links.mjs'

const { broken, checked } = checkLinks(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
if (broken.length > 0) {
  console.error('link check failed:')
  for (const link of broken) console.error(`  ${link}`)
  process.exit(1)
}
console.log(`links ok: ${checked} cross-file link(s) checked`)
