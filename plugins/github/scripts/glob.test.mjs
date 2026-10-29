import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesPattern,
  provablyDisjoint,
  selectorCovers,
  selectorProvablyDisjoint,
} from './lib/glob.mjs';

test('* stays within one path segment', () => {
  assert.equal(matchesPattern('release/*', 'release/1.0'), true);
  assert.equal(matchesPattern('release/*', 'release/2026/1.0'), false);
  assert.equal(matchesPattern('main', 'main'), true);
  assert.equal(matchesPattern('main', 'maintenance'), false);
});

test('a terminal ** stays within one segment and only **/ crosses', () => {
  assert.equal(matchesPattern('release/**', 'release/1.0'), true);
  assert.equal(matchesPattern('release/**', 'release/2026/1.0'), false);
  assert.equal(matchesPattern('release/**/*', 'release/1.0'), true);
  assert.equal(matchesPattern('release/**/*', 'release/2026/1.0'), true);
  assert.equal(matchesPattern('release/**/*', 'release'), false);
  assert.equal(matchesPattern('foo/**/bar/**/*', 'foo/bar/baz/qux'), true);
  assert.equal(matchesPattern('foo/bar/baz/*', 'foo/bar/baz/qux'), true);
  assert.equal(matchesPattern('foo/**/bar/**/*', 'foo/x/bar/baz/qux'), true);
  assert.equal(matchesPattern('foo/**/bar/**/*', 'foo/x/baz/qux'), false);
});

test('? and character classes match one character inside a segment', () => {
  assert.equal(matchesPattern('v?', 'v1'), true);
  assert.equal(matchesPattern('v?', 'v/'), false);
  assert.equal(matchesPattern('v[0-9]', 'v7'), true);
  assert.equal(matchesPattern('v[!0-9]', 'v7'), false);
  assert.equal(matchesPattern('a.b', 'a.b'), true);
  assert.equal(matchesPattern('a.b', 'axb'), false);
});

test('disjointness is proven only by differing literals before any **/', () => {
  assert.equal(provablyDisjoint('docs/*', 'release/**/*'), true);
  assert.equal(provablyDisjoint('release/*', 'release/**/*'), false);
  assert.equal(provablyDisjoint('release/one/*', 'release/two/*'), true);
  assert.equal(provablyDisjoint('main', 'master'), true);
  assert.equal(provablyDisjoint('main', 'main'), false);
  assert.equal(provablyDisjoint('*', 'main'), false);
});

test('positions past a **/ prove nothing', () => {
  assert.equal(provablyDisjoint('foo/**/bar/**/*', 'foo/bar/baz/*'), false);
  assert.equal(provablyDisjoint('foo/**/bar', 'foo/qux/bar'), false);
});

test('differing segment counts prove disjointness when neither pattern crosses segments', () => {
  assert.equal(provablyDisjoint('main', 'main/*'), true);
  assert.equal(provablyDisjoint('release/*', 'release/*/*'), true);
  assert.equal(provablyDisjoint('release/**/*', 'release/*'), false);
});

test('selectors: only the literal pattern and ~ALL cover', () => {
  assert.equal(selectorCovers('refs/heads/main', 'main'), true);
  assert.equal(selectorCovers('~ALL', 'main'), true);
  assert.equal(selectorCovers('~DEFAULT_BRANCH', 'main'), false);
  assert.equal(selectorCovers('refs/heads/*', 'main'), false);
});

test('selectors: ~ALL and ~DEFAULT_BRANCH are never provably disjoint', () => {
  assert.equal(selectorProvablyDisjoint('~ALL', 'main'), false);
  assert.equal(selectorProvablyDisjoint('~DEFAULT_BRANCH', 'main'), false);
  assert.equal(selectorProvablyDisjoint('refs/heads/docs/*', 'main'), true);
  assert.equal(selectorProvablyDisjoint('refs/tags/v*', 'main'), false);
});
