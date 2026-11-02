import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeTools, linkTools } from '../../../scripts/fake-executable.mjs';
import { compliantRoutes } from './fake-gh.mjs';
import { repository, track, write } from './fake-repository.mjs';

// The tests of what check-repo-config does are in run.test.mjs, which calls
// run() in the test's own process. These start the script, for the things that
// exist only in a running program: its exit status, the output a pipe carries
// to the reader, and the tools it finds on PATH.

const SCRIPT = fileURLToPath(new URL('./check-repo-config.mjs', import.meta.url));
const FAKE_GH_CLI = fileURLToPath(new URL('./fake-gh-cli.mjs', import.meta.url));

function start(cwd, args, env = process.env) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = undefined;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

function sh(text) {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

// Run the script in `cwd` with a fake gh executable on PATH that serves
// `routes` from a state file the test writes.
function startWithGh(cwd, routes, args) {
  const { dir, env } = fakeTools({ gh: `exec ${sh(process.execPath)} ${sh(FAKE_GH_CLI)} "$@"` });
  const state = path.join(dir, 'state.json');
  fs.writeFileSync(state, JSON.stringify({ routes }));
  try {
    return start(cwd, args, { ...env, FAKE_GH_STATE: state });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the script exits with the code run() returns and prints the document run() writes', () => {
  const dir = repository();
  const result = start(dir, ['nonsense']);
  assert.equal(result.status, 1);
  assert.match(result.json.error, /^usage: /);
  assert.equal(result.stderr, '');

  const rendered = start(dir, ['guidance', 'render']);
  assert.equal(rendered.status, 0);
  assert.equal(rendered.json.baseline_source, 'built-in defaults');
});

test('a missing gh is reported as an error, not a stack trace', () => {
  const dir = repository();
  // Only git on PATH, since the script runs git before it ever calls gh.
  const { dir: tools, env } = fakeTools({});
  try {
    linkTools(tools, ['git']);
    const result = start(dir, ['audit'], { ...env, PATH: tools });
    assert.equal(result.status, 1);
    assert.equal(result.json.error, 'gh is not installed or not on PATH');
  } finally {
    fs.rmSync(tools, { recursive: true, force: true });
  }
});

test('a missing git is reported as missing, not as a directory that is not a repository', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'check-repo-config-nogit-'));
  const result = start(repository(), ['audit'], { ...process.env, PATH: empty });
  assert.equal(result.status, 1);
  assert.equal(result.json.error, 'git is not installed or not on PATH');
});

// ---------------------------------------------------------------------------
// Output larger than a pipe holds

test('a document larger than the pipe buffer reaches the reader whole when the script exits non-zero', () => {
  const dir = repository();
  const patterns = Array.from({ length: 100 }, (_, i) => `topic-${i}`);
  write(dir, '.claude/repo-guardrails.yml', `protected_branches: [${patterns.join(', ')}]\n`);
  track(dir, '.claude/repo-guardrails.yml');
  const routes = compliantRoutes([], ['main']);
  const planFile = path.join(dir, 'plan.json');
  assert.equal(startWithGh(dir, routes, ['audit', '--plan-out', planFile]).status, 0);
  routes['GET repos/acme/widgets'] = { ...routes['GET repos/acme/widgets'], allow_squash_merge: true };
  const result = startWithGh(dir, routes, ['apply', planFile]);
  assert.equal(result.status, 3);
  assert.ok(result.stdout.length > 64 * 1024, `the document is only ${result.stdout.length} bytes`);
  assert.equal(result.json.status, 'stale');
  assert.ok(result.json.audit.checks.length > 100);
});

test('a baseline with many invalid patterns gets its whole error list, whatever its size, with exit 2', () => {
  const dir = repository();
  // Each pattern is invalid on its own, so each adds an error to the document.
  const patterns = Array.from({ length: 900 }, (_, i) => `refs/heads/topic-${i}`);
  write(dir, '.claude/repo-guardrails.yml', `protected_branches: [${patterns.join(', ')}]\n`);
  track(dir, '.claude/repo-guardrails.yml');
  const result = start(dir, ['audit']);
  assert.equal(result.status, 2);
  assert.ok(result.stdout.length > 64 * 1024, `the document is only ${result.stdout.length} bytes`);
  assert.equal(result.json.baseline_errors.length, 900);
});
