// Ruleset ref-name patterns: Ruby fnmatch with pathname semantics, as GitHub
// evaluates the `include` and `exclude` lists of a branch ruleset.
//
// `*` and `?` stay inside one path segment, `**/` matches zero or more whole
// segments, and a terminal `**` is just `*`. A selector is either such a
// pattern prefixed with `refs/heads/`, or one of the tokens `~ALL` and
// `~DEFAULT_BRANCH`.

const WILDCARDS = /[*?[]/;

// Compile a bare pattern (no `refs/heads/` prefix) to a RegExp over a bare
// branch name.
export function globToRegExp(pattern) {
  let out = '^';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern.startsWith('**/', i)) {
        out += '(?:[^/]+/)*';
        i += 3;
        continue;
      }
      if (pattern.startsWith('**', i)) {
        // `**` not followed by `/`: stays within one segment.
        out += '[^/]*';
        i += 2;
        continue;
      }
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (c === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    if (c === '[') {
      const close = pattern.indexOf(']', i + 2);
      if (close === -1) {
        out += '\\[';
        i += 1;
        continue;
      }
      let body = pattern.slice(i + 1, close);
      if (body.startsWith('!') || body.startsWith('^')) body = `^${body.slice(1)}`;
      body = body.replace(/\\/g, '\\\\').replace(/\//g, '');
      out += `[${body}]`;
      i = close + 1;
      continue;
    }
    out += c.replace(/[.+^${}()|\\]/g, '\\$&');
    i += 1;
  }
  return new RegExp(`${out}$`);
}

export function matchesPattern(pattern, branch) {
  return globToRegExp(pattern).test(branch);
}

export function isLiteralSegment(segment) {
  return !WILDCARDS.test(segment);
}

// Whether two bare patterns can be proven to share no branch. The proof is
// deliberately narrow: some segment position, before the first `**/` segment
// in either pattern, where both segments are wildcard-free literals that
// differ; or, when neither pattern carries a `**/` segment, differing segment
// counts. Anything less certain is "not provably disjoint".
export function provablyDisjoint(a, b) {
  const sa = a.split('/');
  const sb = b.split('/');
  const crossA = crossingIndex(sa);
  const crossB = crossingIndex(sb);
  const limit = Math.min(sa.length, sb.length, crossA, crossB);
  for (let i = 0; i < limit; i += 1) {
    if (isLiteralSegment(sa[i]) && isLiteralSegment(sb[i]) && sa[i] !== sb[i]) {
      return true;
    }
  }
  if (crossA === Infinity && crossB === Infinity && sa.length !== sb.length) {
    return true;
  }
  return false;
}

// Index of the first `**` segment that is not the last segment (a terminal
// `**` stays in one segment), or Infinity.
function crossingIndex(segments) {
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (segments[i] === '**') return i;
  }
  return Infinity;
}

export const REF_PREFIX = 'refs/heads/';

// Classify a ruleset selector.
//   { kind: 'all' } for `~ALL`
//   { kind: 'default' } for `~DEFAULT_BRANCH`
//   { kind: 'pattern', pattern } for `refs/heads/<pattern>`
//   { kind: 'other', raw } for anything else
export function parseSelector(selector) {
  if (selector === '~ALL') return { kind: 'all' };
  if (selector === '~DEFAULT_BRANCH') return { kind: 'default' };
  if (typeof selector === 'string' && selector.startsWith(REF_PREFIX)) {
    return { kind: 'pattern', pattern: selector.slice(REF_PREFIX.length) };
  }
  return { kind: 'other', raw: selector };
}

// Whether a selector can be proven never to select any branch a bare
// pattern matches. `~ALL` and `~DEFAULT_BRANCH` are never provably disjoint;
// an unrecognised selector is treated the same way, conservatively.
export function selectorProvablyDisjoint(selector, pattern) {
  const parsed = parseSelector(selector);
  if (parsed.kind !== 'pattern') return false;
  return provablyDisjoint(parsed.pattern, pattern);
}

// Whether a selector is one of the two that count as covering a pattern:
// its literal `refs/heads/<pattern>` form, or `~ALL`.
export function selectorCovers(selector, pattern) {
  return selector === '~ALL' || selector === REF_PREFIX + pattern;
}
