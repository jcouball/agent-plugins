import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, resolveBaseline } from './lib/baseline.mjs';
import { readState, resolveRepository, snapshot } from './lib/read.mjs';
import { audit, CREATED_RULESET_NAME, evaluateMethods } from './lib/audit.mjs';
import {
  REPO, compliantRoutes, effectiveRules, fakeGh, ruleset,
} from './fake-gh.mjs';

const baseline = (text) => {
  const result = resolveBaseline(text ?? null);
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  return result.baseline;
};

function run(routes, base = DEFAULTS, repoView) {
  const gh = fakeGh(routes, { repoView });
  const repository = resolveRepository(gh);
  const state = readState(gh, repository, base);
  return { gh, state, ...audit(state, base) };
}

const byId = (checks, id) => {
  const check = checks.find((c) => c.id === id);
  assert.ok(check, `no check ${id} in ${checks.map((c) => c.id).join(', ')}`);
  return check;
};

const statuses = (checks) => Object.fromEntries(checks.map((c) => [c.id, c.status]));

test('resolveRepository takes host, owner, name, and organization from gh repo view', () => {
  const gh = fakeGh({}, {
    repoView: {
      url: 'https://ghe.example.com/team/tool', owner: { login: 'team' }, name: 'tool', isInOrganization: false,
    },
  });
  assert.deepEqual(resolveRepository(gh), {
    host: 'ghe.example.com', owner: 'team', repo: 'tool', inOrg: false,
  });
});

test('resolveRepository stops when a field is empty', () => {
  const gh = fakeGh({}, { repoView: { url: 'https://github.com/a/b', owner: {}, name: 'b', isInOrganization: true } });
  assert.throws(() => resolveRepository(gh), /came back empty/);
});

test('every api call carries the resolved host and the branch name is percent-encoded', () => {
  const routes = compliantRoutes([ruleset({ conditions: { ref_name: { include: ['refs/heads/release/*'], exclude: [] } } })], ['release/1.0']);
  const { gh } = run(routes, baseline('protected_branches: ["release/*"]\n'));
  const api = gh.calls.filter((c) => c.method !== 'VIEW');
  assert.ok(api.length > 0);
  assert.ok(api.some((c) => c.path === 'repos/acme/widgets/rules/branches/release%2F1.0'));
});

test('a compliant repository passes every check and plans nothing', () => {
  const { checks, plan } = run(compliantRoutes());
  const failing = checks.filter((c) => c.status !== 'pass' && c.status !== 'note' && !c.id.startsWith('pattern:master'));
  assert.deepEqual(failing, []);
  // master is a default pattern with no branch, no ruleset, and no creation
  // rule: its coverage is drift, and the first push is a stated remainder.
  assert.equal(byId(checks, 'pattern:master.creation').status, 'note');
  assert.equal(byId(checks, 'pattern:master.coverage').status, 'drift');
  assert.deepEqual(plan.steps.map((s) => s.kind), ['post_ruleset']);
});

test('an exact ruleset on every default pattern leaves no drift at all', () => {
  const rs = ruleset({ conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } } });
  const { checks, plan } = run(compliantRoutes([rs]));
  assert.deepEqual(checks.filter((c) => c.status === 'drift'), []);
  assert.deepEqual(plan.steps, []);
  assert.deepEqual(plan.held, []);
  assert.equal(plan.confirm_required, false);
});

test('repository settings drift is reported field by field and fixed in one PATCH', () => {
  const rs = ruleset({ conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } } });
  const routes = compliantRoutes([rs]);
  routes['GET repos/acme/widgets'] = {
    allow_merge_commit: false, allow_squash_merge: false, allow_rebase_merge: true,
    delete_branch_on_merge: false, allow_auto_merge: true,
  };
  const { checks, plan } = run(routes);
  assert.equal(byId(checks, 'repository.delete_branch_on_merge').status, 'drift');
  assert.equal(byId(checks, 'repository.allow_auto_merge').status, 'drift');
  assert.equal(byId(checks, 'repository.allow_rebase_merge').status, 'pass');
  assert.equal(plan.steps.length, 1);
  assert.deepEqual(plan.steps[0].body, { delete_branch_on_merge: true, allow_auto_merge: false });
  assert.equal(plan.steps[0].transition, false);
  assert.equal(plan.confirm_required, false);
});

test('a merge-method change runs as a widen-then-narrow transition', () => {
  // Two exact-scope squash-only rulesets under a rebase-only baseline, with
  // squash and rebase both enabled on the repository.
  const a = ruleset({
    id: 1, name: 'A', conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } },
    rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'required_linear_history' },
      { type: 'pull_request', parameters: { allowed_merge_methods: ['squash'] } }],
  });
  const b = ruleset({ ...a, id: 2, name: 'B' });
  const routes = compliantRoutes([a, b]);
  routes['GET repos/acme/widgets'] = {
    allow_merge_commit: false, allow_squash_merge: true, allow_rebase_merge: true,
    delete_branch_on_merge: true, allow_auto_merge: false,
  };
  const { checks, plan } = run(routes);
  assert.equal(byId(checks, 'repository.allow_squash_merge').status, 'drift');
  assert.equal(byId(checks, 'branch:main.merge_methods').status, 'drift');
  assert.match(byId(checks, 'branch:main.merge_methods').detail, /allows squash/);
  // Every widen precedes every narrow: narrowing A while B still allows
  // only squash would leave main with no method until B is widened.
  assert.deepEqual(plan.steps.map((s) => s.id), [
    'ruleset-1-widen', 'ruleset-2-widen', 'ruleset-1', 'ruleset-2', 'settings-narrow',
  ]);
  const widen = plan.steps[0];
  assert.deepEqual(widen.body.rules.find((r) => r.type === 'pull_request').parameters.allowed_merge_methods, ['squash', 'rebase']);
  assert.equal(widen.transition, true);
  assert.deepEqual(widen.fixes, []);
  const narrow = plan.steps[2];
  assert.deepEqual(narrow.body.rules.find((r) => r.type === 'pull_request').parameters.allowed_merge_methods, ['rebase']);
  assert.ok(narrow.fixes.includes('branch:main.merge_methods'));
  assert.deepEqual(plan.steps[4].body, { allow_squash_merge: false });
  assert.equal(plan.confirm_required, true);
  // PUT bodies carry only the writable fields.
  assert.deepEqual(Object.keys(widen.body).sort(), ['bypass_actors', 'conditions', 'enforcement', 'name', 'rules', 'target']);
});

test('a narrowing ruleset write is ordered after the settings widen it depends on', () => {
  // Repository enables merge only; baseline is rebase only; the exact ruleset allows merge only.
  const rs = ruleset({
    conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } },
    rules: [{ type: 'deletion' }, { type: 'non_fast_forward' },
      { type: 'pull_request', parameters: { allowed_merge_methods: ['merge'] } }],
  });
  const routes = compliantRoutes([rs]);
  routes['GET repos/acme/widgets'] = {
    allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: false,
    delete_branch_on_merge: true, allow_auto_merge: false,
  };
  const { plan } = run(routes);
  assert.deepEqual(plan.steps.map((s) => s.id), ['settings-widen', 'ruleset-1-widen', 'ruleset-1', 'settings-narrow']);
  assert.deepEqual(plan.steps[0].body, { allow_rebase_merge: true });
  assert.deepEqual(plan.steps[3].body, { allow_merge_commit: false });
  // The merged rule shares no method with the baseline, so it takes exactly the enabled methods.
  assert.deepEqual(plan.steps[2].body.rules.find((r) => r.type === 'pull_request').parameters.allowed_merge_methods, ['rebase']);
  assert.ok(plan.steps[2].body.rules.some((r) => r.type === 'required_linear_history'));
});

test('a stricter subset of the baseline methods is kept, not widened', () => {
  const rs = ruleset({
    conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } },
    rules: [{ type: 'deletion' }, { type: 'pull_request', parameters: { allowed_merge_methods: ['squash'] } }],
  });
  const routes = compliantRoutes([rs]);
  routes['GET repos/acme/widgets'].allow_squash_merge = true;
  const base = baseline('merge_methods:\n  squash: true\n  rebase: true\n');
  const { checks, plan } = run(routes, base);
  assert.equal(byId(checks, 'branch:main.merge_methods').status, 'pass');
  const write = plan.steps.find((s) => s.id === 'ruleset-1');
  assert.deepEqual(write.body.rules.find((r) => r.type === 'pull_request').parameters.allowed_merge_methods, ['squash']);
  assert.deepEqual(write.body.rules.map((r) => r.type).sort(), ['deletion', 'non_fast_forward', 'pull_request', 'required_linear_history']);
});

test('no qualifying ruleset means a create with the resolved patterns and rules', () => {
  const base = baseline('protected_branches: [main, "release/**/*"]\nbranch_rules: [pull_request, deletion, creation]\n');
  const { checks, plan } = run(compliantRoutes([]), base);
  assert.equal(byId(checks, 'pattern:main.coverage').status, 'drift');
  assert.equal(byId(checks, 'pattern:release/**/*.coverage').status, 'drift');
  assert.equal(byId(checks, 'branch:main.rule.pull_request').status, 'drift');
  assert.equal(checks.some((c) => c.id === 'pattern:release/**/*.creation'), false);
  assert.equal(plan.steps.length, 1);
  const [create] = plan.steps;
  assert.equal(create.kind, 'post_ruleset');
  assert.equal(create.body.name, CREATED_RULESET_NAME);
  assert.deepEqual(create.body.conditions, { ref_name: { include: ['refs/heads/main', 'refs/heads/release/**/*'], exclude: [] } });
  assert.deepEqual(create.body.rules.map((r) => r.type), ['deletion', 'creation', 'pull_request']);
  assert.deepEqual(create.body.rules[2].parameters, {
    required_approving_review_count: 0,
    dismiss_stale_reviews_on_push: true,
    require_code_owner_review: false,
    require_last_push_approval: false,
    required_review_thread_resolution: false,
    allowed_merge_methods: ['rebase'],
  });
  assert.equal(plan.confirm_required, true);
});

test('a ruleset that is not exact scope is left alone and a dedicated one is created', () => {
  for (const conditions of [
    { ref_name: { include: ['~ALL'], exclude: [] } },
    { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    { ref_name: { include: ['refs/heads/main', 'refs/heads/master', 'refs/heads/dev'], exclude: [] } },
    { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: ['refs/heads/docs/*'] } },
  ]) {
    const rs = ruleset({ conditions, rules: [{ type: 'deletion' }, { type: 'pull_request', parameters: { allowed_merge_methods: ['rebase'] } }] });
    const { plan } = run(compliantRoutes([rs]));
    assert.deepEqual(plan.steps.map((s) => s.kind), ['post_ruleset'], JSON.stringify(conditions));
  }
});

test('a ~ALL ruleset covers every pattern, and an overlapping exclusion removes coverage', () => {
  const all = ruleset({ conditions: { ref_name: { include: ['~ALL'], exclude: [] } } });
  let result = run(compliantRoutes([all]));
  assert.equal(byId(result.checks, 'pattern:main.coverage').status, 'pass');
  assert.equal(byId(result.checks, 'pattern:master.coverage').status, 'pass');
  const excluding = ruleset({ conditions: { ref_name: { include: ['~ALL'], exclude: ['refs/heads/master'] } } });
  result = run(compliantRoutes([excluding]));
  assert.equal(byId(result.checks, 'pattern:main.coverage').status, 'pass');
  assert.equal(byId(result.checks, 'pattern:master.coverage').status, 'drift');
  // A disjoint exclusion does not.
  const disjoint = ruleset({ conditions: { ref_name: { include: ['~ALL'], exclude: ['refs/heads/docs/*'] } } });
  result = run(compliantRoutes([disjoint]));
  assert.equal(byId(result.checks, 'pattern:master.coverage').status, 'pass');
});

test('a broader glob is drift even when it happens to cover', () => {
  const rs = ruleset({ conditions: { ref_name: { include: ['refs/heads/*'], exclude: [] } } });
  const { checks } = run(compliantRoutes([rs]));
  assert.equal(byId(checks, 'pattern:main.coverage').status, 'drift');
  // The branch itself is protected by that ruleset, so the branch checks pass.
  assert.equal(byId(checks, 'branch:main.rule.pull_request').status, 'pass');
});

test('an inherited squash-only rule against a rebase-only baseline is drift the plan cannot clear', () => {
  const repo = ruleset({ id: 1, conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } } });
  const org = ruleset({
    id: 7, name: 'Org policy', source_type: 'Organization', source: 'acme',
    conditions: { ref_name: { include: ['~ALL'], exclude: [] } },
    rules: [{ type: 'pull_request', parameters: { allowed_merge_methods: ['squash'] } }],
  });
  const { checks, plan } = run(compliantRoutes([repo, org]));
  const branch = byId(checks, 'branch:main.merge_methods');
  assert.equal(branch.status, 'drift');
  assert.match(branch.detail, /no merge method is allowed/);
  const pattern = byId(checks, 'pattern:main.merge_methods');
  assert.equal(pattern.status, 'drift');
  assert.match(pattern.detail, /organization ruleset "Org policy" \(7\)/);
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.held.length, 1);
  assert.match(plan.held[0].reason, /Org policy/);
  assert.ok(plan.held[0].checks.includes('pattern:main.merge_methods'));
});

test('an unwritable conflicting rule also blocks the create and the merge-method fields', () => {
  const org = ruleset({
    id: 7, name: 'Org policy', source_type: 'Organization', source: 'acme',
    conditions: { ref_name: { include: ['~ALL'], exclude: [] } },
    rules: [{ type: 'pull_request', parameters: { allowed_merge_methods: ['squash'] } }],
  });
  const routes = compliantRoutes([org]);
  routes['GET repos/acme/widgets'].allow_squash_merge = true;
  routes['GET repos/acme/widgets'].delete_branch_on_merge = false;
  const { plan } = run(routes);
  // Only the field with no merge-method risk is written.
  assert.deepEqual(plan.steps.map((s) => s.id), ['settings-widen']);
  assert.deepEqual(plan.steps[0].body, { delete_branch_on_merge: true });
  assert.ok(plan.held.some((h) => h.checks.includes('repository.allow_squash_merge')));
  assert.ok(plan.held.some((h) => h.reason.includes('the ruleset --fix would create')));
});

test('two inherited stricter rules that are jointly empty block the create', () => {
  const squash = ruleset({
    id: 7, name: 'S', source_type: 'Organization', source: 'acme',
    conditions: { ref_name: { include: ['~ALL'], exclude: [] } },
    rules: [{ type: 'pull_request', parameters: { allowed_merge_methods: ['squash'] } }],
  });
  const rebase = ruleset({ ...squash, id: 8, name: 'R', rules: [{ type: 'pull_request', parameters: { allowed_merge_methods: ['rebase'] } }] });
  const base = baseline('merge_methods:\n  squash: true\n  rebase: true\n');
  const { checks, plan } = run(compliantRoutes([squash, rebase]), base);
  assert.equal(byId(checks, 'pattern:main.merge_methods').status, 'drift');
  assert.deepEqual(plan.steps, []);
});

test('an overlapping but non-covering squash-only ruleset is reported as not provably safe', () => {
  const covering = ruleset({ id: 1, conditions: { ref_name: { include: ['refs/heads/release/**/*'], exclude: [] } } });
  const narrower = ruleset({
    id: 2, name: 'Old releases',
    conditions: { ref_name: { include: ['refs/heads/release/*'], exclude: [] } },
    rules: [{ type: 'pull_request', parameters: { allowed_merge_methods: ['squash'] } }],
  });
  const base = baseline('protected_branches: ["release/**/*"]\n');
  const { checks, plan } = run(compliantRoutes([covering, narrower], ['main']), base);
  const check = byId(checks, 'pattern:release/**/*.merge_methods');
  assert.equal(check.status, 'unprovable');
  assert.match(check.detail, /Old releases/);
  assert.equal(byId(checks, 'pattern:release/**/*.coverage').status, 'pass');
  assert.equal(byId(checks, 'pattern:release/**/*.creation').status, 'note');
  assert.deepEqual(plan.steps, []);
});

test('disjoint overlapping rulesets are not pooled into one intersection', () => {
  const covering = ruleset({ id: 1, conditions: { ref_name: { include: ['refs/heads/release/**/*'], exclude: [] } } });
  const one = ruleset({
    id: 2, name: 'One', conditions: { ref_name: { include: ['refs/heads/release/one/*'], exclude: [] } },
    rules: [{ type: 'pull_request', parameters: { allowed_merge_methods: ['squash', 'rebase'] } }],
  });
  const two = ruleset({
    id: 3, name: 'Two', conditions: { ref_name: { include: ['refs/heads/release/two/*'], exclude: [] } },
    rules: [{ type: 'pull_request', parameters: { allowed_merge_methods: ['merge', 'rebase'] } }],
  });
  const base = baseline('protected_branches: ["release/**/*"]\n');
  const { checks } = run(compliantRoutes([covering, one, two], ['main']), base);
  assert.equal(byId(checks, 'pattern:release/**/*.merge_methods').status, 'pass');
});

test('a merge-only intersection under required_linear_history is drift', () => {
  const rs = ruleset({
    conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } },
    rules: [{ type: 'required_linear_history' }, { type: 'pull_request', parameters: { allowed_merge_methods: ['merge'] } }],
  });
  const base = baseline('merge_methods:\n  merge: true\n  rebase: true\n');
  const { checks } = run(compliantRoutes([rs]), base);
  assert.match(byId(checks, 'branch:main.merge_methods').detail, /only merge commits/);
  assert.match(byId(checks, 'pattern:main.merge_methods').detail, /only merge commits/);
});

test('an always bypass is drift when it leaves a required rule unenforced, a note when another ruleset still binds', () => {
  const bypassed = ruleset({
    id: 1, conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } },
    bypass_actors: [{ actor_id: 5, actor_type: 'Team', bypass_mode: 'always' }],
  });
  let result = run(compliantRoutes([bypassed]));
  const drift = result.checks.filter((c) => c.group === 'bypass');
  assert.ok(drift.length > 0);
  assert.ok(drift.every((c) => c.status === 'drift'));
  assert.match(drift[0].label, /Team:5 \(always\)/);
  // No ruleset write: the bypass is a question, not a fix.
  assert.deepEqual(result.plan.steps, []);

  const other = ruleset({ id: 2, name: 'Also', conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } } });
  result = run(compliantRoutes([bypassed, other]));
  assert.ok(result.checks.filter((c) => c.group === 'bypass').every((c) => c.status === 'note'));

  const prOnly = ruleset({ ...bypassed, bypass_actors: [{ actor_id: 5, actor_type: 'Team', bypass_mode: 'pull_request' }] });
  result = run(compliantRoutes([prOnly]));
  assert.deepEqual(result.checks.filter((c) => c.group === 'bypass'), []);
});

test('a ruleset carrying a non-pull_request bypass is never merged into', () => {
  const bypassed = ruleset({
    id: 1, conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } },
    bypass_actors: [{ actor_id: 5, actor_type: 'Team', bypass_mode: 'exempt' }],
    rules: [{ type: 'pull_request', parameters: { allowed_merge_methods: ['rebase'] } }],
  });
  const { plan } = run(compliantRoutes([bypassed]));
  assert.deepEqual(plan.steps.map((s) => s.kind), ['post_ruleset']);
});

test('Actions disabled reports the token fields as not applicable and names both settings pages in an organization', () => {
  const routes = compliantRoutes();
  routes['GET repos/acme/widgets/actions/permissions'] = { enabled: false };
  delete routes['GET repos/acme/widgets/actions/permissions/workflow'];
  const { gh, checks, plan } = run(routes);
  const check = byId(checks, 'actions.default_workflow_permissions');
  assert.equal(check.status, 'not_applicable');
  assert.deepEqual(check.where, [
    'https://github.com/acme/widgets/settings/actions',
    'https://github.com/organizations/acme/settings/actions',
  ]);
  assert.equal(gh.calls.some((c) => c.path.endsWith('/workflow')), false);
  assert.deepEqual(plan.steps.filter((s) => s.kind === 'put_actions'), []);
});

test('a user-owned repository names only its own Actions page', () => {
  const routes = compliantRoutes();
  routes['GET repos/acme/widgets/actions/permissions'] = { enabled: false };
  const { checks } = run(routes, DEFAULTS, {
    url: 'https://github.com/acme/widgets', owner: { login: 'acme' }, name: 'widgets', isInOrganization: false,
  });
  assert.deepEqual(byId(checks, 'actions.default_workflow_permissions').where, ['https://github.com/acme/widgets/settings/actions']);
});

test('a failed enabled read is a note and hands the decision to the workflow read', () => {
  const routes = compliantRoutes();
  routes['GET repos/acme/widgets/actions/permissions'] = { status: 409, message: 'Conflict' };
  const { checks } = run(routes);
  assert.equal(byId(checks, 'actions.enabled').status, 'note');
  assert.equal(byId(checks, 'actions.default_workflow_permissions').status, 'pass');
});

test('a failed workflow read is partial, never a pass, and holds the writes', () => {
  const routes = compliantRoutes();
  routes['GET repos/acme/widgets/actions/permissions/workflow'] = { status: 403, message: 'Resource not accessible by integration' };
  const { checks, plan } = run(routes);
  const check = byId(checks, 'actions.default_workflow_permissions');
  assert.equal(check.status, 'partial');
  assert.match(check.detail, /HTTP 403: Resource not accessible/);
  assert.deepEqual(check.where, ['https://github.com/acme/widgets/settings/actions']);
  assert.deepEqual(plan.steps.filter((s) => s.kind === 'put_actions'), []);
  // Nothing drifted, so nothing is held either: the hold applies to drift.
  assert.deepEqual(plan.held, []);
});

test('Actions drift is one PUT per field, marked loosening or not', () => {
  const routes = compliantRoutes([ruleset({ conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } } })]);
  routes['GET repos/acme/widgets/actions/permissions/workflow'] = {
    default_workflow_permissions: 'write', can_approve_pull_request_reviews: false,
  };
  let result = run(routes);
  let puts = result.plan.steps.filter((s) => s.kind === 'put_actions');
  assert.equal(puts.length, 1);
  assert.deepEqual(puts[0].body, { default_workflow_permissions: 'read' });
  assert.equal(puts[0].loosening, false);
  assert.equal(result.plan.confirm_required, false);

  const base = baseline('actions:\n  default_workflow_permissions: write\n  can_approve_pull_request_reviews: true\n');
  routes['GET repos/acme/widgets/actions/permissions/workflow'] = {
    default_workflow_permissions: 'read', can_approve_pull_request_reviews: false,
  };
  result = run(routes, base);
  puts = result.plan.steps.filter((s) => s.kind === 'put_actions');
  assert.deepEqual(puts.map((s) => [s.field, s.loosening]), [
    ['default_workflow_permissions', true], ['can_approve_pull_request_reviews', true],
  ]);
});

test('an unreadable parent ruleset makes the pattern checks partial and holds ruleset and merge-method writes', () => {
  const repo = ruleset({ id: 1, conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } } });
  const org = ruleset({ id: 7, name: 'Hidden', source_type: 'Organization', source: 'acme' });
  const routes = compliantRoutes([repo, org]);
  routes['GET orgs/acme/rulesets/7'] = { status: 403, message: 'Must have admin rights' };
  routes['GET repos/acme/widgets'].allow_squash_merge = true;
  routes['GET repos/acme/widgets'].delete_branch_on_merge = false;
  const { checks, plan } = run(routes);
  assert.equal(byId(checks, 'pattern:main.coverage').status, 'partial');
  assert.match(byId(checks, 'pattern:main.coverage').detail, /ruleset 7 unreadable/);
  assert.deepEqual(plan.steps.map((s) => s.id), ['settings-widen']);
  assert.deepEqual(plan.steps[0].body, { delete_branch_on_merge: true });
  assert.ok(plan.held.some((h) => h.checks.includes('repository.allow_squash_merge') && /could not be read/.test(h.reason)));
});

test('a failed effective-rules read is partial for that branch, not drift', () => {
  const routes = compliantRoutes();
  routes['GET repos/acme/widgets/rules/branches/main'] = { status: 403, message: 'Forbidden' };
  const { checks } = run(routes);
  assert.equal(byId(checks, 'branch:main.rules').status, 'partial');
  assert.equal(checks.some((c) => c.id === 'branch:main.rule.pull_request'), false);
});

test('failed settings and listing reads are partial and plan nothing for them', () => {
  const routes = compliantRoutes();
  routes['GET repos/acme/widgets'] = { status: 404, message: 'Not Found' };
  routes['GET repos/acme/widgets/rulesets'] = { status: 500, message: 'Server Error' };
  routes['GET repos/acme/widgets/branches'] = { status: 502, message: 'Bad Gateway' };
  const { checks, plan } = run(routes);
  assert.equal(byId(checks, 'repository.allow_rebase_merge').status, 'partial');
  assert.equal(byId(checks, 'pattern:main.coverage').status, 'partial');
  assert.equal(byId(checks, 'branches').status, 'partial');
  assert.deepEqual(plan.steps, []);
});

test('effective rules from a paginated read are folded into one list', () => {
  const rs = ruleset({ conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } } });
  const routes = compliantRoutes([rs]);
  const rules = effectiveRules(rs);
  const gh = fakeGh(routes);
  // Two pages, as --paginate --slurp returns them.
  gh.routes['GET repos/acme/widgets/rules/branches/main'] = undefined;
  const paged = (args, opts) => {
    if (args[args.length - 1] === 'repos/acme/widgets/rules/branches/main') {
      return { ok: true, status: 0, stdout: JSON.stringify([rules.slice(0, 2), rules.slice(2)]), stderr: '' };
    }
    return gh(args, opts);
  };
  const repository = resolveRepository(gh);
  const state = readState(paged, repository, DEFAULTS);
  assert.equal(state.branchRules.main.rules.length, 4);
});

test('the snapshot changes when any read changes', () => {
  const routes = compliantRoutes();
  const gh = fakeGh(routes);
  const repository = resolveRepository(gh);
  const before = snapshot(readState(gh, repository, DEFAULTS));
  assert.equal(snapshot(readState(gh, repository, DEFAULTS)), before);
  routes['GET repos/acme/widgets'].allow_auto_merge = true;
  assert.notEqual(snapshot(readState(gh, repository, DEFAULTS)), before);
});

test('the snapshot ignores branches the baseline does not protect', () => {
  const routes = compliantRoutes();
  const gh = fakeGh(routes);
  const repository = resolveRepository(gh);
  const before = snapshot(readState(gh, repository, DEFAULTS));
  // A topic branch pushed or deleted while the user confirms is not a change to the plan's inputs.
  routes['GET repos/acme/widgets/branches'] = [{ name: 'main' }, { name: 'feature/y' }, { name: 'dependabot/npm/x' }];
  assert.equal(snapshot(readState(gh, repository, DEFAULTS)), before);
  // A protected branch appearing is: its effective rules are read and audited.
  const withMaster = compliantRoutes([ruleset()], ['main', 'master', 'feature/x']);
  routes['GET repos/acme/widgets/branches'] = withMaster['GET repos/acme/widgets/branches'];
  routes['GET repos/acme/widgets/rules/branches/master'] = withMaster['GET repos/acme/widgets/rules/branches/master'];
  assert.notEqual(snapshot(readState(gh, repository, DEFAULTS)), before);
});

test('the repository URLs follow the resolved host', () => {
  const { checks } = run({ ...compliantRoutes(), 'GET repos/acme/widgets': { status: 403, message: 'Forbidden' } }, DEFAULTS, {
    url: 'https://ghe.example.com/acme/widgets', owner: { login: 'acme' }, name: 'widgets', isInOrganization: true,
  });
  assert.deepEqual(byId(checks, 'repository.allow_rebase_merge').where, ['https://ghe.example.com/acme/widgets/settings']);
  assert.equal(statuses(checks)['repository.allow_rebase_merge'], 'partial');
  assert.equal(REPO.host, 'github.com');
});

// ---------------------------------------------------------------------------
// Shapes GitHub documents as optional, and the paths that handle them.

const BOTH = { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } };
const rest = [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'required_linear_history' }];

test('evaluateMethods finds no problem when no pull_request rule applies', () => {
  assert.deepEqual(evaluateMethods([], { enabled: ['rebase'], linear: false }), { intersection: [], problems: [] });
});

test('a pull_request rule that does not list its merge methods allows all of them', () => {
  for (const pullRequest of [{ type: 'pull_request' }, { type: 'pull_request', parameters: {} }]) {
    const rs = ruleset({ conditions: BOTH, rules: [...rest, pullRequest] });
    const { checks, plan } = run(compliantRoutes([rs]));
    assert.match(byId(checks, 'pattern:main.merge_methods').detail, /allows merge, which the baseline disables; allows squash/);
    const kinds = plan.steps.map((s) => s.kind);
    assert.deepEqual(kinds, ['put_ruleset', 'put_ruleset']);
    const [widen, narrow] = plan.steps;
    const methods = (step) => step.body.rules.find((r) => r.type === 'pull_request').parameters.allowed_merge_methods;
    assert.deepEqual(methods(widen), ['merge', 'squash', 'rebase']);
    assert.deepEqual(methods(narrow), ['rebase']);
  }
});

test('a ruleset whose detail has no ref_name condition covers nothing and is not pooled', () => {
  const routes = compliantRoutes([ruleset({ conditions: BOTH })]);
  routes['GET repos/acme/widgets/rulesets/1'] = ruleset({ conditions: {} });
  const { checks } = run(routes);
  assert.equal(byId(checks, 'pattern:main.coverage').status, 'drift');
  assert.equal(byId(checks, 'pattern:main.coverage').actual, 'none');
});

test('a bypass actor with no type or id is named unknown', () => {
  const rs = ruleset({ conditions: BOTH, bypass_actors: [{ bypass_mode: 'always' }] });
  const { checks } = run(compliantRoutes([rs]));
  const bypass = checks.filter((c) => c.group === 'bypass');
  assert.ok(bypass.length > 0);
  assert.match(bypass[0].label, /unknown:unknown \(always\)/);
});

test('a ruleset with the right scope but a missing rule type is merged into, rule by rule', () => {
  const rs = ruleset({
    conditions: BOTH,
    rules: [{ type: 'pull_request', parameters: { allowed_merge_methods: ['rebase'] } }],
  });
  const { plan } = run(compliantRoutes([rs]));
  assert.deepEqual(plan.steps.map((s) => s.kind), ['put_ruleset']);
  assert.deepEqual(plan.steps[0].body.rules.map((r) => r.type), ['pull_request', 'non_fast_forward', 'deletion', 'required_linear_history']);
});

test('a pull_request rule with no parameters is given the methods the baseline enables when merged into', () => {
  const rs = ruleset({ conditions: BOTH, rules: [{ type: 'pull_request' }] });
  const { plan } = run(compliantRoutes([rs]));
  const [widen, narrow] = plan.steps;
  const parameters = (step) => step.body.rules.find((r) => r.type === 'pull_request').parameters;
  assert.deepEqual([widen.id, narrow.id], ['ruleset-1-widen', 'ruleset-1']);
  assert.deepEqual(parameters(widen), { allowed_merge_methods: ['merge', 'squash', 'rebase'] });
  assert.deepEqual(parameters(narrow), { allowed_merge_methods: ['rebase'] });
});

test('a ruleset with the right number of selectors is not exact scope unless they are the protected patterns, once each', () => {
  for (const include of [['refs/heads/main', 'refs/heads/other'], ['refs/heads/main', 'refs/heads/main']]) {
    const rs = ruleset({ conditions: { ref_name: { include, exclude: [] } }, rules: [...rest, { type: 'pull_request', parameters: { allowed_merge_methods: ['rebase'] } }] });
    const { plan } = run(compliantRoutes([rs]));
    assert.deepEqual(plan.steps.map((s) => s.kind), ['post_ruleset'], JSON.stringify(include));
  }
});

test('a ruleset with a ref_name condition that names no exclusions still covers its patterns', () => {
  const rs = ruleset({ conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'] } } });
  const { checks } = run(compliantRoutes([rs]));
  assert.equal(byId(checks, 'pattern:main.coverage').status, 'pass');
});

test('an exact-scope ruleset with no pull_request rule is given the full one', () => {
  const rs = ruleset({ conditions: BOTH, rules: rest });
  const { plan } = run(compliantRoutes([rs]));
  assert.deepEqual(plan.steps.map((s) => s.kind), ['put_ruleset']);
  const added = plan.steps[0].body.rules.find((r) => r.type === 'pull_request');
  assert.deepEqual(added.parameters.allowed_merge_methods, ['rebase']);
  assert.equal(added.parameters.required_approving_review_count, 0);
});

// Two rulesets that bind part of the same family without covering it are only
// pooled when something could match both: the pooled intersection of a
// rebase-only and a squash-only rule is empty, which separate groups never
// show.
test('rulesets that bind part of a family are pooled unless their selectors provably cannot overlap', () => {
  const pr = (methods) => [...rest, { type: 'pull_request', parameters: { allowed_merge_methods: methods } }];
  const pair = (a, b) => [
    ruleset({ id: 1, name: 'A', conditions: { ref_name: { include: [a], exclude: [] } }, rules: pr(['rebase']) }),
    ruleset({ id: 2, name: 'B', conditions: { ref_name: { include: [b], exclude: [] } }, rules: pr(['squash']) }),
  ];
  const base = baseline('protected_branches: ["release/**/*"]\n');
  const empty = (rulesets) => {
    const { checks } = run(compliantRoutes(rulesets, ['release/1/x']), base);
    return checks.some((c) => /no merge method is allowed by every applicable/.test(c.detail ?? ''));
  };
  // A selector that is not a pattern cannot be proved disjoint from anything.
  assert.equal(empty(pair('refs/heads/release/1/*', '~DEFAULT_BRANCH')), true);
  // Two patterns that can match the same branch are not provably disjoint.
  assert.equal(empty(pair('refs/heads/release/1/*', 'refs/heads/release/1/a*')), true);
  // Two that cannot are kept apart.
  assert.equal(empty(pair('refs/heads/release/1/*', 'refs/heads/release/2/*')), false);
});
