#!/usr/bin/env node
//
// Verify that relative markdown links point at files that exist.
//
// Only local links are checked. Reaching out to external URLs would make the
// check slow, flaky, and dependent on the network, and the links that actually
// rot here are the ones naming files in this repository.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative as relativePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skip = new Set(['node_modules', '.git'])
const broken = []
let checked = 0

const markdownFiles = (directory) => {
  const found = []
  for (const name of readdirSync(directory)) {
    if (skip.has(name)) continue
    const path = join(directory, name)
    if (statSync(path).isDirectory()) found.push(...markdownFiles(path))
    else if (name.endsWith('.md')) found.push(path)
  }
  return found
}

for (const file of markdownFiles(root)) {
  // Fenced code blocks are examples, not links. Blank them out rather than
  // removing them so nothing downstream depends on line numbers.
  const body = readFileSync(file, 'utf8').replace(/^```[\s\S]*?^```/gm, '')

  for (const match of body.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1]

    if (/^(https?|mailto|tel):/i.test(target)) continue
    if (target.startsWith('#')) continue

    checked += 1

    let path
    try {
      path = decodeURIComponent(target.split('#')[0])
    } catch {
      // A stray % makes the link invalid. That is worth reporting alongside
      // every other broken link, not worth crashing the whole check over.
      broken.push(`${relativePath(root, file)}: ${target} (invalid percent-encoding)`)
      continue
    }

    if (path === '') continue

    const resolved = path.startsWith('/')
      ? join(root, path)
      : resolve(dirname(file), path)

    if (!existsSync(resolved)) {
      broken.push(`${relativePath(root, file)}: ${target}`)
    }
  }
}

if (broken.length > 0) {
  console.error('link check failed:')
  for (const link of broken) console.error(`  ${link}`)
  process.exit(1)
}

console.log(`links ok: ${checked} local link(s) checked`)
