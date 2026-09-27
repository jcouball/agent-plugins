// Tests for the link check. The anchor cases live in check-links.cases.mjs,
// where probe-github-rendering.mjs can check each one against GitHub.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { anchorsIn, checkLinks } from './lib/check-links.mjs'
import { anchorCases, headingCases } from './check-links.cases.mjs'

for (const [suite, cases] of [
  ['heading slugs', headingCases],
  ['anchorsIn', anchorCases],
]) {
  describe(suite, () => {
    for (const [name, markdown, anchors] of cases) {
      test(name, () => {
        assert.deepEqual([...anchorsIn(markdown)], ['top', ...anchors])
      })
    }
  })
}

describe('checkLinks', () => {
  const tree = (files) => {
    const root = mkdtempSync(join(tmpdir(), 'check-links-'))
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), content)
    }
    return root
  }
  const run = (files) => {
    const root = tree(files)
    try {
      return checkLinks(root)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  test('passes links to files and headings that exist', () => {
    const result = run({
      'a.md': '[b](b.md) [h](b.md#heading) [d](sub/d.md) [root](/b.md#top) [pic](img.png)',
      'b.md': '# Heading',
      'sub/d.md': '[back](../a.md)',
      'img.png': '',
    })
    assert.deepEqual(result, { broken: [], checked: 6 })
  })

  test('reports a missing file', () => {
    assert.deepEqual(run({ 'a.md': '[x](missing.md)' }).broken, ['a.md: missing.md'])
  })

  test('reports a fragment that names no heading', () => {
    assert.deepEqual(run({ 'a.md': '[x](b.md#nope)', 'b.md': '# Heading' }).broken, ['a.md: b.md#nope (no such heading)'])
  })

  test('checks the target of a reference definition', () => {
    assert.deepEqual(run({ 'a.md': '[x][r]\n\n[r]: b.md#nope', 'b.md': '# Heading' }).broken, ['a.md: b.md#nope (no such heading)'])
  })

  test('decodes a percent-encoded fragment before matching it', () => {
    assert.deepEqual(run({ 'a.md': '[x](b.md#%C3%BCber)', 'b.md': '# Über' }).broken, [])
  })

  test('reports invalid percent-encoding instead of throwing', () => {
    assert.deepEqual(run({ 'a.md': '[x](b.md#%zz)', 'b.md': '# B' }).broken, ['a.md: b.md#%zz (invalid percent-encoding)'])
  })

  test('checks a fragment on a link to a directory against its README', () => {
    const result = run({
      'a.md': '[ok](docs/#install) [bad](docs/#nope) [none](empty/#x) [rst](rst/#x)',
      'docs/README.md': '# Install',
      'empty/file.txt': '',
      'rst/README.rst': 'Title',
    })
    assert.deepEqual(result.broken, ['a.md: docs/#nope (no such heading)', 'a.md: empty/#x (no README to hold the heading)'])
  })

  test('prefers README.md over a translated README beside it', () => {
    const result = run({ 'a.md': '[e](e/#english)', 'e/README.ja.md': '# Japanese', 'e/README.md': '# English' })
    assert.deepEqual(result.broken, [])
  })

  test('takes the root README from .github, then the root, then docs', () => {
    const files = { 'a/b.md': '[x](/#first)', '.github/README.md': '# First', 'README.md': '# Second', 'docs/README.md': '# Third' }
    assert.deepEqual(run(files).broken, [])
    assert.deepEqual(run({ ...files, 'a/b.md': '[x](/#second)' }).broken, ['a/b.md: /#second (no such heading)'])
  })

  test('drops the query string from the path, and treats ?plain=1 fragments as lines', () => {
    const result = run({ 'a.md': '[l](b.md?plain=1#L10) [h](b.md?x=1#heading) [n](b.md?x=1#nope)', 'b.md': '# Heading' })
    assert.deepEqual(result, { broken: ['a.md: b.md?x=1#nope (no such heading)'], checked: 3 })
  })

  test('checks a query-only link against the page it is on', () => {
    const result = run({ 'd/page.md': '# Own\n\n[q](?x=1#own) [n](?x=1#nope)', 'd/README.md': '# Other' })
    assert.deepEqual(result, { broken: ['d/page.md: ?x=1#nope (no such heading)'], checked: 2 })
  })

  test('accepts a fragment carrying the user-content- prefix GitHub renders ids with', () => {
    const result = run({ 'a.md': '[a](b.md#user-content-own) [b](b.md#user-content-top)', 'b.md': '# Own' })
    assert.deepEqual(result.broken, ['a.md: b.md#user-content-top (no such heading)'])
  })

  test('reports a link whose scheme GitHub removes', () => {
    const result = run({ 'a.md': '[t](tel:123) [n](notes:v2.md) [x](xmpp:a@b.c) [ok](./notes:v2.md)', 'notes:v2.md': '' })
    assert.deepEqual(result, { broken: ['a.md: tel:123 (GitHub removes tel: links)', 'a.md: notes:v2.md (GitHub removes notes: links)'], checked: 3 })
  })

  test('skips external links, same-file fragments, and fragments on non-markdown files', () => {
    const result = run({
      'a.md': '[w](https://example.com/x.md) [m](mailto:a@b.c) [s](#nowhere) [f](data.json#key)',
      'data.json': '{}',
    })
    assert.deepEqual(result, { broken: [], checked: 1 })
  })

  test('ignores links inside fenced code blocks, with LF or CRLF line endings', () => {
    assert.deepEqual(run({ 'a.md': '```\n[x](missing.md)\n```', 'b.md': '```\r\n[x](missing.md)\r\n```\r\n' }), {
      broken: [],
      checked: 0,
    })
  })

  test('ignores links inside fenced code blocks inside block quotes', () => {
    assert.deepEqual(run({ 'a.md': '> ```\n> [x](missing.md)\n> ```' }), { broken: [], checked: 0 })
  })

  test('ignores links inside a fenced code block inside a nested list item', () => {
    assert.deepEqual(run({ 'a.md': '- a\n  - b\n\n    ```\n    [x](missing.md)\n    ```' }), { broken: [], checked: 0 })
  })

  test('ignores links inside a fence right after a list item', () => {
    assert.deepEqual(run({ 'a.md': '- step one\n```md\n[x](missing.md)\n```' }), { broken: [], checked: 0 })
  })

  test('passes a link to a heading inside a nested list item', () => {
    assert.deepEqual(run({ 'a.md': '[x](b.md#sub)', 'b.md': '- a\n  - b\n\n    ## Sub' }).broken, [])
  })

  test('reports a link that climbs out of the repository, even to a file that exists', () => {
    const outside = tree({ 'b.md': '# Install' })
    const root = tree({ 'a.md': `[x](../${basename(outside)}/b.md#install) [y](/../${basename(outside)}/b.md)` })
    try {
      assert.deepEqual(checkLinks(root).broken, [
        `a.md: ../${basename(outside)}/b.md#install (outside the repository)`,
        `a.md: /../${basename(outside)}/b.md (outside the repository)`,
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  test('passes a link to a root file whose name starts with two dots', () => {
    assert.deepEqual(run({ 'a.md': '[x](..notes.md)', '..notes.md': '' }).broken, [])
  })

  test('leaves protocol-relative URLs alone', () => {
    assert.deepEqual(run({ 'a.md': '[x](//example.com/x.md)' }), { broken: [], checked: 0 })
  })

  test('reads only lowercase .md files, as markdownlint does', () => {
    assert.deepEqual(run({ 'NOTES.MD': '[x](missing.md)' }), { broken: [], checked: 0 })
  })

  test('does not follow symbolic links', () => {
    const outside = tree({ 'b.md': '[x](missing.md)' })
    const root = tree({ 'a.md': '[x](b.md)', 'b.md': '' })
    try {
      symlinkSync('.', join(root, 'loop'))
      symlinkSync(outside, join(root, 'outside'))
      symlinkSync(join(outside, 'b.md'), join(root, 'c.md'))
      assert.deepEqual(checkLinks(root), { broken: [], checked: 1 })
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  test('skips node_modules, .git, and .claude/worktrees', () => {
    const result = run({
      'node_modules/p/a.md': '[x](missing.md)',
      '.git/a.md': '[x](missing.md)',
      '.claude/worktrees/w/a.md': '[x](missing.md)',
    })
    assert.deepEqual(result, { broken: [], checked: 0 })
  })
})
