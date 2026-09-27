// The anchors GitHub renders for each markdown input, shared by the link
// check's tests and by probe-github-rendering.mjs, which compares every case
// here against GitHub's rendering. A case is a name, the markdown, and the
// anchors in document order after #top.

const headings = [
  ['Plain Heading', 'plain-heading'],
  ['Punctuation, removed: yes!', 'punctuation-removed-yes'],
  ['Ünïcödé 日本語', 'ünïcödé-日本語'],
  ['हिन्दी', 'हिन्दी'],
  ['Café', 'café'],
  ['snake_case_name', 'snake_case_name'],
  ['`code` span', 'code-span'],
  ['`_foo_` bar', '_foo_-bar'],
  ['Use ` foo ` here', 'use-foo-here'],
  ['Use `  foo  ` here', 'use--foo--here'],
  ['A ` ` space', 'a---space'],
  ['[2.0.0](https://example.com/compare) (2026-08-27)', '200-2026-08-27'],
  ['![logo](logo.png) Title', '-title'],
  ['[ref link][r] here', 'ref-linkr-here'],
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

export const headingCases = headings.map(([heading, slug]) => [`${JSON.stringify(heading)} is #${slug}`, `# ${heading}`, [slug]])

const lines = (...all) => all.join('\n')

export const anchorCases = [
  ['always includes #top', lines('No headings here.'), []],
  ['finds ATX headings with or without closing hashes', lines('# One', '## Two ##', '   ### Three'), ['one', 'two', 'three']],
  ['ignores a hash with no space after it, and four-space indents', lines('#hashtag', '', '    # code'), []],
  ['ignores headings inside fenced code blocks', lines('```', '# Not a heading', '```', '~~~~', '# Nor this', '~~~~'), []],
  [
    'ignores headings inside fenced code blocks inside block quotes',
    lines('> ```', '> # Not a heading', '> ```', '> > ~~~', '> > # Nor this', '> > ~~~'),
    [],
  ],
  ['ends a quoted fence where its block quote ends', lines('> ```', '> code', '# Real'), ['real']],
  ['ignores front matter', lines('---', 'description: Not a heading', '---', '', '# Real'), ['real']],
  [
    'finds a setext heading, including one spanning several lines',
    lines('Real One', '========', '', 'First line', 'second line', '---'),
    ['real-one', 'first-linesecond-line'],
  ],
  [
    'finds a setext heading on a line starting with a hash that opens no ATX heading',
    lines('#hashtag', '---', '', '####### seven', '==='),
    ['hashtag', '-seven'],
  ],
  [
    'takes no setext heading from a line that is not paragraph text',
    lines('- item', '---', '', '1. item', '---', '', '> quote', '---', '', '    code', '---', '', '***', '---'),
    [],
  ],
  [
    'takes no setext heading from a lazy continuation of a list item or block quote',
    lines('- item', 'continued', '---', '', '1. item', '   more', 'continued', '===', '', '> quote', 'continued', '---'),
    [],
  ],
  [
    'takes no setext heading from an underline outside the list item holding the paragraph',
    lines('- a', '', '  Para', '---', '', '- b', '  - c', '', '    Nested', '  ---'),
    [],
  ],
  [
    'finds a setext heading underlined inside the list item holding the paragraph',
    lines('- a', '', '  Para', '  ---', '', 'text', '', '  Indented', '---'),
    ['para', 'indented'],
  ],
  [
    'finds headings indented four or more spaces inside a nested list item',
    lines('- a', '  - b', '', '    ## Sub', '', '    Setext', '    ---'),
    ['sub', 'setext'],
  ],
  [
    'ignores headings inside a fenced code block inside a nested list item',
    lines('- a', '  - b', '', '    ```', '    # Not a heading', '    ```'),
    [],
  ],
  ['opens a fence right after a list item paragraph', lines('- step one', '```md', '# Not a heading', '```', '# Real'), ['real']],
  ['opens a fence right after a block quote paragraph', lines('> quote', '~~~', '# Not a heading', '~~~', '# Real'), ['real']],
  ['ends a fence inside a list item where the item ends', lines('- a', '', '  ```', '  code', '# Real'), ['real']],
  ['finds a setext heading on text after a list item that ends in a heading', lines('- # Listed', 'Real', '---'), ['listed', 'real']],
  [
    'finds a setext heading on pipe-separated text with no delimiter row',
    lines('| a |', '---', '', 'x | y', '---', '', '| c |', '| d |', '---'),
    ['-a-', 'x--y', '-c--d-'],
  ],
  [
    'takes no setext heading from a table row',
    lines('| a |', '|---|', '| b |', '---', '', 'a | b', '--- | ---', 'c | d', '---'),
    [],
  ],
  [
    'slugs a reference link by whether its label is defined',
    lines('# [ref link][R] here', '', '# ![logo][l] Title', '', '# ![alt][nope] Two', '', '[r]: https://example.com', '[l]: logo.png'),
    ['ref-link-here', '-title', 'altnope-two'],
  ],
  [
    'numbers duplicates the way GitHub does',
    lines('# Foo', '# Foo', '# Foo 1', '# Bar', '# Bar 1', '# Bar'),
    ['foo', 'foo-1', 'foo-1-1', 'bar', 'bar-1', 'bar-2'],
  ],
  [
    'finds HTML id and name attributes',
    lines('<a id="custom"></a>', "<a name='legacy'>x</a>", '<div class="x" id="box">'),
    ['custom', 'legacy', 'box'],
  ],
  ['finds unquoted ids, and ids after a quoted value holding >', lines('<a id=bare></a>', '', '<div title="a>b" id="x"></div>'), ['bare', 'x']],
  ['decodes character references in an id', lines('<a id="a&amp;b"></a>'), ['a&b']],
  [
    'ignores ids and names on elements GitHub removes',
    lines('<input name="q">', '', '<meta name="m">', '', '<section id="s"><form id="f">x</form></section>'),
    ['s'],
  ],
  [
    'finds ids inside elements GitHub removes, which keep their children',
    lines('<center><a id="y"></a></center>', '', '<svg><a id="sv"></a></svg>'),
    ['y', 'sv'],
  ],
  [
    'finds ids between tags GFM escapes, and inside noscript',
    lines('<textarea><a id="t"></a></textarea>', '', '<noscript><a id="ns"></a></noscript>'),
    ['t', 'ns'],
  ],
  ['takes a name only from an <a>', lines('<div name="z"></div>', '', '<a name="n"></a>'), ['n']],
  ['gives no anchor to a heading whose text slugs to nothing', lines('# ', '', '#', '', '# ![a](x.png)', '', '# Foo'), ['foo']],
  [
    'ignores a table cell or row id outside a table, which the browser parser drops',
    lines(
      '<p>',
      '<td id="cell">x</td>',
      '</p>',
      '',
      '<td id="alone">x</td>',
      '',
      'Text <td id="inline">x</td> here',
      '',
      '<tr id="row"><td>x</td></tr>',
      '',
      '<table><tr><td id="kept">x</td></tr></table>',
    ),
    ['kept'],
  ],
  ['keeps a list item id outside a list', lines('<li id="item">x</li>'), ['item']],
  [
    'slugs raw HTML headings, numbering them with markdown headings',
    lines('<h1 align="center">Project</h1>', '', '# Project', '', '<h2>Install <em>it</em></h2>', '', '## Install it'),
    ['project', 'project-1', 'install-it', 'install-it-1'],
  ],
  [
    'slugs raw HTML headings nested in other HTML, or inline in a paragraph',
    lines('# Setup', '', '<div align="center"><h2>Setup</h2></div>', '', 'Text <h3>Inline</h3> here'),
    ['setup', 'setup-1', 'inline'],
  ],
  ['gives a raw HTML heading with an id both the id and its slug', lines('<h1 id="custom">Titled</h1>', '', '# Titled'), ['custom', 'titled', 'titled-1']],
  [
    'slugs a footnote reference as the number GitHub renders for it',
    lines('# Heading[^b]', '## Two[^a] *em[^b]*', '', '[^a]: a', '[^b]: b'),
    ['heading1', 'two2-em1'],
  ],
  [
    'ignores headings and HTML ids inside HTML comments',
    lines('<!--', '# In a comment', '-->', '', 'Text <!-- <a id="hidden"></a> --> here'),
    [],
  ],
  [
    'finds headings inside block quotes and opening list items',
    lines('> ## Quoted', '> > ### Nested', '- ## Listed', '1. ## Numbered'),
    ['quoted', 'nested', 'listed', 'numbered'],
  ],
  ['finds a setext heading underlined with a single = or -', lines('Foo', '-', '', 'Bar', '='), ['foo', 'bar']],
  ['does not run a setext heading across an earlier single-dash underline', lines('A', '-', 'B', '-'), ['a', 'b']],
  ['finds a setext heading inside a block quote', lines('> Quoted', '> ---'), ['quoted']],
  [
    'reads CRLF line endings the same as LF',
    ['---', 'name: x', '---', '# One', '```', '# Not a heading', '```', 'Two', '---'].join('\r\n'),
    ['one', 'two'],
  ],
]
