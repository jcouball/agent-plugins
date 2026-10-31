import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeTools, linkTools } from '../../../scripts/fake-executable.mjs';
import { REPO, compliantRoutes } from './fake-gh.mjs';

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

// ---------------------------------------------------------------------------
// The subcommands that call gh. A fake gh executable on PATH serves the routes
// in fake-gh.mjs from a state file the test writes, and logs each call.

const FAKE_GH_CLI = fileURLToPath(new URL('./fake-gh-cli.mjs', import.meta.url));

function sh(text) {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

// Run the script in `cwd` with the fake gh serving `routes`. `drift` lists
// settings to change from the compliant defaults before the run.
function runGh(cwd, routes, args, { repoView } = {}) {
  const { dir, env } = fakeTools({ gh: `exec ${sh(process.execPath)} ${sh(FAKE_GH_CLI)} "$@"` });
  const state = path.join(dir, 'state.json');
  const log = path.join(dir, 'calls.log');
  fs.writeFileSync(state, JSON.stringify({ routes, repoView }));
  try {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...env, FAKE_GH_STATE: state, FAKE_GH_LOG: log },
    });
    let json;
    try {
      json = JSON.parse(result.stdout);
    } catch {
      json = undefined;
    }
    const calls = fs.existsSync(log)
      ? fs.readFileSync(log, 'utf8').trimEnd().split('\n').map((line) => JSON.parse(line))
      : [];
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, json, calls };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function track(dir, ...files) {
  const add = spawnSync('git', ['-C', dir, 'add', '--', ...files], { encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr);
}

function write(dir, file, text) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}

// A repository whose tracked baseline protects only main, which is what the
// compliant routes describe: one ruleset on main, and no master.
function compliantRepository() {
  const dir = repository();
  write(dir, '.claude/repo-guardrails.yml', 'protected_branches: [main]\n');
  track(dir, '.claude/repo-guardrails.yml');
  return dir;
}

const ISSUES = (checks) => checks.filter((check) => check.status !== 'pass');

test('audit prints the checklist and an empty plan for a compliant repository', () => {
  const result = runGh(compliantRepository(), compliantRoutes(), ['audit']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.baseline.source, '.claude/repo-guardrails.yml');
  assert.deepEqual(result.json.repository, REPO);
  assert.deepEqual(ISSUES(result.json.checks), []);
  assert.deepEqual(result.json.plan.steps, []);
  assert.equal(result.json.plan_file, null);
});

test('audit --plan-out writes the plan, and apply performs it', () => {
  const dir = compliantRepository();
  const routes = compliantRoutes();
  routes['GET repos/acme/widgets'] = { ...routes['GET repos/acme/widgets'], allow_merge_commit: true };
  routes['PATCH repos/acme/widgets'] = { allow_merge_commit: false };
  const planFile = path.join(dir, 'plan.json');

  const audited = runGh(dir, routes, ['audit', '--plan-out', planFile]);
  assert.equal(audited.status, 0, audited.stderr);
  assert.equal(audited.json.plan_file, planFile);
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  assert.deepEqual(plan.steps.map((step) => step.kind), ['patch_settings']);

  const applied = runGh(dir, routes, ['apply', planFile]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.json.status, 'applied');
  assert.deepEqual(applied.json.steps.map((step) => step.status), ['applied']);
  assert.deepEqual(
    applied.calls.filter((call) => call.method === 'PATCH'),
    [{ method: 'PATCH', path: 'repos/acme/widgets', body: { allow_merge_commit: false } }],
  );
});

test('apply exits 3 when the repository changed since the plan', () => {
  const dir = compliantRepository();
  const routes = compliantRoutes();
  routes['GET repos/acme/widgets'] = { ...routes['GET repos/acme/widgets'], allow_merge_commit: true };
  const planFile = path.join(dir, 'plan.json');
  assert.equal(runGh(dir, routes, ['audit', '--plan-out', planFile]).status, 0);
  routes['GET repos/acme/widgets'].allow_squash_merge = true;
  const result = runGh(dir, routes, ['apply', planFile]);
  assert.equal(result.status, 3);
  assert.equal(result.json.status, 'stale');
  assert.match(result.json.reason, /the repository changed since the plan was built/);
  assert.deepEqual(result.calls.filter((call) => call.method === 'PATCH'), []);
});

test('apply exits 3 when the baseline file changed since the plan', () => {
  const dir = compliantRepository();
  const planFile = path.join(dir, 'plan.json');
  assert.equal(runGh(dir, compliantRoutes(), ['audit', '--plan-out', planFile]).status, 0);
  write(dir, '.claude/repo-guardrails.yml', 'protected_branches: [main, "release/*"]\n');
  track(dir, '.claude/repo-guardrails.yml');
  const result = runGh(dir, compliantRoutes(), ['apply', planFile]);
  assert.equal(result.status, 3);
  assert.match(result.json.reason, /the baseline file changed since the plan was built/);
});

test('apply exits 3 when the checkout resolves to another repository', () => {
  const dir = compliantRepository();
  const planFile = path.join(dir, 'plan.json');
  assert.equal(runGh(dir, compliantRoutes(), ['audit', '--plan-out', planFile]).status, 0);
  const elsewhere = {
    url: 'https://github.com/acme/gadgets', owner: { login: 'acme' }, name: 'gadgets', isInOrganization: true,
  };
  const result = runGh(dir, compliantRoutes(), ['apply', planFile], { repoView: elsewhere });
  assert.equal(result.status, 3);
  assert.match(result.json.reason, /resolves to a different repository than the plan was built for/);
});

test('apply needs exactly one plan file, and one it can read', () => {
  const dir = repository();
  for (const args of [['apply'], ['apply', 'a.json', 'b.json']]) {
    const result = runGh(dir, compliantRoutes(), args);
    assert.equal(result.status, 1);
    assert.equal(result.json.error, 'usage: check-repo-config.mjs apply <plan.json>');
  }
  const unreadable = runGh(dir, compliantRoutes(), ['apply', 'missing.json']);
  assert.equal(unreadable.status, 1);
  assert.match(unreadable.json.error, /^could not read the plan: /);
});

test('an unknown command, flag or argument is a usage error', () => {
  const dir = repository();
  assert.match(run(dir).json.error, /^usage: check-repo-config\.mjs audit /);
  assert.match(run(dir, 'nonsense').json.error, /^usage: /);
  assert.equal(run(dir, 'audit', '--nope', 'x').json.error, 'unknown flag: --nope');
  assert.equal(run(dir, 'audit', 'extra').json.error, 'unexpected argument: extra');
});

test('an invalid baseline stops the subcommand with exit 2 and its errors', () => {
  const dir = repository();
  write(dir, '.claude/repo-guardrails.yml', 'no_such_key: true\n');
  track(dir, '.claude/repo-guardrails.yml');
  for (const args of [['audit'], ['guidance', 'render']]) {
    const result = run(dir, ...args);
    assert.equal(result.status, 2);
    assert.ok(result.json.baseline_errors.length > 0);
  }
});

test('a baseline that is untracked, or that points outside the repository, is refused', () => {
  const untracked = repository();
  write(untracked, '.claude/repo-guardrails.yml', 'protected_branches: [main]\n');
  assert.match(run(untracked, 'audit').json.baseline_errors[0], /resolves to an untracked file/);

  const outside = repository();
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'check-repo-config-outside-')), 'baseline.yml');
  fs.writeFileSync(target, 'protected_branches: [main]\n');
  fs.mkdirSync(path.join(outside, '.claude'));
  fs.symlinkSync(target, path.join(outside, '.claude', 'repo-guardrails.yml'));
  assert.match(run(outside, 'audit').json.baseline_errors[0], /resolves outside the repository/);
});

test('a tracked baseline file drives the audit', () => {
  const dir = repository();
  write(dir, '.claude/repo-guardrails.yml', 'protected_branches: [main]\n');
  track(dir, '.claude/repo-guardrails.yml');
  const result = runGh(dir, compliantRoutes(), ['audit']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.baseline.source, '.claude/repo-guardrails.yml');
  assert.deepEqual(result.json.baseline.resolved.protected_branches, ['main']);
});

test('outside a Git repository the script says so', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-repo-config-bare-'));
  const result = spawnSync(process.execPath, [SCRIPT, 'audit'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) },
  });
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /^not inside a Git repository: /);
});

test('a missing gh is reported as an error, not a stack trace', () => {
  const dir = repository();
  // Only git on PATH, since the script runs git before it ever calls gh.
  const { dir: tools, env } = fakeTools({});
  try {
    linkTools(tools, ['git']);
    const result = spawnSync(process.execPath, [SCRIPT, 'audit'], { cwd: dir, encoding: 'utf8', env: { ...env, PATH: tools } });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).error, 'gh is not installed or not on PATH');
  } finally {
    fs.rmSync(tools, { recursive: true, force: true });
  }
});

test('a failure nothing foresaw is still one JSON document', () => {
  const dir = compliantRepository();
  const result = runGh(dir, compliantRoutes(), ['audit', '--plan-out', path.join(dir, 'missing-dir', 'plan.json')]);
  assert.equal(result.status, 1);
  assert.match(result.json.error, /^unexpected error: .*ENOENT/s);
});

test('a missing git is reported as not being in a repository', () => {
  const dir = repository();
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'check-repo-config-nogit-'));
  const result = spawnSync(process.execPath, [SCRIPT, 'audit'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: empty } });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error, 'not inside a Git repository: ');
});

// ---------------------------------------------------------------------------
// guidance

test('guidance render prints the block for the baseline', () => {
  const result = run(repository(), 'guidance', 'render');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.baseline_source, 'built-in defaults');
  assert.match(result.json.block, /^<!-- jcouball-github guardrails: begin sha256:[0-9a-f]{12} -->\n/);
  assert.match(result.json.body, /^Never commit or push to `main` or `master`\./);
});

test('guidance fails usage on a missing action, file or argument', () => {
  const dir = repository();
  const usage = (...args) => run(dir, 'guidance', ...args);
  assert.equal(usage('render', 'CLAUDE.md').json.error, 'usage: check-repo-config.mjs guidance render');
  assert.equal(usage('nonsense').json.error, 'usage: check-repo-config.mjs guidance render|inspect <file>|write <file>');
  assert.equal(usage().json.error, 'usage: check-repo-config.mjs guidance render|inspect <file>|write <file>');
  assert.equal(usage('inspect').json.error, 'usage: check-repo-config.mjs guidance inspect <file>');
  assert.equal(usage('write').json.error, 'usage: check-repo-config.mjs guidance write <file>');
  assert.equal(usage('inspect', 'CLAUDE.md', 'extra').json.error, 'unexpected argument: extra');
  for (const args of [['render', 'a'], ['inspect'], ['write']]) assert.equal(usage(...args).status, 1);
});

test('guidance inspect classifies a file by the block it carries', () => {
  const dir = repository();
  const classify = (file) => run(dir, 'guidance', 'inspect', file).json;
  assert.equal(classify('CLAUDE.md').classification, 'absent');
  assert.equal(classify('CLAUDE.md').file.exists, false);

  write(dir, 'plain.md', '# Notes\n');
  assert.equal(classify('plain.md').classification, 'absent');
  assert.equal(classify('plain.md').file.exists, true);

  const written = run(dir, 'guidance', 'write', 'CLAUDE.md');
  assert.equal(written.json.action, 'appended');
  assert.equal(classify('CLAUDE.md').classification, 'machine-current');

  write(dir, 'bad.md', '<!-- jcouball-github guardrails: end -->\n');
  assert.equal(classify('bad.md').classification, 'malformed');
});

test('guidance inspect calls a file outside the repository external', () => {
  const dir = repository();
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'check-repo-config-outside-')), 'CLAUDE.md');
  fs.writeFileSync(outside, 'anything\n');
  fs.symlinkSync(outside, path.join(dir, 'CLAUDE.md'));
  const result = run(dir, 'guidance', 'inspect', 'CLAUDE.md').json;
  assert.equal(result.classification, 'external');
  assert.equal(result.file.inside, false);
});

test('guidance inspect calls a path outside the repository that does not exist absent', () => {
  const dir = repository();
  const result = run(dir, 'guidance', 'inspect', '../not-here.md').json;
  assert.equal(result.classification, 'absent');
  assert.equal(result.file.inside, false);
});

test('guidance write creates a file, leaves a current one alone, and rewrites a stale one', () => {
  const dir = repository();
  const first = run(dir, 'guidance', 'write', 'docs/CLAUDE.md');
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual([first.json.action, first.json.created], ['appended', true]);
  track(dir, 'docs/CLAUDE.md');

  const again = run(dir, 'guidance', 'write', 'docs/CLAUDE.md');
  assert.deepEqual([again.json.action, again.json.created], ['unchanged', false]);

  // The same block rendered for another baseline is stale under this one.
  write(dir, '.claude/repo-guardrails.yml', 'protected_branches: [main]\n');
  track(dir, '.claude/repo-guardrails.yml');
  const rewritten = run(dir, 'guidance', 'write', 'docs/CLAUDE.md');
  assert.deepEqual([rewritten.json.action, rewritten.json.created], ['rewritten', false]);
  assert.match(fs.readFileSync(path.join(dir, 'docs', 'CLAUDE.md'), 'utf8'), /Never commit or push to `main`\./);
});

test('guidance write refuses a path outside the repository, with exit 4', () => {
  const dir = repository();
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'check-repo-config-outside-')), 'CLAUDE.md');
  fs.writeFileSync(outside, 'kept\n');
  fs.symlinkSync(outside, path.join(dir, 'CLAUDE.md'));
  const result = run(dir, 'guidance', 'write', 'CLAUDE.md');
  assert.equal(result.status, 4);
  assert.match(result.json.refused, /resolves outside the repository/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'kept\n');
});

test('guidance write refuses an existing untracked file, with exit 4', () => {
  const dir = repository();
  write(dir, 'CLAUDE.md', 'unfinished work\n');
  const result = run(dir, 'guidance', 'write', 'CLAUDE.md');
  assert.equal(result.status, 4);
  assert.match(result.json.refused, /unfinished work/);
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'unfinished work\n');
});

test('guidance write refuses a block that was edited, or whose markers are malformed, with exit 4', () => {
  const dir = repository();
  const block = run(dir, 'guidance', 'render').json.block;
  write(dir, 'edited.md', block.replace('Never commit', 'Please do not commit'));
  write(dir, 'malformed.md', `${block}${block}`);
  track(dir, 'edited.md', 'malformed.md');
  const edited = run(dir, 'guidance', 'write', 'edited.md');
  assert.equal(edited.status, 4);
  assert.match(edited.json.refused, /the block was edited/);
  const malformed = run(dir, 'guidance', 'write', 'malformed.md');
  assert.equal(malformed.status, 4);
  assert.match(malformed.json.refused, /the markers are malformed \(2 begin markers and 2 end markers\)/);
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
  assert.equal(runGh(dir, routes, ['audit', '--plan-out', planFile]).status, 0);
  routes['GET repos/acme/widgets'] = { ...routes['GET repos/acme/widgets'], allow_squash_merge: true };
  const result = runGh(dir, routes, ['apply', planFile]);
  assert.equal(result.status, 3);
  assert.ok(result.stdout.length > 64 * 1024, `the document is only ${result.stdout.length} bytes`);
  assert.equal(result.json.status, 'stale');
  assert.ok(result.json.audit.checks.length > 100);
});
