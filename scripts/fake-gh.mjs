// A stand-in for `gh api markdown --input -`, run by the fake gh that
// probe-github-rendering.cli.test.mjs puts on PATH. It reads the request and
// answers with fakeMarkdown (see fake-markdown.mjs). FAKE_GH is JSON that
// makes it disagree, as fakeMarkdown takes.

import { readFileSync } from 'node:fs'
import { fakeMarkdown } from './fake-markdown.mjs'

const { text } = JSON.parse(readFileSync(0, 'utf8'))
process.stdout.write(fakeMarkdown(JSON.parse(process.env.FAKE_GH ?? '{}'))(text))
