import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, compliantRoutes, fakeGh } from './fake-gh.mjs';
import { compliantRepository, repository, track, write } from './fake-repository.mjs';
import { GhError } from './lib/gh.mjs';
import { run } from './lib/run.mjs';

const noGh = () => {
  throw new Error('gh must not be called');
};

// Runs the command in `cwd` and returns what the script would have printed and
// exited with. `gh` is a fake from fake-gh.mjs; a run that never reaches gh
// gets one that fails the test if it is called.
async function runIn(cwd, argv, { gh = noGh, env = process.env } = {}) {
  const chunks = [];
  const status = await run({ argv, cwd, env, gh, stdout: { write: (text) => chunks.push(text) } });
  const stdout = chunks.join('');
  let json;
  try {
    json = JSON.parse(stdout);
  } catch {
    json = undefined;
  }
  return { status, stdout, json, calls: gh.calls };
}

const ISSUES = (checks) => checks.filter((check) => check.status !== 'pass');

test('a dangling symlink at a guidance target is a JSON error, not a stack trace', async () => {
  const dir = repository();
  fs.symlinkSync(path.join(dir, 'missing-target'), path.join(dir, 'CLAUDE.md'));
  for (const action of ['inspect', 'write']) {
    const result = await runIn(dir, ['guidance', action, 'CLAUDE.md']);
    assert.equal(result.status, 1);
    assert.match(result.json.error, /CLAUDE\.md is a symlink whose target does not exist/);
  }
});

test('a directory at a guidance target is a JSON error', async () => {
  const dir = repository();
  fs.mkdirSync(path.join(dir, 'CLAUDE.md'));
  const result = await runIn(dir, ['guidance', 'inspect', 'CLAUDE.md']);
  assert.equal(result.status, 1);
  assert.match(result.json.error, /CLAUDE\.md is a directory, not a file/);
});

test('a dangling symlink at the baseline path stops every subcommand with a JSON error', async () => {
  const dir = repository();
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.symlinkSync(path.join(dir, 'missing-target'), path.join(dir, '.claude', 'repo-guardrails.yml'));
  const result = await runIn(dir, ['guidance', 'render']);
  assert.equal(result.status, 1);
  assert.match(result.json.error, /repo-guardrails\.yml is a symlink whose target does not exist/);
});

test('a flag that names a file fails usage when the value is missing', async () => {
  const dir = repository();
  const missing = await runIn(dir, ['audit', '--plan-out']);
  assert.match(missing.json.error, /--plan-out needs a value/);
  assert.equal(missing.status, 1);
  assert.match((await runIn(dir, ['audit', '--plan-out', '--plan-out'])).json.error, /--plan-out needs a value/);
});

test('audit prints the checklist and an empty plan for a compliant repository', async () => {
  const result = await runIn(compliantRepository(), ['audit'], { gh: fakeGh(compliantRoutes()) });
  assert.equal(result.status, 0);
  assert.equal(result.json.baseline.source, '.claude/repo-guardrails.yml');
  assert.deepEqual(result.json.repository, REPO);
  assert.deepEqual(ISSUES(result.json.checks), []);
  assert.deepEqual(result.json.plan.steps, []);
  assert.equal(result.json.plan_file, null);
});

test('audit --plan-out writes the plan, and apply performs it', async () => {
  const dir = compliantRepository();
  const routes = compliantRoutes();
  routes['GET repos/acme/widgets'] = { ...routes['GET repos/acme/widgets'], allow_merge_commit: true };
  routes['PATCH repos/acme/widgets'] = { allow_merge_commit: false };
  const planFile = path.join(dir, 'plan.json');

  const audited = await runIn(dir, ['audit', '--plan-out', planFile], { gh: fakeGh(routes) });
  assert.equal(audited.status, 0);
  assert.equal(audited.json.plan_file, planFile);
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  assert.deepEqual(plan.steps.map((step) => step.kind), ['patch_settings']);

  const applied = await runIn(dir, ['apply', planFile], { gh: fakeGh(routes) });
  assert.equal(applied.status, 0);
  assert.equal(applied.json.status, 'applied');
  assert.deepEqual(applied.json.steps.map((step) => step.status), ['applied']);
  assert.deepEqual(
    applied.calls.filter((call) => call.method === 'PATCH'),
    [{ method: 'PATCH', path: 'repos/acme/widgets', body: { allow_merge_commit: false } }],
  );
});

test('relative plan paths are resolved against the directory run() is given, not the process\'s own', async () => {
  const dir = compliantRepository();
  const routes = compliantRoutes();
  routes['GET repos/acme/widgets'] = { ...routes['GET repos/acme/widgets'], allow_merge_commit: true };
  routes['PATCH repos/acme/widgets'] = { allow_merge_commit: false };
  const strayFile = path.join(process.cwd(), 'relative-plan.json');
  assert.equal(fs.existsSync(strayFile), false);

  const audited = await runIn(dir, ['audit', '--plan-out', 'relative-plan.json'], { gh: fakeGh(routes) });
  assert.equal(audited.status, 0);
  assert.equal(audited.json.plan_file, 'relative-plan.json');
  assert.equal(fs.existsSync(path.join(dir, 'relative-plan.json')), true);
  assert.equal(fs.existsSync(strayFile), false);

  const applied = await runIn(dir, ['apply', 'relative-plan.json'], { gh: fakeGh(routes) });
  assert.equal(applied.status, 0);
  assert.equal(applied.json.status, 'applied');
});

test('apply exits 3 when the repository changed since the plan', async () => {
  const dir = compliantRepository();
  const routes = compliantRoutes();
  routes['GET repos/acme/widgets'] = { ...routes['GET repos/acme/widgets'], allow_merge_commit: true };
  const planFile = path.join(dir, 'plan.json');
  assert.equal((await runIn(dir, ['audit', '--plan-out', planFile], { gh: fakeGh(routes) })).status, 0);
  routes['GET repos/acme/widgets'].allow_squash_merge = true;
  const result = await runIn(dir, ['apply', planFile], { gh: fakeGh(routes) });
  assert.equal(result.status, 3);
  assert.equal(result.json.status, 'stale');
  assert.match(result.json.reason, /the repository changed since the plan was built/);
  assert.deepEqual(result.calls.filter((call) => call.method === 'PATCH'), []);
});

test('apply exits 3 when the baseline file changed since the plan', async () => {
  const dir = compliantRepository();
  const planFile = path.join(dir, 'plan.json');
  assert.equal((await runIn(dir, ['audit', '--plan-out', planFile], { gh: fakeGh(compliantRoutes()) })).status, 0);
  write(dir, '.claude/repo-guardrails.yml', 'protected_branches: [main, "release/*"]\n');
  track(dir, '.claude/repo-guardrails.yml');
  const result = await runIn(dir, ['apply', planFile], { gh: fakeGh(compliantRoutes()) });
  assert.equal(result.status, 3);
  assert.match(result.json.reason, /the baseline file changed since the plan was built/);
});

test('apply exits 3 when the checkout resolves to another repository', async () => {
  const dir = compliantRepository();
  const planFile = path.join(dir, 'plan.json');
  assert.equal((await runIn(dir, ['audit', '--plan-out', planFile], { gh: fakeGh(compliantRoutes()) })).status, 0);
  const elsewhere = {
    url: 'https://github.com/acme/gadgets', owner: { login: 'acme' }, name: 'gadgets', isInOrganization: true,
  };
  const result = await runIn(dir, ['apply', planFile], { gh: fakeGh(compliantRoutes(), { repoView: elsewhere }) });
  assert.equal(result.status, 3);
  assert.match(result.json.reason, /resolves to a different repository than the plan was built for/);
});

test('apply needs exactly one plan file, and one it can read', async () => {
  const dir = repository();
  for (const argv of [['apply'], ['apply', 'a.json', 'b.json']]) {
    const result = await runIn(dir, argv);
    assert.equal(result.status, 1);
    assert.equal(result.json.error, 'usage: check-repo-config.mjs apply <plan.json>');
  }
  const unreadable = await runIn(dir, ['apply', 'missing.json']);
  assert.equal(unreadable.status, 1);
  assert.match(unreadable.json.error, /^could not read the plan: /);
});

test('an unknown command, flag or argument is a usage error', async () => {
  const dir = repository();
  assert.match((await runIn(dir, [])).json.error, /^usage: check-repo-config\.mjs audit /);
  assert.match((await runIn(dir, ['nonsense'])).json.error, /^usage: /);
  assert.equal((await runIn(dir, ['audit', '--nope', 'x'])).json.error, 'unknown flag: --nope');
  assert.equal((await runIn(dir, ['audit', 'extra'])).json.error, 'unexpected argument: extra');
});

test('an invalid baseline stops the subcommand with exit 2 and its errors', async () => {
  const dir = repository();
  write(dir, '.claude/repo-guardrails.yml', 'no_such_key: true\n');
  track(dir, '.claude/repo-guardrails.yml');
  for (const argv of [['audit'], ['guidance', 'render']]) {
    const result = await runIn(dir, argv);
    assert.equal(result.status, 2);
    assert.ok(result.json.baseline_errors.length > 0);
  }
});

test('a baseline that is untracked, or that points outside the repository, is refused', async () => {
  const untracked = repository();
  write(untracked, '.claude/repo-guardrails.yml', 'protected_branches: [main]\n');
  assert.match((await runIn(untracked, ['audit'])).json.baseline_errors[0], /resolves to an untracked file/);

  const outside = repository();
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'check-repo-config-outside-')), 'baseline.yml');
  fs.writeFileSync(target, 'protected_branches: [main]\n');
  fs.mkdirSync(path.join(outside, '.claude'));
  fs.symlinkSync(target, path.join(outside, '.claude', 'repo-guardrails.yml'));
  assert.match((await runIn(outside, ['audit'])).json.baseline_errors[0], /resolves outside the repository/);
});

test('a tracked baseline file drives the audit', async () => {
  const result = await runIn(compliantRepository(), ['audit'], { gh: fakeGh(compliantRoutes()) });
  assert.equal(result.status, 0);
  assert.equal(result.json.baseline.source, '.claude/repo-guardrails.yml');
  assert.deepEqual(result.json.baseline.resolved.protected_branches, ['main']);
});

test('outside a Git repository the script says so', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-repo-config-bare-'));
  const result = await runIn(dir, ['audit'], {
    env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) },
  });
  assert.equal(result.status, 1);
  assert.match(result.json.error, /^not inside a Git repository: /);
});

test('a missing gh is reported as an error, not a stack trace', async () => {
  const gh = () => {
    throw new GhError('gh is not installed or not on PATH');
  };
  const result = await runIn(compliantRepository(), ['audit'], { gh });
  assert.equal(result.status, 1);
  assert.equal(result.json.error, 'gh is not installed or not on PATH');
});

test('a failure nothing foresaw is still one JSON document', async () => {
  const dir = compliantRepository();
  const planFile = path.join(dir, 'missing-dir', 'plan.json');
  const result = await runIn(dir, ['audit', '--plan-out', planFile], { gh: fakeGh(compliantRoutes()) });
  assert.equal(result.status, 1);
  assert.match(result.json.error, /^unexpected error: .*ENOENT/s);
});

test('a missing git is reported as missing, not as a directory that is not a repository', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'check-repo-config-nogit-'));
  const result = await runIn(repository(), ['audit'], { env: { PATH: empty } });
  assert.equal(result.status, 1);
  assert.equal(result.json.error, 'git is not installed or not on PATH');
});

test('a git that cannot be started for another reason is an unexpected error, not a missing git', async () => {
  const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'check-repo-config-badgit-'));
  fs.writeFileSync(path.join(broken, 'git'), '#!/bin/sh\nexit 0\n', { mode: 0o644 });
  const result = await runIn(repository(), ['audit'], { env: { PATH: broken } });
  assert.equal(result.status, 1);
  assert.match(result.json.error, /^unexpected error: .*EACCES/s);
});

// ---------------------------------------------------------------------------
// guidance

test('guidance render prints the block for the baseline', async () => {
  const result = await runIn(repository(), ['guidance', 'render']);
  assert.equal(result.status, 0);
  assert.equal(result.json.baseline_source, 'built-in defaults');
  assert.match(result.json.block, /^<!-- jcouball-github guardrails: begin sha256:[0-9a-f]{12} -->\n/);
  assert.match(result.json.body, /^Never commit or push to `main` or `master`\./);
});

test('guidance fails usage on a missing action, file or argument', async () => {
  const dir = repository();
  const usage = (...args) => runIn(dir, ['guidance', ...args]);
  assert.equal((await usage('render', 'CLAUDE.md')).json.error, 'usage: check-repo-config.mjs guidance render');
  assert.equal((await usage('nonsense')).json.error, 'usage: check-repo-config.mjs guidance render|inspect <file>|write <file>');
  assert.equal((await usage()).json.error, 'usage: check-repo-config.mjs guidance render|inspect <file>|write <file>');
  assert.equal((await usage('inspect')).json.error, 'usage: check-repo-config.mjs guidance inspect <file>');
  assert.equal((await usage('write')).json.error, 'usage: check-repo-config.mjs guidance write <file>');
  assert.equal((await usage('inspect', 'CLAUDE.md', 'extra')).json.error, 'unexpected argument: extra');
  for (const args of [['render', 'a'], ['inspect'], ['write']]) assert.equal((await usage(...args)).status, 1);
});

test('guidance inspect classifies a file by the block it carries', async () => {
  const dir = repository();
  const classify = async (file) => (await runIn(dir, ['guidance', 'inspect', file])).json;
  assert.equal((await classify('CLAUDE.md')).classification, 'absent');
  assert.equal((await classify('CLAUDE.md')).file.exists, false);

  write(dir, 'plain.md', '# Notes\n');
  assert.equal((await classify('plain.md')).classification, 'absent');
  assert.equal((await classify('plain.md')).file.exists, true);

  const written = await runIn(dir, ['guidance', 'write', 'CLAUDE.md']);
  assert.equal(written.json.action, 'appended');
  assert.equal((await classify('CLAUDE.md')).classification, 'machine-current');

  write(dir, 'bad.md', '<!-- jcouball-github guardrails: end -->\n');
  assert.equal((await classify('bad.md')).classification, 'malformed');
});

test('guidance inspect calls a file outside the repository external', async () => {
  const dir = repository();
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'check-repo-config-outside-')), 'CLAUDE.md');
  fs.writeFileSync(outside, 'anything\n');
  fs.symlinkSync(outside, path.join(dir, 'CLAUDE.md'));
  const result = (await runIn(dir, ['guidance', 'inspect', 'CLAUDE.md'])).json;
  assert.equal(result.classification, 'external');
  assert.equal(result.file.inside, false);
});

test('guidance inspect calls a path outside the repository that does not exist absent', async () => {
  const result = (await runIn(repository(), ['guidance', 'inspect', '../not-here.md'])).json;
  assert.equal(result.classification, 'absent');
  assert.equal(result.file.inside, false);
});

test('guidance write creates a file, leaves a current one alone, and rewrites a stale one', async () => {
  const dir = repository();
  const first = await runIn(dir, ['guidance', 'write', 'docs/CLAUDE.md']);
  assert.equal(first.status, 0);
  assert.deepEqual([first.json.action, first.json.created], ['appended', true]);
  track(dir, 'docs/CLAUDE.md');

  const again = await runIn(dir, ['guidance', 'write', 'docs/CLAUDE.md']);
  assert.deepEqual([again.json.action, again.json.created], ['unchanged', false]);

  // The same block rendered for another baseline is stale under this one.
  write(dir, '.claude/repo-guardrails.yml', 'protected_branches: [main]\n');
  track(dir, '.claude/repo-guardrails.yml');
  const rewritten = await runIn(dir, ['guidance', 'write', 'docs/CLAUDE.md']);
  assert.deepEqual([rewritten.json.action, rewritten.json.created], ['rewritten', false]);
  assert.match(fs.readFileSync(path.join(dir, 'docs', 'CLAUDE.md'), 'utf8'), /Never commit or push to `main`\./);
});

test('guidance write refuses a path outside the repository, with exit 4', async () => {
  const dir = repository();
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'check-repo-config-outside-')), 'CLAUDE.md');
  fs.writeFileSync(outside, 'kept\n');
  fs.symlinkSync(outside, path.join(dir, 'CLAUDE.md'));
  const result = await runIn(dir, ['guidance', 'write', 'CLAUDE.md']);
  assert.equal(result.status, 4);
  assert.match(result.json.refused, /resolves outside the repository/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'kept\n');
});

test('guidance write refuses an existing untracked file, with exit 4', async () => {
  const dir = repository();
  write(dir, 'CLAUDE.md', 'unfinished work\n');
  const result = await runIn(dir, ['guidance', 'write', 'CLAUDE.md']);
  assert.equal(result.status, 4);
  assert.match(result.json.refused, /unfinished work/);
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'unfinished work\n');
});

test('guidance write refuses a block that was edited, or whose markers are malformed, with exit 4', async () => {
  const dir = repository();
  const block = (await runIn(dir, ['guidance', 'render'])).json.block;
  write(dir, 'edited.md', block.replace('Never commit', 'Please do not commit'));
  write(dir, 'malformed.md', `${block}${block}`);
  track(dir, 'edited.md', 'malformed.md');
  const edited = await runIn(dir, ['guidance', 'write', 'edited.md']);
  assert.equal(edited.status, 4);
  assert.match(edited.json.refused, /the block was edited/);
  const malformed = await runIn(dir, ['guidance', 'write', 'malformed.md']);
  assert.equal(malformed.status, 4);
  assert.match(malformed.json.refused, /the markers are malformed \(2 begin markers and 2 end markers\)/);
});

// ---------------------------------------------------------------------------
// The contract of run()

test('run ends every kind of failure by returning a code, never by calling process.exit', async () => {
  const exit = mock.method(process, 'exit', () => {
    throw new Error('process.exit was called');
  });
  try {
    const bad = repository();
    write(bad, '.claude/repo-guardrails.yml', 'no_such_key: true\n');
    track(bad, '.claude/repo-guardrails.yml');
    const dir = compliantRepository();
    const planFile = path.join(dir, 'plan.json');
    await runIn(dir, ['audit', '--plan-out', planFile], { gh: fakeGh(compliantRoutes()) });
    write(dir, '.claude/repo-guardrails.yml', 'protected_branches: [main, "release/*"]\n');
    track(dir, '.claude/repo-guardrails.yml');
    const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'check-repo-config-outside-')), 'CLAUDE.md');
    fs.writeFileSync(outside, 'kept\n');
    fs.symlinkSync(outside, path.join(dir, 'CLAUDE.md'));

    const codes = [
      (await runIn(dir, ['nonsense'])).status,
      (await runIn(bad, ['audit'])).status,
      (await runIn(dir, ['apply', planFile], { gh: fakeGh(compliantRoutes()) })).status,
      (await runIn(dir, ['guidance', 'write', 'CLAUDE.md'])).status,
      (await runIn(dir, ['audit', '--plan-out', path.join(dir, 'no-dir', 'p.json')], { gh: fakeGh(compliantRoutes()) })).status,
      (await runIn(dir, ['guidance', 'render'])).status,
    ];
    assert.deepEqual(codes, [1, 2, 3, 4, 1, 0]);
    assert.equal(exit.mock.callCount(), 0);
  } finally {
    exit.mock.restore();
  }
});
