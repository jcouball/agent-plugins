import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveBaseline } from './baseline.mjs';
import { GhError } from './gh.mjs';
import { readState, resolveRepository, ResolveError } from './read.mjs';
import { audit } from './audit.mjs';
import { applyPlan } from './apply.mjs';
import { inspectText, renderBlock, writeBlock } from './guidance.mjs';

const BASELINE_PATH = '.claude/repo-guardrails.yml';

function print(stdout, value) {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

// Ends the subcommand with this exit code, and the document to print first if
// it has one. It is thrown to run and not passed to process.exit, which can cut
// off output still queued to a pipe, and a pipe holds 64 KB at most; the
// process ends once its output has been written.
class Exit extends Error {
  constructor(code, document) {
    super(`exit ${code}`);
    this.code = code;
    this.document = document;
  }
}

function fail(message, code = 1) {
  throw new Exit(code, { error: message });
}

class GitMissingError extends Error {}

// git's exit status, and what it printed. A git that did not run at all has
// printed nothing, so it is named here and not read as a repository that is not
// there.
function git({ cwd, env }, root, args) {
  const result = spawnSync('git', root ? ['-C', root, ...args] : args, { encoding: 'utf8', cwd, env });
  if (result.error) {
    if (result.error.code === 'ENOENT') throw new GitMissingError('git is not installed or not on PATH');
    throw result.error;
  }
  return { ok: result.status === 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function repoRoot(ctx) {
  const result = git(ctx, null, ['rev-parse', '--show-toplevel']);
  if (!result.ok) fail(`not inside a Git repository: ${result.stderr}`);
  return fs.realpathSync(result.stdout);
}

function isInside(root, resolved) {
  return resolved === root || resolved.startsWith(root + path.sep);
}

function isTracked(ctx, root, resolved) {
  return git(ctx, root, ['ls-files', '--error-unmatch', '--', path.relative(root, resolved)]).ok;
}

class LocateError extends Error {}

// Where a path really points: its canonical location, whether that is inside
// the repository, whether it exists, and whether it is tracked. A path that
// exists but cannot be read as a file, a dangling symlink or a directory, is
// a LocateError naming the reason.
function locate(ctx, root, file) {
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
  const tracked = exists && inside && isTracked(ctx, root, resolved);
  return { path: file, resolved, exists, inside, tracked };
}

function loadBaseline(ctx, root) {
  const location = locate(ctx, root, BASELINE_PATH);
  if (!location.exists) return resolveBaseline(null);
  if (!location.inside) {
    return { errors: [`${BASELINE_PATH} resolves outside the repository (${location.resolved}); a baseline must be the repository's own`] };
  }
  if (!location.tracked) {
    return { errors: [`${BASELINE_PATH} resolves to an untracked file (${location.resolved}); untracked content is one machine's, not the repository's, and must not drive writes`] };
  }
  return resolveBaseline(fs.readFileSync(location.resolved, 'utf8'), { source: BASELINE_PATH });
}

function requireBaseline(ctx, root) {
  const result = loadBaseline(ctx, root);
  if (result.errors) throw new Exit(2, { baseline_errors: result.errors });
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

function runAudit(ctx, args) {
  const { flags, positional } = parseFlags(args, ['plan-out']);
  if (positional.length) fail(`unexpected argument: ${positional[0]}`);
  const root = repoRoot(ctx);
  const { baseline, source } = requireBaseline(ctx, root);
  const { gh } = ctx;
  const repository = resolveRepository(gh);
  const state = readState(gh, repository, baseline);
  const result = audit(state, baseline);
  if (flags['plan-out']) {
    fs.writeFileSync(path.resolve(ctx.cwd, flags['plan-out']), `${JSON.stringify(result.plan, null, 2)}\n`);
  }
  print(ctx.stdout, {
    baseline: { source, resolved: baseline },
    repository,
    checks: result.checks,
    plan: { ...result.plan, baseline: undefined, repository: undefined },
    plan_file: flags['plan-out'] ?? null,
  });
}

async function runApply(ctx, args) {
  const { positional } = parseFlags(args, []);
  if (positional.length !== 1) fail('usage: check-repo-config.mjs apply <plan.json>');
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(path.resolve(ctx.cwd, positional[0]), 'utf8'));
  } catch (err) {
    fail(`could not read the plan: ${err.message}`);
  }
  const root = repoRoot(ctx);
  const { baseline } = requireBaseline(ctx, root);
  if (JSON.stringify(baseline) !== JSON.stringify(plan.baseline)) {
    throw new Exit(3, { status: 'stale', reason: 'the baseline file changed since the plan was built; run the audit again and confirm the new plan' });
  }
  const { gh } = ctx;
  const repository = resolveRepository(gh);
  if (JSON.stringify(repository) !== JSON.stringify(plan.repository)) {
    throw new Exit(3, { status: 'stale', reason: 'the checkout resolves to a different repository than the plan was built for' });
  }
  const result = await applyPlan({ gh, plan, baseline });
  if (result.status === 'stale') throw new Exit(3, result);
  print(ctx.stdout, result);
}

function runGuidance(ctx, args) {
  const [action, file, ...rest] = args;
  if (rest.length) fail(`unexpected argument: ${rest[0]}`);
  const root = repoRoot(ctx);
  const { baseline, source } = requireBaseline(ctx, root);
  const patterns = baseline.protected_branches;
  if (action === 'render') {
    if (file) fail('usage: check-repo-config.mjs guidance render');
    print(ctx.stdout, { baseline_source: source, ...renderBlock(patterns) });
    return;
  }
  if (action !== 'inspect' && action !== 'write') fail('usage: check-repo-config.mjs guidance render|inspect <file>|write <file>');
  if (!file) fail(`usage: check-repo-config.mjs guidance ${action} <file>`);
  const location = locate(ctx, root, file);
  if (action === 'inspect') {
    const text = location.exists && location.inside ? fs.readFileSync(location.resolved, 'utf8') : '';
    const inspected = location.exists && location.inside
      ? inspectText(text, patterns)
      : { classification: location.exists ? 'external' : 'absent', expected: renderBlock(patterns) };
    print(ctx.stdout, { file: location, ...inspected });
    return;
  }
  if (!location.inside) {
    throw new Exit(4, { file: location, refused: 'the path resolves outside the repository; never write through it' });
  }
  if (location.exists && !location.tracked) {
    throw new Exit(4, { file: location, refused: 'a pre-existing untracked file at a target path is the user\'s unfinished work; report the fix as pending until they track or remove it' });
  }
  const before = location.exists ? fs.readFileSync(location.resolved, 'utf8') : '';
  const result = writeBlock(before, patterns);
  if (result.error) {
    throw new Exit(4, { file: location, refused: result.error });
  }
  if (result.action !== 'unchanged') {
    fs.mkdirSync(path.dirname(location.resolved), { recursive: true });
    fs.writeFileSync(location.resolved, result.text);
  }
  print(ctx.stdout, { file: location, action: result.action, created: !location.exists });
}

// Runs one subcommand and returns its exit code. Everything it needs from the
// outside comes in as an argument: the command line, the directory and
// environment git runs in, `gh` (see createGh), and where the JSON document
// is written.
export async function run({ argv, cwd, env, gh, stdout }) {
  const ctx = { cwd, env, gh, stdout };
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'audit': runAudit(ctx, rest); break;
      case 'apply': await runApply(ctx, rest); break;
      case 'guidance': runGuidance(ctx, rest); break;
      default:
        fail('usage: check-repo-config.mjs audit [--plan-out <file>] | apply <plan.json> | guidance render|inspect <file>|write <file>');
    }
    return 0;
  } catch (err) {
    if (err instanceof Exit) {
      if (err.document) print(stdout, err.document);
      return err.code;
    }
    // Every subcommand prints one JSON document, an unforeseen failure included.
    const known = [GhError, ResolveError, LocateError, GitMissingError].some((type) => err instanceof type);
    print(stdout, { error: known ? err.message : `unexpected error: ${err.stack}` });
    return 1;
  }
}
