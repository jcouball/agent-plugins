// The work of probe-github-rendering.mjs: compare what the link check assumes
// about GitHub's rendering with what GitHub renders. `render` turns markdown
// into the HTML GitHub shows for it, or rejects with an error that may carry
// the stderr of the gh that failed. The script supplies the real one.

import { parse } from 'parse5'
import { anchorCases, headingCases } from '../check-links.cases.mjs'
import { keptElements, keptSchemes, userContent } from './check-links.mjs'

// The markdown API reads front matter as markdown, where a page shows it as a
// table that holds no anchors, so it is removed before rendering.
const withoutFrontMatter = (text) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')

// A few renders at a time, to stay clear of GitHub's secondary rate limits.
const renderAll = async (render, texts) => {
  const results = []
  for (let i = 0; i < texts.length; i += 8) {
    results.push(...(await Promise.all(texts.slice(i, i + 8).map((text) => render(withoutFrontMatter(text))))))
  }
  return results
}

// The fragments a link can name in rendered HTML, in document order. Footnote
// ids are left out; the link check does not claim them.
const anchorsInHtml = (html) => {
  const found = ['top']
  const walk = (node) => {
    for (const { name, value } of node.attrs ?? []) {
      if ((name === 'id' || (name === 'name' && node.nodeName === 'a')) && value.startsWith(userContent)) {
        const anchor = value.slice(userContent.length)
        if (!/^fn(ref)?-/.test(anchor)) found.push(anchor)
      }
    }
    for (const child of node.childNodes ?? []) walk(child)
  }
  walk(parse(html))
  return found
}

// Every element HTML defines, with the parent each needs for a browser's parser
// to keep it.
const parents = {
  area: 'map',
  caption: 'table',
  col: 'table><colgroup',
  colgroup: 'table',
  dd: 'dl',
  dt: 'dl',
  figcaption: 'figure',
  legend: 'fieldset',
  li: 'ul',
  optgroup: 'select',
  option: 'select',
  rp: 'ruby',
  rt: 'ruby',
  source: 'video',
  summary: 'details',
  tbody: 'table',
  td: 'table><tbody><tr',
  tfoot: 'table',
  th: 'table><tbody><tr',
  thead: 'table',
  tr: 'table><tbody',
  track: 'video',
}
const elements = (
  'a abbr address area article aside audio b bdi bdo big blockquote body br button canvas caption center cite ' +
  'code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure font ' +
  'footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main ' +
  'map mark math menu meta meter nav noscript object ol optgroup option output p param picture pre progress q rp ' +
  'rt ruby s samp script search section select slot small source span strike strong style sub summary sup svg ' +
  'table tbody td template textarea tfoot th thead time title tr track tt u ul var video wbr'
).split(' ')

const elementMarkdown = elements
  .map((element) => {
    const open = (parents[element] ?? 'div').split('><')
    return `<${open.join('><')}><${element} id="probe-${element}">x</${element}>${open.reverse().map((tag) => `</${tag}>`).join('')}`
  })
  .join('\n\n')

const schemes = (
  'http https mailto tel sms xmpp irc ircs ftp sftp ssh git file data javascript vbscript ' +
  'github-windows github-mac x-github-client vscode slack zoommtg notes'
).split(' ')
const schemeMarkdown = schemes.map((scheme) => `[${scheme}](${scheme}:x)`).join('\n\n')

// Returns the exit code: 0 when GitHub agrees, 1 when it does not, and 2 when it
// could not be asked, since that says nothing about whether it agrees.
export async function probeGithubRendering({ render, stdout, stderr }) {
  const cases = [...headingCases, ...anchorCases]
  let rendered
  try {
    rendered = await renderAll(render, [elementMarkdown, schemeMarkdown, ...cases.map(([, markdown]) => markdown)])
  } catch (error) {
    stderr.write(`probe failed: ${error.stderr?.trim() || error.message}\n`)
    return 2
  }
  const [elementHtml, schemeHtml, ...caseHtml] = rendered

  const problems = []

  cases.forEach(([name, , expected], index) => {
    const github = anchorsInHtml(caseHtml[index])
    const want = ['top', ...expected]
    if (JSON.stringify(github) !== JSON.stringify(want)) {
      problems.push(`case ${name}: GitHub renders ${JSON.stringify(github)}, the case expects ${JSON.stringify(want)}`)
    }
  })

  const keptByGithub = new Set(anchorsInHtml(elementHtml).map((anchor) => anchor.replace(/^probe-/, '')))
  for (const element of elements) {
    if (keptByGithub.has(element) && !keptElements.has(element)) problems.push(`element <${element}>: GitHub keeps it, keptElements lacks it`)
    if (!keptByGithub.has(element) && keptElements.has(element)) problems.push(`element <${element}>: GitHub removes it, keptElements has it`)
  }

  for (const scheme of schemes) {
    const kept = schemeHtml.includes(`href="${scheme}:x"`)
    if (kept && !keptSchemes.has(scheme)) problems.push(`scheme ${scheme}: GitHub keeps it, keptSchemes lacks it`)
    if (!kept && keptSchemes.has(scheme)) problems.push(`scheme ${scheme}: GitHub removes it, keptSchemes has it`)
  }

  if (problems.length > 0) {
    stderr.write('GitHub renders differently from what the link check assumes:\n')
    for (const problem of problems) stderr.write(`  ${problem}\n`)
    return 1
  }
  stdout.write(
    `GitHub agrees: ${cases.length} anchor case(s), ${elements.length} element(s), ${schemes.length} scheme(s)\n`,
  )
  return 0
}
