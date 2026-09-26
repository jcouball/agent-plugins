// Tests for check-links.mjs. Each expected slug is the anchor GitHub gives the
// heading; the cases are the ones the checker has got wrong before.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { slugify, anchorsIn, checkLinks } from './check-links.mjs'

describe('slugify', () => {
  const cases = [
    ['Plain Heading', 'plain-heading'],
    ['Punctuation, removed: yes!', 'punctuation-removed-yes'],
    ['Ünïcödé 日本語', 'ünïcödé-日本語'],
    ['snake_case_name', 'snake_case_name'],
    ['`code` span', 'code-span'],
    ['`_foo_` bar', '_foo_-bar'],
    ['[2.0.0](https://example.com/compare) (2026-08-27)', '200-2026-08-27'],
    ['![logo](logo.png) Title', 'logo-title'],
    ['[ref link][r] here', 'ref-link-here'],
    ['See <https://a.b>', 'see-httpsab'],
    ['The _only_ rule', 'the-only-rule'],
    ['__Bold__ word', 'bold-word'],
    ['a _b_c_ d', 'a-b_c-d'],
    ['_a_ and _b_', 'a-and-b'],
    ['The _id field', 'the-_id-field'],
    ['trailing_ and _leading', 'trailing_-and-_leading'],
    ['\\_x\\_', '_x_'],
    ['Uses <kbd>Ctrl</kbd> key', 'uses-ctrl-key'],
    ['When a < b and c > d', 'when-a--b-and-c--d'],
  ]
  for (const [heading, slug] of cases) {
    test(`${JSON.stringify(heading)} is #${slug}`, () => {
      assert.equal(slugify(heading), slug)
    })
  }
})

describe('anchorsIn', () => {
  const anchors = (...lines) => [...anchorsIn(lines.join('\n'))]

  test('always includes #top', () => {
    assert.deepEqual(anchors('No headings here.'), ['top'])
  })

  test('finds ATX headings with or without closing hashes', () => {
    assert.deepEqual(anchors('# One', '## Two ##', '   ### Three'), ['top', 'one', 'two', 'three'])
  })

  test('ignores a hash with no space after it, and four-space indents', () => {
    assert.deepEqual(anchors('#hashtag', '', '    # code'), ['top'])
  })

  test('ignores headings inside fenced code blocks', () => {
    assert.deepEqual(anchors('```', '# Not a heading', '```', '~~~~', '# Nor this', '~~~~'), ['top'])
  })

  test('ignores front matter', () => {
    assert.deepEqual(anchors('---', 'description: Not a heading', '---', '', '# Real'), ['top', 'real'])
  })

  test('finds a setext heading, including one spanning several lines', () => {
    assert.deepEqual(anchors('Real One', '========', '', 'First line', 'second line', '---'), [
      'top',
      'real-one',
      'first-line-second-line',
    ])
  })

  test('takes no setext heading from a line that is not paragraph text', () => {
    assert.deepEqual(
      anchors('- item', '---', '', '1. item', '---', '', '> quote', '---', '', '| a |', '---', '', '    code', '---', '', '***', '---'),
      ['top'],
    )
  })

  test('numbers duplicates the way GitHub does', () => {
    assert.deepEqual(anchors('# Foo', '# Foo', '# Foo 1', '# Bar', '# Bar 1', '# Bar'), [
      'top',
      'foo',
      'foo-1',
      'foo-1-1',
      'bar',
      'bar-1',
      'bar-2',
    ])
  })

  test('finds HTML id and name attributes', () => {
    assert.deepEqual(anchors('<a id="custom"></a>', "<a name='legacy'>x</a>", '<div class="x" id="box">'), [
      'top',
      'custom',
      'legacy',
      'box',
    ])
  })

  test('finds headings inside block quotes and opening list items', () => {
    assert.deepEqual(anchors('> ## Quoted', '> > ### Nested', '- ## Listed', '1. ## Numbered'), [
      'top',
      'quoted',
      'nested',
      'listed',
      'numbered',
    ])
  })

  test('finds a setext heading underlined with a single = or -', () => {
    assert.deepEqual(anchors('Foo', '-', '', 'Bar', '='), ['top', 'foo', 'bar'])
  })

  test('does not run a setext heading across an earlier single-dash underline', () => {
    assert.deepEqual(anchors('A', '-', 'B', '-'), ['top', 'a', 'b'])
  })

  test('finds a setext heading inside a block quote', () => {
    assert.deepEqual(anchors('> Quoted', '> ---'), ['top', 'quoted'])
  })

  test('reads CRLF line endings the same as LF', () => {
    const text = ['---', 'name: x', '---', '# One', '```', '# Not a heading', '```', 'Two', '---'].join('\r\n')
    assert.deepEqual([...anchorsIn(text)], ['top', 'one', 'two'])
  })
})

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

  test('decodes a percent-encoded fragment before matching it', () => {
    assert.deepEqual(run({ 'a.md': '[x](b.md#%C3%BCber)', 'b.md': '# Über' }).broken, [])
  })

  test('reports invalid percent-encoding instead of throwing', () => {
    assert.deepEqual(run({ 'a.md': '[x](b.md#%zz)', 'b.md': '# B' }).broken, ['a.md: b.md#%zz (invalid percent-encoding)'])
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

  test('skips node_modules, .git, and .claude', () => {
    const result = run({
      'node_modules/p/a.md': '[x](missing.md)',
      '.git/a.md': '[x](missing.md)',
      '.claude/worktrees/w/a.md': '[x](missing.md)',
    })
    assert.deepEqual(result, { broken: [], checked: 0 })
  })
})
