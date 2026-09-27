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
//
// Anchors are found the way GitHub makes them. The markdown is rendered to HTML
// by micromark, the CommonMark and GFM parser markdownlint uses; the HTML is
// parsed as a whole page by parse5, which builds the tree a browser would; and
// each h1-h6 in that tree, markdown or raw HTML, is slugged in document order
// by github-slugger, which follows GitHub's rules. Links are read from an mdast
// syntax tree of the same markdown, so nothing inside code is taken for one.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative as relativePath, isAbsolute, sep } from 'node:path'
import GithubSlugger, { slug as slugOnce } from 'github-slugger'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { micromark } from 'micromark'
import { frontmatter, frontmatterHtml } from 'micromark-extension-frontmatter'
import { gfm, gfmHtml } from 'micromark-extension-gfm'
import { parse as parseHtml } from 'parse5'
import { visit } from 'unist-util-visit'

const skip = new Set(['node_modules', '.git'])
// Claude Code puts git worktrees here; their markdown belongs to another branch.
const worktrees = join('.claude', 'worktrees')

// Symbolic links are not followed: GitHub shows a link's target path, not the
// file behind it, and following them could leave the repository or loop. The
// .md match is case-sensitive, like markdownlint's glob, so the two checks read
// the same files.
const markdownFiles = (directory, root = directory) => {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (skip.has(entry.name) || relativePath(root, path) === worktrees) continue
    if (entry.isDirectory()) found.push(...markdownFiles(path, root))
    else if (entry.isFile() && entry.name.endsWith('.md')) found.push(path)
  }
  return found
}

// YAML front matter renders as a table, not as markdown, so it is parsed as
// front matter rather than as a thematic break and a setext heading.
const parse = (text) =>
  fromMarkdown(text, {
    extensions: [gfm(), frontmatter(['yaml'])],
    mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(['yaml'])],
  })

// micromark numbers footnotes as GitHub does, drops unreferenced ones, and
// escapes the tags GFM's tag filter names. The ids it gives footnote markup
// carry this prefix, so they can be told apart from ids the author wrote.
const footnoteId = 'check-links-footnote-'

const render = (text) =>
  micromark(text, {
    allowDangerousHtml: true,
    extensions: [gfm(), frontmatter(['yaml'])],
    htmlExtensions: [gfmHtml({ clobberPrefix: footnoteId }), frontmatterHtml(['yaml'])],
  })

// The elements GitHub's sanitizer keeps, with their id and name attributes.
// Any other element is removed along with its attributes, but its children
// stay. scripts/probe-github-rendering.mjs checks this against GitHub.
export const keptElements = new Set(
  ('a b blockquote br code dd del details div dl dt em h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p ' +
    'picture pre q rp rt ruby s samp section source span strike strong sub summary sup ' +
    'table tbody td tfoot th thead tr tt ul var').split(' '),
)

const textOf = (node) => (node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(textOf).join(''))

// Every fragment a link into this markdown can name, in document order: the id
// of each element GitHub keeps, the name of each <a>, the slug of each heading,
// and #top, which GitHub always resolves to the top of the page.
//
// A heading's anchor follows the heading, as GitHub places it. A heading whose
// text slugs to nothing gets no anchor a link can name, not even a numbered one
// like -1, though it still counts toward the numbering. The footnotes section's
// own label is not a heading GitHub anchors.
export const anchorsIn = (text) => {
  const slugger = new GithubSlugger()
  const anchors = new Set(['top'])
  const walk = (node) => {
    if (keptElements.has(node.nodeName)) {
      for (const { name, value } of node.attrs) {
        if ((name === 'id' && !value.startsWith(footnoteId)) || (name === 'name' && node.nodeName === 'a')) anchors.add(value)
      }
    }
    const footnotes = node.nodeName === 'section' && node.attrs.some(({ name }) => name === 'data-footnotes')
    for (const child of node.childNodes ?? []) {
      if (!(footnotes && child.nodeName === 'h2')) walk(child)
    }
    if (/^h[1-6]$/.test(node.nodeName)) {
      const text = textOf(node)
      const slug = slugger.slug(text)
      if (slugOnce(text)) anchors.add(slug)
    }
  }
  // With scripting off, the contents of <noscript> are parsed as HTML, which is
  // how GitHub renders them.
  walk(parseHtml(render(text), { scriptingEnabled: false }))
  return anchors
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

const readmePattern = /^readme(?:\.|$)/i

// The README GitHub renders on a directory's page, which is where a fragment on
// a link to that directory lands. At the repository root GitHub looks in
// .github, the root, and docs, in that order. README.md wins over a translation
// such as README.ja.md beside it. Undefined when the directory has no README.
const readmeOf = (directory, root) => {
  const places = resolve(directory) === resolve(root) ? [join(root, '.github'), root, join(root, 'docs')] : [directory]
  for (const place of places) {
    if (!existsSync(place) || !statSync(place).isDirectory()) continue
    const names = readdirSync(place, { withFileTypes: true })
      .filter((entry) => entry.isFile() && readmePattern.test(entry.name))
      .map((entry) => entry.name)
      .sort()
    const name = names.find((entry) => entry.toLowerCase() === 'readme.md') ?? names[0]
    if (name) return join(place, name)
  }
}

// The schemes GitHub keeps a link for. It strips the href from any other, so a
// link using one goes nowhere. scripts/probe-github-rendering.mjs checks this
// against GitHub.
export const keptSchemes = new Set(['http', 'https', 'mailto', 'xmpp', 'github-windows', 'github-mac'])

// GitHub renders an id as user-content-<id> and has the page map #<id> onto it,
// so a link may name either.
export const userContent = 'user-content-'

// Every broken relative link in the markdown under root, and how many relative
// links were checked. Links, images, and reference definitions are read from
// the syntax tree, so nothing inside code is taken for a link.
export function checkLinks(root) {
  const broken = []
  let checked = 0

  // Each file is read once, whether it is linked from, linked to, or both.
  const sources = new Map()
  const sourceOf = (file) => {
    if (!sources.has(file)) sources.set(file, readFileSync(file, 'utf8'))
    return sources.get(file)
  }
  const anchors = new Map()
  const anchorsOf = (file) => {
    if (!anchors.has(file)) anchors.set(file, anchorsIn(sourceOf(file)))
    return anchors.get(file)
  }

  for (const file of markdownFiles(root)) {
    visit(parse(sourceOf(file)), ['link', 'image', 'definition'], (node) => {
      const target = node.url

      if (target === '') return
      // MD051 owns same-file fragments.
      if (target.startsWith('#')) return
      // A protocol-relative URL names another host, like any external link.
      if (target.startsWith('//')) return

      // Returns nothing on purpose: a number returned to visit is an index to
      // resume at, and push returns one.
      const report = (why) => {
        broken.push(`${relativePath(root, file)}: ${target}${why ? ` (${why})` : ''}`)
      }

      const scheme = /^([a-z][a-z\d+.-]*):/i.exec(target)?.[1].toLowerCase()
      if (keptSchemes.has(scheme)) return
      checked += 1
      if (scheme) return report(`GitHub removes ${scheme}: links`)

      const hash = target.indexOf('#')
      const beforeHash = hash === -1 ? target : target.slice(0, hash)
      const question = beforeHash.indexOf('?')
      const path = safeDecode(question === -1 ? beforeHash : beforeHash.slice(0, question))
      const query = new URLSearchParams(question === -1 ? '' : beforeHash.slice(question + 1))
      const fragment = hash === -1 ? '' : safeDecode(target.slice(hash + 1))

      if (path === null || fragment === null) return report('invalid percent-encoding')

      // A link with only a query string stays on this page.
      const resolved = path === '' ? file : path.startsWith('/') ? join(root, path) : resolve(dirname(file), path)
      // GitHub serves nothing above the repository root, whatever sits there on
      // this machine.
      const fromRoot = relativePath(root, resolved)
      if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return report('outside the repository')
      if (!existsSync(resolved)) return report()

      // The file resolves; the fragment has to name a heading in it. Renaming a
      // guide heading is a breaking change to every document that cites it, and
      // this is what catches it.
      if (!fragment) return
      // ?plain=1 shows the source, where the fragment names a line, not a heading.
      if (query.get('plain') === '1') return

      let rendered = resolved
      if (statSync(resolved).isDirectory()) {
        rendered = readmeOf(resolved, root)
        if (!rendered) return report('no README to hold the heading')
      }
      // Only markdown is parsed here; a fragment into anything else is not checked.
      if (!rendered.toLowerCase().endsWith('.md')) return
      const known = anchorsOf(rendered)
      const unprefixed = fragment.startsWith(userContent) ? fragment.slice(userContent.length) : null
      if (!known.has(fragment) && !(unprefixed && unprefixed !== 'top' && known.has(unprefixed))) {
        report('no such heading')
      }
    })
  }
  return { broken, checked }
}
