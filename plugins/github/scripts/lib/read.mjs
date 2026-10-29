// Reading the repository's live configuration: settings, the Actions token
// default, the protected branches and their effective rules, and every
// branch ruleset with its full definition. Nothing here compares or judges;
// the result is a plain record of what each read returned, failures
// included, for audit.mjs to work from.

import { createHash } from 'node:crypto';
import { api } from './gh.mjs';
import { matchesPattern } from './glob.mjs';

export class ResolveError extends Error {}

export const SETTINGS_FIELDS = [
  'allow_merge_commit',
  'allow_squash_merge',
  'allow_rebase_merge',
  'delete_branch_on_merge',
  'allow_auto_merge',
];

export const ACTIONS_FIELDS = ['default_workflow_permissions', 'can_approve_pull_request_reviews'];

// Resolve the host, owner, name, and whether the owner is an organization
// from the checkout's Git remote through gh's own URL parser.
export function resolveRepository(gh) {
  const result = gh(['repo', 'view', '--json', 'url,owner,name,isInOrganization']);
  if (!result.ok) {
    throw new ResolveError(
      `could not resolve the repository from the checkout: ${result.stderr.trim() || 'gh repo view failed'}`,
    );
  }
  let view;
  try {
    view = JSON.parse(result.stdout);
  } catch {
    throw new ResolveError('could not resolve the repository from the checkout: gh repo view returned no JSON');
  }
  let host;
  try {
    host = new URL(view.url).host;
  } catch {
    host = '';
  }
  const repository = {
    host,
    owner: view.owner?.login ?? '',
    repo: view.name ?? '',
    inOrg: view.isInOrganization,
  };
  if (!repository.host || !repository.owner || !repository.repo || typeof repository.inOrg !== 'boolean') {
    throw new ResolveError('could not resolve the repository from the checkout: a field came back empty');
  }
  return repository;
}

function failure(result) {
  return { ok: false, httpStatus: result.httpStatus, message: result.message };
}

function pick(object, fields) {
  const out = {};
  for (const field of fields) out[field] = object?.[field];
  return out;
}

export function repoPath(repository, suffix = '') {
  return `repos/${repository.owner}/${repository.repo}${suffix}`;
}

// Read everything Step 1 reads. The baseline is needed only to know which
// branches are protected and so which effective-rule reads to make.
export function readState(gh, repository, baseline) {
  const { host } = repository;
  const state = { repository };

  const settings = api(gh, host, repoPath(repository));
  state.settings = settings.ok
    ? { ok: true, value: pick(settings.data, SETTINGS_FIELDS) }
    : failure(settings);

  const enabled = api(gh, host, repoPath(repository, '/actions/permissions'));
  state.actionsEnabled = enabled.ok
    ? { ok: true, value: enabled.data?.enabled ?? null }
    : failure(enabled);

  if (state.actionsEnabled.ok && state.actionsEnabled.value === false) {
    state.actionsWorkflow = { ok: true, skipped: 'disabled' };
  } else {
    const workflow = api(gh, host, repoPath(repository, '/actions/permissions/workflow'));
    state.actionsWorkflow = workflow.ok
      ? { ok: true, value: pick(workflow.data, ACTIONS_FIELDS) }
      : failure(workflow);
  }

  const branches = api(gh, host, repoPath(repository, '/branches'), { paginate: true });
  state.branches = branches.ok
    ? { ok: true, names: branches.data.map((b) => b.name).filter((n) => typeof n === 'string').sort() }
    : failure(branches);

  state.branchRules = {};
  if (state.branches.ok) {
    const protectedNames = state.branches.names.filter((name) => (
      baseline.protected_branches.some((pattern) => matchesPattern(pattern, name))
    ));
    for (const name of protectedNames) {
      const rules = api(gh, host, repoPath(repository, `/rules/branches/${encodeURIComponent(name)}`), {
        paginate: true,
      });
      state.branchRules[name] = rules.ok ? { ok: true, rules: rules.data } : failure(rules);
    }
  }

  const rulesets = api(gh, host, repoPath(repository, '/rulesets'), { paginate: true });
  state.rulesets = {};
  if (rulesets.ok) {
    state.rulesetList = { ok: true };
    for (const entry of rulesets.data) {
      if (entry.target !== 'branch') continue;
      const href = entry._links?.self?.href
        || (entry.source_type === 'Organization'
          ? `orgs/${entry.source}/rulesets/${entry.id}`
          : repoPath(repository, `/rulesets/${entry.id}`));
      const detail = api(gh, host, href);
      state.rulesets[entry.id] = detail.ok
        ? { ok: true, value: normalizeRuleset(detail.data, entry), href }
        : { ...failure(detail), href, summary: pick(entry, ['id', 'name', 'source_type', 'source', 'enforcement']) };
    }
  } else {
    state.rulesetList = failure(rulesets);
  }

  return state;
}

function normalizeRuleset(data, entry) {
  return {
    id: data.id ?? entry.id,
    name: data.name ?? entry.name,
    source_type: data.source_type ?? entry.source_type,
    source: data.source ?? entry.source,
    target: data.target ?? entry.target,
    enforcement: data.enforcement ?? entry.enforcement,
    bypass_actors: Array.isArray(data.bypass_actors) ? data.bypass_actors : [],
    conditions: data.conditions ?? {},
    rules: Array.isArray(data.rules) ? data.rules : [],
  };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// A fingerprint of what the plan was built from, so apply can tell whether
// the state it would write to is still that state. The full branch list is
// left out: the plan reads only the protected branches, and those are the
// keys of branchRules, so a topic branch pushed or deleted while the user
// confirms must not make the plan stale.
export function snapshot(state) {
  const { branches, ...rest } = state;
  const fingerprinted = { ...rest, branches: branches.ok ? { ok: true } : branches };
  return createHash('sha256').update(canonical(fingerprinted)).digest('hex');
}
