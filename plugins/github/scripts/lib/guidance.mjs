// The canonical guidance block: rendering it for a baseline, recognising it
// in a file by its markers and ownership hash, and writing it. Byte-exact on
// purpose: the hash in the opening marker is what tells machine output from
// a user's edit, so every run must render the same baseline to the same
// bytes.

import { createHash } from 'node:crypto';

const BEGIN_RE = /^<!-- jcouball-github guardrails: begin sha256:([0-9a-f]{12}) -->$/;
export const END_MARKER = '<!-- jcouball-github guardrails: end -->';

export function beginMarker(hash) {
  return `<!-- jcouball-github guardrails: begin sha256:${hash} -->`;
}

// `main`; `a` or `b`; `a`, `b`, or `c`.
export function renderPatterns(patterns) {
  const ticked = patterns.map((p) => `\`${p}\``);
  if (ticked.length === 1) return ticked[0];
  if (ticked.length === 2) return `${ticked[0]} or ${ticked[1]}`;
  return `${ticked.slice(0, -1).join(', ')}, or ${ticked[ticked.length - 1]}`;
}

// The three body lines, each with its newline, nothing rewrapped.
export function renderBody(patterns) {
  return `Never commit or push to ${renderPatterns(patterns)}. Create a topic branch\n`
    + 'first (`git switch -c <type>/<short-description>`) and open a pull\n'
    + 'request instead.\n';
}

export function hashBody(body) {
  return createHash('sha256').update(body).digest('hex').slice(0, 12);
}

export function renderBlock(patterns) {
  const body = renderBody(patterns);
  const hash = hashBody(body);
  return { body, hash, block: `${beginMarker(hash)}\n${body}${END_MARKER}\n` };
}

// A file's line ending: CRLF when its first line break is one, else LF. The
// block is matched, hashed, and rendered with LF, and a CRLF file gets the
// block written back in CRLF, so the same baseline hashes the same on both.
function lineEnding(text) {
  const i = text.indexOf('\n');
  return i > 0 && text[i - 1] === '\r' ? '\r\n' : '\n';
}

function toLf(text) {
  return text.replace(/\r\n/g, '\n');
}

// Find the marker pair in a file's text.
//   { markers: 'none' }
//   { markers: 'one', begin, end, hash, body }   line indexes, marker hash, body text
//   { markers: 'malformed', detail }
export function findMarkers(text) {
  const lines = toLf(text).split('\n');
  const begins = [];
  const ends = [];
  lines.forEach((line, i) => {
    if (BEGIN_RE.test(line)) begins.push(i);
    if (line === END_MARKER) ends.push(i);
  });
  if (begins.length === 0 && ends.length === 0) return { markers: 'none' };
  if (begins.length !== 1 || ends.length !== 1) {
    return {
      markers: 'malformed',
      detail: `${begins.length} begin marker${begins.length === 1 ? '' : 's'} and ${ends.length} end marker${ends.length === 1 ? '' : 's'}`,
    };
  }
  if (begins[0] > ends[0]) return { markers: 'malformed', detail: 'the end marker comes before the begin marker' };
  const hash = BEGIN_RE.exec(lines[begins[0]])[1];
  const body = lines.slice(begins[0] + 1, ends[0]).map((l) => `${l}\n`).join('');
  return { markers: 'one', begin: begins[0], end: ends[0], hash, body };
}

// Classify a file's text against the block the baseline renders.
//   absent           no markers; the text is the user's and is classified semantically
//   machine-current  an untouched block matching the current baseline: Covered
//   machine-stale    an untouched block from an earlier baseline: --fix rewrites it
//   edited           the block's text no longer matches its hash: the user's prose now
//   malformed        duplicate, nested, or unmatched markers: manual cleanup
export function inspectText(text, patterns) {
  const expected = renderBlock(patterns);
  const found = findMarkers(text);
  if (found.markers === 'none') return { classification: 'absent', expected };
  if (found.markers === 'malformed') return { classification: 'malformed', detail: found.detail, expected };
  const hashMatches = hashBody(found.body) === found.hash;
  if (!hashMatches) {
    return { classification: 'edited', marker_hash: found.hash, body: found.body, expected };
  }
  const stale = found.body !== expected.body;
  return {
    classification: stale ? 'machine-stale' : 'machine-current',
    marker_hash: found.hash, body: found.body, expected,
  };
}

// The file's text after the Missing write (append) or the stale rewrite.
// Returns { text, action } or { error }.
export function writeBlock(original, patterns) {
  const eol = lineEnding(original);
  const text = toLf(original);
  const inspected = inspectText(text, patterns);
  const { block } = inspected.expected;
  const restore = (lf) => (eol === '\n' ? lf : lf.replace(/\n/g, eol));
  switch (inspected.classification) {
    case 'absent': {
      let prefix = text;
      if (prefix.length > 0 && !prefix.endsWith('\n')) prefix += '\n';
      if (prefix.length > 0 && !prefix.endsWith('\n\n')) prefix += '\n';
      return { text: restore(prefix + block), action: 'appended' };
    }
    case 'machine-current':
      return { text: original, action: 'unchanged' };
    case 'machine-stale': {
      const found = findMarkers(text);
      const lines = text.split('\n');
      const replacement = block.slice(0, -1).split('\n');
      lines.splice(found.begin, found.end - found.begin + 1, ...replacement);
      return { text: restore(lines.join('\n')), action: 'rewritten' };
    }
    case 'edited':
      return { error: 'the block was edited and is now the user\'s prose; a file carrying a marker pair is closed to the write' };
    default:
      return { error: `the markers are malformed (${inspected.detail}); report the file for manual cleanup` };
  }
}
