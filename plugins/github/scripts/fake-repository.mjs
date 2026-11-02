// A fresh Git repository for the tests of check-repo-config to run in, and the
// two things they do to it: write a file, and track one.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function repository() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-repo-config-'));
  const init = spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  return dir;
}

export function track(dir, ...files) {
  const add = spawnSync('git', ['-C', dir, 'add', '--', ...files], { encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr);
}

export function write(dir, file, text) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}

// A repository whose tracked baseline protects only main, which is what the
// compliant routes in fake-gh.mjs describe: one ruleset on main, and no master.
export function compliantRepository() {
  const dir = repository();
  write(dir, '.claude/repo-guardrails.yml', 'protected_branches: [main]\n');
  track(dir, '.claude/repo-guardrails.yml');
  return dir;
}
