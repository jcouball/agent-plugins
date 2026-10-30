// A stand-in for `gh api markdown --input -`, run by the fake gh that
// probe-github-rendering.test.mjs puts on PATH. It reads the request, finds
// what the probe asked about, and answers the way GitHub would if it agreed
// with the link check's assumptions, built from the same exports the probe
// compares against. FAKE_GH is JSON that makes it disagree: `elements` and
// `schemes` replace the sets GitHub keeps, and `cases` maps a case name to the
// anchors GitHub renders for it. A case with a footnote also gets the footnote
// ids GitHub renders.

import { readFileSync } from 'node:fs'
import { anchorCases, headingCases } from './check-links.cases.mjs'
import { keptElements, keptSchemes, userContent } from './lib/check-links.mjs'

const { text } = JSON.parse(readFileSync(0, 'utf8'))
const { elements = [...keptElements], schemes = [...keptSchemes], cases = {} } = JSON.parse(process.env.FAKE_GH ?? '{}')

// The probe sends a case's markdown with its front matter removed.
const withoutFrontMatter = (markdown) => markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
const anchors = new Map(
  [...headingCases, ...anchorCases].map(([name, markdown, expected]) => [withoutFrontMatter(markdown), cases[name] ?? expected]),
)

const probed = (pattern) => [...text.matchAll(pattern)].map((match) => match[1])

let html
if (text.includes('id="probe-')) {
  html = probed(/id="probe-([a-z0-9]+)"/g)
    .filter((element) => elements.includes(element))
    .map((element) => `<p id="${userContent}probe-${element}">x</p>`)
    .join('\n')
} else if (text.includes(':x)')) {
  html = probed(/\[([a-z-]+)\]\(\1:x\)/g)
    .filter((scheme) => schemes.includes(scheme))
    .map((scheme) => `<a href="${scheme}:x">${scheme}</a>`)
    .join('\n')
} else {
  // An anchor the markdown names with a name attribute renders as an <a name>.
  const named = (anchor) => text.includes(`name="${anchor}"`) || text.includes(`name='${anchor}'`)
  html = anchors
    .get(text)
    .map((anchor) =>
      named(anchor) ? `<a name="${userContent}${anchor}"></a>` : `<h1 id="${userContent}${anchor}">x</h1>`,
    )
    .join('\n')
  // GitHub gives a footnote's reference and definition ids of their own, which
  // the probe leaves out of the anchors it compares.
  if (text.includes('[^')) html += `\n<sup id="${userContent}fnref-1">1</sup>\n<li id="${userContent}fn-1">x</li>`
}
process.stdout.write(html)
