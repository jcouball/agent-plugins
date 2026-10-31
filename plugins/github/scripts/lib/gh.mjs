// Running the gh CLI. Every call goes through one function so the tests can
// swap in a fake, and every REST call carries the host the repository was
// resolved to, since the same owner and name on another GitHub host is a
// different repository.

import { spawnSync } from 'node:child_process';

export class GhError extends Error {}

// The real runner: `gh(args, { input })` → { ok, status, stdout, stderr }.
// GH_REPO is dropped from the environment, because it would silently point
// `gh repo view` and every relative `gh api` path at another repository.
export function createGh() {
  return function gh(args, { input } = {}) {
    const env = { ...process.env };
    delete env.GH_REPO;
    const result = spawnSync('gh', args, {
      encoding: 'utf8',
      input,
      env,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) {
      if (result.error.code === 'ENOENT') {
        throw new GhError('gh is not installed or not on PATH');
      }
      throw result.error;
    }
    return {
      ok: result.status === 0,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  };
}

function parseJson(text) {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return {};
  }
}

// One REST call. Returns
//   { ok: true, data }
//   { ok: false, httpStatus, message, raw }
// `paginate` fetches every page with --paginate --slurp and flattens the
// per-page arrays into one list.
export function api(gh, host, path, { method = 'GET', body, paginate = false } = {}) {
  const args = ['api', '--hostname', host];
  if (method !== 'GET') args.push('-X', method);
  if (paginate) args.push('--paginate', '--slurp');
  let input;
  if (body !== undefined) {
    args.push('--input', '-');
    input = JSON.stringify(body);
  }
  args.push(path);
  const result = gh(args, { input });
  if (!result.ok) {
    if (/unknown flag: --slurp/.test(result.stderr)) {
      throw new GhError('gh api --slurp is not available; upgrade gh to 2.42 or later');
    }
    const match = /HTTP (\d{3})/.exec(result.stderr);
    const parsed = parseJson(result.stdout);
    const message = (parsed.value && typeof parsed.value.message === 'string')
      ? parsed.value.message
      : result.stderr.trim().split('\n')[0] || `gh exited ${result.status}`;
    return {
      ok: false,
      httpStatus: match ? Number(match[1]) : null,
      message,
      raw: result.stdout.trim(),
    };
  }
  if (result.stdout.trim() === '') return { ok: true, data: null };
  const parsed = parseJson(result.stdout);
  if (!('value' in parsed)) {
    return { ok: false, httpStatus: null, message: 'response was not JSON', raw: result.stdout.trim() };
  }
  if (paginate) {
    const pages = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
    const flattened = [];
    for (const page of pages) {
      if (Array.isArray(page)) flattened.push(...page);
      else if (page !== null) flattened.push(page);
    }
    return { ok: true, data: flattened };
  }
  return { ok: true, data: parsed.value };
}

export function describeFailure(result) {
  const status = result.httpStatus ? `HTTP ${result.httpStatus}` : 'no HTTP status';
  return `${status}: ${result.message}`;
}
