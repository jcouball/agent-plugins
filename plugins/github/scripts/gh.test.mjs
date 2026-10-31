// Tests for lib/gh.mjs: the real runner against a fake gh executable on PATH,
// and api() against a runner that returns canned results, which is the seam the
// rest of the scripts use.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeTools } from '../../../scripts/fake-executable.mjs';
import { api, createGh, describeFailure, GhError } from './lib/gh.mjs';

// Run `fn` with these variables set in this process, then put them back. The
// runner reads PATH and GH_REPO from the process it runs in, so a test that
// wants a fake gh has to set them here.
function withEnv(vars, fn) {
  const before = {};
  for (const name of Object.keys(vars)) before[name] = process.env[name];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

// Call the real runner with a fake gh, whose body is the shell it runs.
function runFake(body, args, options) {
  const { dir, env } = fakeTools({ gh: body });
  try {
    return withEnv({ PATH: env.PATH }, () => createGh()(args, options));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the runner returns the exit status, stdout and stderr of gh', () => {
  const result = runFake('echo out\necho err >&2\nexit 0', ['api', 'x']);
  assert.deepEqual(result, { ok: true, status: 0, stdout: 'out\n', stderr: 'err\n' });
});

test('the runner reports a failing gh without throwing', () => {
  const result = runFake('echo "gh: Not Found (HTTP 404)" >&2\nexit 1', ['api', 'x']);
  assert.deepEqual(result, { ok: false, status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)\n' });
});

test('the runner passes its arguments to gh and its input on stdin', () => {
  const result = runFake('printf "%s|" "$@"\ncat', ['api', '--input', '-'], { input: '{"a":1}' });
  assert.equal(result.stdout, 'api|--input|-|{"a":1}');
});

test('the runner drops GH_REPO and keeps the rest of the environment', () => {
  const body = 'echo "GH_REPO=${GH_REPO-unset} KEPT=${KEPT-unset}"';
  const { dir, env } = fakeTools({ gh: body });
  try {
    const result = withEnv({ PATH: env.PATH, GH_REPO: 'other/repo', KEPT: 'yes' }, () => createGh()(['api', 'x']));
    assert.equal(result.stdout, 'GH_REPO=unset KEPT=yes\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the runner says gh is missing when it is not on PATH', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-test-'));
  try {
    assert.throws(
      () => withEnv({ PATH: empty }, () => createGh()(['api', 'x'])),
      (error) => error instanceof GhError && error.message === 'gh is not installed or not on PATH',
    );
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('the runner rethrows a failure to start gh that is not a missing gh', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'gh'), '#!/bin/sh\nexit 0\n', { mode: 0o644 });
    assert.throws(
      () => withEnv({ PATH: dir }, () => createGh()(['api', 'x'])),
      (error) => !(error instanceof GhError) && error.code === 'EACCES',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A runner that records what it is asked and answers with `result`.
function canned(result) {
  const calls = [];
  const gh = (args, options) => {
    calls.push({ args, options });
    return { ok: true, status: 0, stdout: '', stderr: '', ...result };
  };
  gh.calls = calls;
  return gh;
}

test('api builds a GET from the host and the path', () => {
  const gh = canned({ stdout: '{"a":1}' });
  assert.deepEqual(api(gh, 'github.com', 'repos/acme/widgets'), { ok: true, data: { a: 1 } });
  assert.deepEqual(gh.calls[0].args, ['api', '--hostname', 'github.com', 'repos/acme/widgets']);
});

test('api names a method other than GET, and sends a body on stdin', () => {
  const gh = canned({ stdout: '{}' });
  api(gh, 'ghe.example', 'repos/acme/widgets', { method: 'PATCH', body: { a: 1 } });
  assert.deepEqual(gh.calls[0].args, [
    'api', '--hostname', 'ghe.example', '-X', 'PATCH', '--input', '-', 'repos/acme/widgets',
  ]);
  assert.equal(gh.calls[0].options.input, '{"a":1}');
});

test('api returns null data for an empty response', () => {
  assert.deepEqual(api(canned({ stdout: '  \n' }), 'github.com', 'x'), { ok: true, data: null });
});

test('api reports a response that is not JSON', () => {
  assert.deepEqual(api(canned({ stdout: ' <html> \n' }), 'github.com', 'x'), {
    ok: false, httpStatus: null, message: 'response was not JSON', raw: '<html>',
  });
});

test('api reports the HTTP status and the message GitHub sent', () => {
  const gh = canned({ ok: false, status: 1, stdout: '{"message":"Not Found"}\n', stderr: 'gh: Not Found (HTTP 404)\n' });
  assert.deepEqual(api(gh, 'github.com', 'x'), {
    ok: false, httpStatus: 404, message: 'Not Found', raw: '{"message":"Not Found"}',
  });
});

test('api falls back to the first line of stderr when the body has no message', () => {
  for (const stdout of ['', '{"message":7}', 'not json']) {
    const gh = canned({ ok: false, status: 1, stdout, stderr: 'gh: boom\nsecond line\n' });
    assert.equal(api(gh, 'github.com', 'x').message, 'gh: boom');
  }
});

test('api names the exit status when gh said nothing', () => {
  const gh = canned({ ok: false, status: 4, stdout: '', stderr: '' });
  assert.deepEqual(api(gh, 'github.com', 'x'), { ok: false, httpStatus: null, message: 'gh exited 4', raw: '' });
});

test('api asks for a newer gh when it does not know --slurp', () => {
  const gh = canned({ ok: false, status: 1, stderr: 'unknown flag: --slurp\n' });
  assert.throws(
    () => api(gh, 'github.com', 'x', { paginate: true }),
    (error) => error instanceof GhError && /upgrade gh to 2\.42 or later/.test(error.message),
  );
});

test('api flattens paginated pages into one list', () => {
  const gh = canned({ stdout: JSON.stringify([[1, 2], [3], null, { four: 4 }]) });
  assert.deepEqual(api(gh, 'github.com', 'x', { paginate: true }), { ok: true, data: [1, 2, 3, { four: 4 }] });
  assert.deepEqual(gh.calls[0].args, ['api', '--hostname', 'github.com', '--paginate', '--slurp', 'x']);
});

test('api treats a paginated response that is one object as one page', () => {
  const gh = canned({ stdout: '{"a":1}' });
  assert.deepEqual(api(gh, 'github.com', 'x', { paginate: true }), { ok: true, data: [{ a: 1 }] });
});

test('describeFailure puts the HTTP status first, or says there is none', () => {
  assert.equal(describeFailure({ httpStatus: 404, message: 'Not Found' }), 'HTTP 404: Not Found');
  assert.equal(describeFailure({ httpStatus: null, message: 'boom' }), 'no HTTP status: boom');
});
