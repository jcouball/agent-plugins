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

  // A title may follow the destination in double quotes, single quotes, or
  // parentheses. Both checks here accept the same three, so a link neither
  // resolves nor reports cannot slip between them.
  for (const match of body.matchAll(/!?\[[^\]]*\]\((<[^<>\n]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\)/g)) {
    // A destination may be wrapped in angle brackets, which are delimiters
    // rather than part of the path, and inside them it may hold spaces. The
    // whitespace check below treats that form as legal, so it has to be matched
    // and resolved here, brackets stripped, or a broken one is checked by
    // neither.
    const target = match[1].replace(/^<(.*)>$/, '$1')

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

  // A destination split across a line break is not a link. Markdown renders it
  // as literal text, the pattern above does not match it because the pattern
  // excludes whitespace, and markdownlint's MD051 has no link to check the
  // fragment of. Nothing sees it, which is how a broken one reaches main.
  //
  // So look for the shape rather than the target: a label, `(`, and whitespace
  // running to the closing `)`. Inline code is blanked first, at its own
  // length, so an example written in backticks is not reported as a link.
  const prose = body.replace(/`+[^`]*`+/g, (span) => ' '.repeat(span.length))

  // One level of parentheses inside, for a title written in them; the closing
  // one is otherwise taken for the end of the link.
  for (const match of prose.matchAll(/!?\[[^\]]*\]\(((?:[^()]|\([^()]*\))*)\)/g)) {
    const target = match[1]

    // `<a destination in angle brackets>` may hold spaces but not a line
    // break, and either form of destination may be followed by a title.
    // Everything else with whitespace in it is the broken shape.
    if (!/\s/.test(target)) continue
    if (/^(<[^<>\n]*>|[^\s<]\S*)(\s+("[^"]*"|'[^']*'|\([^()]*\)))?$/.test(target)) continue

    const shown = match[0].replace(/\s+/g, ' ')
    broken.push(`${relativePath(root, file)}: ${shown} (destination is not a link)`)
  }
}

if (broken.length > 0) {
  console.error('link check failed:')
  for (const link of broken) console.error(`  ${link}`)
  process.exit(1)
}

console.log(`links ok: ${checked} local link(s) checked`)
