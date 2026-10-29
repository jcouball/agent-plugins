#!/usr/bin/env node
// The deterministic half of the check-repo-config command.
//
//   check-repo-config.mjs audit [--plan-out <file>]
//       Resolve the baseline and the repository, read the live configuration,
//       and print the checklist and the plan as JSON. Writes nothing to GitHub.
//   check-repo-config.mjs apply <plan.json>
//       Re-read, refuse if anything changed since the plan, else perform the
//       plan's writes in order, verify, and print the outcome and a fresh audit.
//   check-repo-config.mjs guidance render
//   check-repo-config.mjs guidance inspect <file>
//   check-repo-config.mjs guidance write <file>
//       The canonical guidance block for the resolved baseline: print it,
//       classify a file's copy of it, or append or refresh it in a file.
//
// Exit codes: 0 done (drift included); 1 usage or a fatal error; 2 baseline
// error, in which case nothing else is reported; 3 the plan is stale;
// 4 a guidance write was refused.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBaseline } from './lib/baseline.mjs';
import { createGh, GhError } from './lib/gh.mjs';
import { readState, resolveRepository, ResolveError } from './lib/read.mjs';
import { audit } from './lib/audit.mjs';
import { applyPlan } from './lib/apply.mjs';
import { inspectText, renderBlock, writeBlock } from './lib/guidance.mjs';

const BASELINE_PATH = '.claude/repo-guardrails.yml';

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message, code = 1) {
  print({ error: message });
  process.exit(code);
}

function git(root, args) {
  const result = spawnSync('git', root ? ['-C', root, ...args] : args, { encoding: 'utf8' });
  return { ok: result.status === 0, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() };
}

function repoRoot() {
  const result = git(null, ['rev-parse', '--show-toplevel']);
  if (!result.ok) fail(`not inside a Git repository: ${result.stderr}`);
  return fs.realpathSync(result.stdout);
}

function isInside(root, resolved) {
  return resolved === root || resolved.startsWith(root + path.sep);
}

function isTracked(root, resolved) {
  return git(root, ['ls-files', '--error-unmatch', '--', path.relative(root, resolved)]).ok;
}

class LocateError extends Error {}

// Where a path really points: its canonical location, whether that is inside
// the repository, whether it exists, and whether it is tracked. A path that
// exists but cannot be read as a file, a dangling symlink or a directory, is
// a LocateError naming the reason.
function locate(root, file) {
  const absolute = path.resolve(root, file);
  let exists = true;
  try {
    fs.lstatSync(absolute);
  } catch {
    exists = false;
  }
  let resolved;
  if (exists) {
    try {
      resolved = fs.realpathSync(absolute);
    } catch {
      throw new LocateError(`${file} is a symlink whose target does not exist`);
    }
    if (fs.statSync(resolved).isDirectory()) throw new LocateError(`${file} is a directory, not a file`);
  } else {
    // For a file to be created, canonicalize its nearest existing parent.
    let parent = path.dirname(absolute);
    while (!fs.existsSync(parent)) parent = path.dirname(parent);
    resolved = path.join(fs.realpathSync(parent), path.relative(parent, absolute));
  }
  const inside = isInside(root, resolved);
  const tracked = exists && inside && isTracked(root, resolved);
  return { path: file, resolved, exists, inside, tracked };
}

function loadBaseline(root) {
  const location = locate(root, BASELINE_PATH);
  if (!location.exists) return resolveBaseline(null);
  if (!location.inside) {
    return { errors: [`${BASELINE_PATH} resolves outside the repository (${location.resolved}); a baseline must be the repository's own`] };
  }
  if (!location.tracked) {
    return { errors: [`${BASELINE_PATH} resolves to an untracked file (${location.resolved}); untracked content is one machine's, not the repository's, and must not drive writes`] };
  }
  return resolveBaseline(fs.readFileSync(location.resolved, 'utf8'), { source: BASELINE_PATH });
}

function requireBaseline(root) {
  const result = loadBaseline(root);
  if (result.errors) {
    print({ baseline_errors: result.errors });
    process.exit(2);
  }
  return result;
}

function parseFlags(args, allowed) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (!allowed.includes(name)) fail(`unknown flag: ${arg}`);
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value`);
      flags[name] = value;
      i += 1;
    } else positional.push(arg);
  }
  return { flags, positional };
}

function runAudit(args) {
  const { flags, positional } = parseFlags(args, ['plan-out']);
  if (positional.length) fail(`unexpected argument: ${positional[0]}`);
  const root = repoRoot();
  const { baseline, source } = requireBaseline(root);
  const gh = createGh();
  const repository = resolveRepository(gh);
  const state = readState(gh, repository, baseline);
  const result = audit(state, baseline);
  if (flags['plan-out']) {
    fs.writeFileSync(flags['plan-out'], `${JSON.stringify(result.plan, null, 2)}\n`);
  }
  print({
    baseline: { source, resolved: baseline },
    repository,
    checks: result.checks,
    plan: { ...result.plan, baseline: undefined, repository: undefined },
    plan_file: flags['plan-out'] ?? null,
  });
}

async function runApply(args) {
  const { positional } = parseFlags(args, []);
  if (positional.length !== 1) fail('usage: check-repo-config.mjs apply <plan.json>');
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(positional[0], 'utf8'));
  } catch (err) {
    fail(`could not read the plan: ${err.message}`);
  }
  const root = repoRoot();
  const { baseline } = requireBaseline(root);
  if (JSON.stringify(baseline) !== JSON.stringify(plan.baseline)) {
    print({ status: 'stale', reason: 'the baseline file changed since the plan was built; run the audit again and confirm the new plan' });
    process.exit(3);
  }
  const gh = createGh();
  const repository = resolveRepository(gh);
  if (JSON.stringify(repository) !== JSON.stringify(plan.repository)) {
    print({ status: 'stale', reason: 'the checkout resolves to a different repository than the plan was built for' });
    process.exit(3);
  }
  const result = await applyPlan({ gh, plan, baseline });
  print(result);
  if (result.status === 'stale') process.exit(3);
}

function runGuidance(args) {
  const [action, file, ...rest] = args;
  if (rest.length) fail(`unexpected argument: ${rest[0]}`);
  const root = repoRoot();
  const { baseline, source } = requireBaseline(root);
  const patterns = baseline.protected_branches;
  if (action === 'render') {
    if (file) fail('usage: check-repo-config.mjs guidance render');
    print({ baseline_source: source, ...renderBlock(patterns) });
    return;
  }
  if (action !== 'inspect' && action !== 'write') fail('usage: check-repo-config.mjs guidance render|inspect <file>|write <file>');
  if (!file) fail(`usage: check-repo-config.mjs guidance ${action} <file>`);
  const location = locate(root, file);
  if (action === 'inspect') {
    const text = location.exists && location.inside ? fs.readFileSync(location.resolved, 'utf8') : '';
    const inspected = location.exists && location.inside
      ? inspectText(text, patterns)
      : { classification: location.exists ? 'external' : 'absent', expected: renderBlock(patterns) };
    print({ file: location, ...inspected });
    return;
  }
  if (!location.inside) {
    print({ file: location, refused: 'the path resolves outside the repository; never write through it' });
    process.exit(4);
  }
  if (location.exists && !location.tracked) {
    print({ file: location, refused: 'a pre-existing untracked file at a target path is the user\'s unfinished work; report the fix as pending until they track or remove it' });
    process.exit(4);
  }
  const before = location.exists ? fs.readFileSync(location.resolved, 'utf8') : '';
  const result = writeBlock(before, patterns);
  if (result.error) {
    print({ file: location, refused: result.error });
    process.exit(4);
  }
  if (result.action !== 'unchanged') {
    fs.mkdirSync(path.dirname(location.resolved), { recursive: true });
    fs.writeFileSync(location.resolved, result.text);
  }
  print({ file: location, action: result.action, created: !location.exists });
}

async function main(argv) {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'audit': return runAudit(rest);
      case 'apply': return await runApply(rest);
      case 'guidance': return runGuidance(rest);
      default:
        return fail('usage: check-repo-config.mjs audit [--plan-out <file>] | apply <plan.json> | guidance render|inspect <file>|write <file>');
    }
  } catch (err) {
    if (err instanceof GhError || err instanceof ResolveError || err instanceof LocateError) return fail(err.message);
    // Every subcommand prints one JSON document, an unforeseen failure included.
    return fail(`unexpected error: ${err?.stack ?? err}`);
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
