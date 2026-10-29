import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./check-repo-config.mjs', import.meta.url));

// A fresh Git repository to run the script in. The subcommands under test
// stop before any gh call, so none of these needs gh or the network.
function repository() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-repo-config-'));
  const init = spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  return dir;
}

function run(cwd, ...args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = undefined;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

test('a dangling symlink at a guidance target is a JSON error, not a stack trace', () => {
  const dir = repository();
  fs.symlinkSync(path.join(dir, 'missing-target'), path.join(dir, 'CLAUDE.md'));
  for (const action of ['inspect', 'write']) {
    const result = run(dir, 'guidance', action, 'CLAUDE.md');
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.json.error, /CLAUDE\.md is a symlink whose target does not exist/);
    assert.equal(result.stderr, '');
  }
});

test('a directory at a guidance target is a JSON error', () => {
  const dir = repository();
  fs.mkdirSync(path.join(dir, 'CLAUDE.md'));
  const result = run(dir, 'guidance', 'inspect', 'CLAUDE.md');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.json.error, /CLAUDE\.md is a directory, not a file/);
});

test('a dangling symlink at the baseline path stops every subcommand with a JSON error', () => {
  const dir = repository();
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.symlinkSync(path.join(dir, 'missing-target'), path.join(dir, '.claude', 'repo-guardrails.yml'));
  const result = run(dir, 'guidance', 'render');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.json.error, /repo-guardrails\.yml is a symlink whose target does not exist/);
});

test('a flag that names a file fails usage when the value is missing', () => {
  const dir = repository();
  assert.match(run(dir, 'audit', '--plan-out').json.error, /--plan-out needs a value/);
  assert.equal(run(dir, 'audit', '--plan-out').status, 1);
  assert.match(run(dir, 'audit', '--plan-out', '--plan-out').json.error, /--plan-out needs a value/);
});
