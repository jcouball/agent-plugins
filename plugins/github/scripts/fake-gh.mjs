// A fake `gh` for the tests: routes keyed by "METHOD path" (the path as the
// script passes it, without the hostname) return data, or a failure with an
// HTTP status and message. Every call is recorded.

import { matchesPattern, parseSelector } from './lib/glob.mjs';

export const REPO = { host: 'github.com', owner: 'acme', repo: 'widgets', inOrg: true };

export function fakeGh(routes, { repoView } = {}) {
  const calls = [];
  const view = repoView ?? {
    url: 'https://github.com/acme/widgets', owner: { login: 'acme' }, name: 'widgets', isInOrganization: true,
  };
  const gh = (args, { input } = {}) => {
    if (args[0] === 'repo' && args[1] === 'view') {
      calls.push({ method: 'VIEW', path: 'repo view' });
      return { ok: true, status: 0, stdout: JSON.stringify(view), stderr: '' };
    }
    const methodIndex = args.indexOf('-X');
    const method = methodIndex === -1 ? 'GET' : args[methodIndex + 1];
    const path = args[args.length - 1];
    const paginate = args.includes('--paginate');
    const body = input === undefined ? undefined : JSON.parse(input);
    calls.push({ method, path, body });
    let route = routes[`${method} ${path}`];
    if (typeof route === 'function') route = route(body, calls);
    if (route === undefined) {
      return { ok: false, status: 1, stdout: JSON.stringify({ message: 'Not Found' }), stderr: `gh: Not Found (HTTP 404)\nunrouted ${method} ${path}` };
    }
    if (route && route.status) {
      return {
        ok: false, status: 1,
        stdout: route.message ? JSON.stringify({ message: route.message }) : '',
        stderr: `gh: ${route.message ?? 'error'} (HTTP ${route.status})`,
      };
    }
    const data = route && 'data' in route ? route.data : route;
    const payload = paginate ? [data] : data;
    return { ok: true, status: 0, stdout: payload === undefined ? '' : JSON.stringify(payload), stderr: '' };
  };
  gh.calls = calls;
  gh.routes = routes;
  return gh;
}

export function ruleset(overrides = {}) {
  const base = {
    id: 1, name: 'Guardrails', source_type: 'Repository', source: 'acme/widgets', target: 'branch', enforcement: 'active',
    bypass_actors: [],
    conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      { type: 'required_linear_history' },
      { type: 'pull_request', parameters: { required_approving_review_count: 0, allowed_merge_methods: ['rebase'] } },
    ],
  };
  const rs = { ...base, ...overrides };
  rs._links = { self: { href: rs.source_type === 'Organization' ? `orgs/${rs.source}/rulesets/${rs.id}` : `repos/acme/widgets/rulesets/${rs.id}` } };
  return rs;
}

// Effective rules for a branch, as the rules/branches endpoint reports them.
export function effectiveRules(...rulesets) {
  return rulesets.flatMap((rs) => rs.rules.map((rule) => ({
    ...rule, ruleset_source_type: rs.source_type, ruleset_source: rs.source, ruleset_id: rs.id,
  })));
}

// A compliant repository: every setting at the built-in defaults, one exact
// ruleset on main, and master absent.
export function compliantRoutes(rulesets = [ruleset()], branches = ['main', 'feature/x']) {
  const routes = {
    'GET repos/acme/widgets': {
      allow_merge_commit: false, allow_squash_merge: false, allow_rebase_merge: true,
      delete_branch_on_merge: true, allow_auto_merge: false,
    },
    'GET repos/acme/widgets/actions/permissions': { enabled: true },
    'GET repos/acme/widgets/actions/permissions/workflow': {
      default_workflow_permissions: 'read', can_approve_pull_request_reviews: false,
    },
    'GET repos/acme/widgets/branches': branches.map((name) => ({ name })),
    'GET repos/acme/widgets/rulesets': rulesets.map(({ id, name, source_type, source, target, enforcement, _links }) => ({
      id, name, source_type, source, target, enforcement, _links,
    })),
  };
  for (const rs of rulesets) routes[`GET ${rs._links.self.href}`] = rs;
  for (const name of branches) {
    const selects = (s) => {
      const parsed = parseSelector(s);
      if (parsed.kind === 'all') return true;
      if (parsed.kind === 'default') return name === 'main';
      return parsed.kind === 'pattern' && matchesPattern(parsed.pattern, name);
    };
    const binding = rulesets.filter((rs) => rs.enforcement === 'active'
      && rs.conditions.ref_name.include.some(selects)
      && !(rs.conditions.ref_name.exclude ?? []).some(selects));
    routes[`GET repos/acme/widgets/rules/branches/${encodeURIComponent(name)}`] = effectiveRules(...binding);
  }
  return routes;
}
