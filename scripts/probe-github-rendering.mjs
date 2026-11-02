#!/usr/bin/env node
//
// Check what the link check assumes about GitHub's rendering against GitHub
// itself: the anchors each case in check-links.cases.mjs expects, the HTML
// elements whose id survives GitHub's sanitizer, and the link schemes it
// keeps. Prints each disagreement and exits 1 if there is one. Exits 2 when gh
// cannot render, since that says nothing about whether GitHub agrees.
//
// Run it by hand when the link check disagrees with GitHub about a link. It
// calls GitHub's API through an authenticated gh, so CI does not run it.
//
// The markdown API's markdown mode renders text the way a repository page
// renders a file, heading anchors included, except that it reads front matter
// as markdown, so the probe removes it first. The work is in
// lib/probe-github-rendering.mjs.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { probeGithubRendering } from './lib/probe-github-rendering.mjs'

const run = promisify(execFile)

const render = async (text) => {
  const child = run('gh', ['api', 'markdown', '--input', '-'], { maxBuffer: 16 * 1024 * 1024 })
  // A gh that exits without reading its input closes the pipe, and writing to
  // it is an EPIPE on stdin. The failed exit, awaited below, is what to report.
  child.child.stdin.on('error', () => {})
  child.child.stdin.end(JSON.stringify({ text, mode: 'markdown' }))
  return (await child).stdout
}

process.exitCode = await probeGithubRendering({ render, stdout: process.stdout, stderr: process.stderr })
