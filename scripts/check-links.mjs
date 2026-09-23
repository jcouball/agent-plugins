#!/usr/bin/env node
//
// Verify that relative markdown links point at files that exist, and that a
// link carrying a #fragment names a heading that file actually has.
//
// Only local links are checked. Reaching out to external URLs would make the
// check slow, flaky, and dependent on the network, and the links that actually
// rot here are the ones naming files in this repository.
//
// Same-file `#fragment` links are left alone: markdownlint's MD051 is enabled
// here and already checks those, against its own slugger. Two checkers
// disagreeing about one link is worse than one checking it, so this script
// covers only what MD051 does not, which is a fragment on a link to another
// file.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative as relativePath } from 'node:path'
import { fileURLToPath } from 'node:url'

// .claude holds git worktrees, whose markdown belongs to another branch.
const skip = new Set(['node_modules', '.git', '.claude'])

const markdownFiles = (directory) => {
  const found = []
  for (const name of readdirSync(directory)) {
    if (skip.has(name)) continue
    const path = join(directory, name)
    if (statSync(path).isDirectory()) found.push(...markdownFiles(path))
    else if (name.toLowerCase().endsWith('.md')) found.push(path)
  }
  return found
}

// A stray % makes a link invalid. That is worth reporting alongside every other
// broken link, not worth crashing the whole check over, so every decode goes
// through here.
function safeDecode(text) {
  try {
    return decodeURIComponent(text)
  } catch {
    return null
  }
}

// Blank out fenced code blocks: they hold examples, not links or headings.
// Fences are tracked line by line rather than matched as a pair, because these
// files document markdown by nesting fences, and a regex pairing them
// positionally deletes real text as soon as the count is odd. A fence opens
// with three or more backticks or tildes and closes with at least as many of
// the same character and no info string. Lines are split on CRLF as well as LF,
// since a Windows checkout has CRLF, and the text comes back with LF only.
function stripFences(text) {
  const lines = text.split(/\r?\n/)
  let fence = null
  return lines
    .map((line) => {
      const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
      if (fence === null) {
        if (match && !(match[1][0] === '`' && match[2].includes('`'))) {
          fence = match[1]
          return ''
        }
        return line
      }
      if (match && match[1][0] === fence[0] && match[1].length >= fence.length && match[2].trim() === '') {
        fence = null
      }
      return ''
    })
    .join('\n')
}

// The text a heading renders to, which is what GitHub slugs: a link or image
// becomes its text, an autolink its URL, and emphasis loses its delimiters.
// Code spans and backslash escapes are literal, so they are set aside first and
// put back after.
function renderedText(heading) {
  const literals = []
  const hold = (text) => `\u0000${literals.push(text) - 1}\u0000`
  return heading
    .replace(/(`+)(.+?)\1/g, (_, ticks, code) => hold(code))
    .replace(/\\([!-/:-@[-`{-~])/g, (_, char) => hold(char))
    .replace(/<((?:https?|mailto):[^>\s]*)>/g, (_, url) => hold(url))
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    .replace(/!?\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])/g, '$1')
    .replace(/(^|[^\p{L}\p{N}_])(_+)(?=\S)(.*?\S)\2(?=[^\p{L}\p{N}_]|$)/gu, '$1$3')
    .replace(/\u0000(\d+)\u0000/g, (_, index) => literals[index])
}

// GitHub's heading slug: the rendered text lowercased, spaces to hyphens,
// everything that is not a letter, number, hyphen or underscore removed.
// Letters and numbers are matched by Unicode property, so an accented or
// non-Latin heading keeps its characters the way GitHub keeps them.
export function slugify(heading) {
  return renderedText(heading)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\- _]+/gu, '')
    .replace(/ /g, '-')
}

// A line that can only be paragraph text: not blank, and not the start of a
// heading, list item, block quote, table row, or indented code block. A setext
// underline turns such a run of lines into a heading; after anything else, a
// line of dashes is a thematic break and makes no heading.
const paragraphLine = (line) =>
  line !== undefined &&
  line.trim() !== '' &&
  !/^ {4}|^\t/.test(line) &&
  !/^ {0,3}(=+|-+|([-*_])([ \t]*\2){2,})[ \t]*$/.test(line) &&
  !/^ {0,3}(#|>|\||[-*+][ \t]|\d{1,9}[.)][ \t])/.test(line)

// YAML front matter renders as a table, not as headings, so its closing ---
// must not turn the line above it into one.
function stripFrontMatter(text) {
  const match = /^---\r?\n[\s\S]*?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  return match ? '\n'.repeat(match[0].split('\n').length - 1) + text.slice(match[0].length) : text
}

// A line split into its block quote depth and the text inside the quote, so a
// heading inside a quote gets an anchor like any other.
function unquote(line) {
  const markers = /^( {0,3}>[ \t]?)*/.exec(line)[0]
  return { depth: (markers.match(/>/g) ?? []).length, text: line.slice(markers.length) }
}

// An ATX heading, which may also open a list item. Setext headings inside a list
// item, and headings on a list item's continuation lines, are not recognized.
const atxHeading = /^ {0,3}(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*#{1,6}[ \t]+(.+?)[ \t]*#*\s*$/

// Every fragment a link into this markdown can name: the slug of each heading,
// the id or name of each HTML element that sets one, and #top, which GitHub
// always resolves to the top of the page.
export function anchorsIn(text) {
  const body = stripFences(stripFrontMatter(text))
  const lines = body.split('\n').map(unquote)
  const headings = []
  for (const [index, { depth, text }] of lines.entries()) {
    const atx = atxHeading.exec(text)
    if (atx) {
      headings.push(atx[1])
      continue
    }
    // Setext: a paragraph underlined with = or -. The heading is the whole
    // paragraph, which may run over several lines, all at the underline's quote
    // depth: an unquoted underline after a quote is a thematic break.
    const inParagraph = (line) => line?.depth === depth && paragraphLine(line.text)
    if (!/^ {0,3}(=+|-+)\s*$/.test(text) || !inParagraph(lines[index - 1])) continue
    let start = index - 1
    while (inParagraph(lines[start - 1])) start -= 1
    headings.push(lines.slice(start, index).map((line) => line.text.trim()).join(' '))
  }
  // Duplicates are numbered the way GitHub's slugger numbers them: a slug
  // already taken, whether by a heading or by an earlier numbered duplicate,
  // gets the next free -n suffix. So Foo, Foo, Foo 1 gives foo, foo-1, foo-1-1.
  const counts = new Map()
  const anchors = new Set(['top'])
  for (const heading of headings) {
    const base = slugify(heading)
    if (!base) continue
    let slug = base
    while (counts.has(slug)) {
      counts.set(base, counts.get(base) + 1)
      slug = `${base}-${counts.get(base)}`
    }
    counts.set(slug, 0)
    anchors.add(slug)
  }
  for (const match of body.matchAll(/<[A-Za-z][^>]*?\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    anchors.add(match[1] ?? match[2])
  }
  return anchors
}

// Every broken relative link in the markdown under root, and how many relative
// links were checked.
export function checkLinks(root) {
  const broken = []
  let checked = 0
  const anchorCache = new Map()
  const anchorExists = (file, fragment) => {
    if (!anchorCache.has(file)) anchorCache.set(file, anchorsIn(readFileSync(file, 'utf8')))
    return anchorCache.get(file).has(fragment)
  }

  for (const file of markdownFiles(root)) {
    const body = stripFences(readFileSync(file, 'utf8'))

    for (const match of body.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1]

      if (/^(https?|mailto|tel):/i.test(target)) continue
      // MD051 owns same-file fragments.
      if (target.startsWith('#')) continue

      checked += 1

      const hash = target.indexOf('#')
      const path = safeDecode(hash === -1 ? target : target.slice(0, hash))
      const fragment = hash === -1 ? '' : safeDecode(target.slice(hash + 1))

      if (path === null || fragment === null) {
        broken.push(`${relativePath(root, file)}: ${target} (invalid percent-encoding)`)
        continue
      }

      const resolved = path.startsWith('/') ? join(root, path) : resolve(dirname(file), path)

      if (!existsSync(resolved)) {
        broken.push(`${relativePath(root, file)}: ${target}`)
        continue
      }

      // The file resolves; the fragment has to name a heading in it. Renaming a
      // guide heading is a breaking change to every document that cites it, and
      // this is what catches it.
      if (!fragment) continue
      if (!statSync(resolved).isFile() || !resolved.toLowerCase().endsWith('.md')) continue
      if (!anchorExists(resolved, fragment)) {
        broken.push(`${relativePath(root, file)}: ${target} (no such heading)`)
      }
    }
  }
  return { broken, checked }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { broken, checked } = checkLinks(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
  if (broken.length > 0) {
    console.error('link check failed:')
    for (const link of broken) console.error(`  ${link}`)
    process.exit(1)
  }
  console.log(`links ok: ${checked} cross-file link(s) checked`)
}
