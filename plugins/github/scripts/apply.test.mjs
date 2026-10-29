import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, resolveBaseline } from './lib/baseline.mjs';
import { readState, resolveRepository } from './lib/read.mjs';
import { audit } from './lib/audit.mjs';
import { applyPlan } from './lib/apply.mjs';
import { compliantRoutes, effectiveRules, fakeGh, ruleset } from './fake-gh.mjs';

const noSleep = async () => {};

const FIELD = { merge: 'allow_merge_commit', squash: 'allow_squash_merge', rebase: 'allow_rebase_merge' };

// A fake server whose settings, Actions values, and rulesets the writes
// change. main's effective rules follow the live rulesets, and `trace`
// records the methods a pull request on main could merge by after every
// write, which is what the transition ordering exists to keep non-empty.
function server(routes, rulesets = []) {
  const state = {
    settings: { ...routes['GET repos/acme/widgets'] },
    workflow: { ...routes['GET repos/acme/widgets/actions/permissions/workflow'] },
    rulesets: Object.fromEntries(rulesets.map((rs) => [rs.id, structuredClone(rs)])),
    writes: [],
    trace: [],
  };
  const bindingMain = () => Object.values(state.rulesets)
    .filter((rs) => rs.conditions.ref_name.include.some((s) => s === 'refs/heads/main' || s === '~ALL'));
  const effective = () => {
    let methods = Object.keys(FIELD).filter((m) => state.settings[FIELD[m]] === true);
    for (const rs of bindingMain()) {
      const pr = rs.rules.find((r) => r.type === 'pull_request');
      if (pr) methods = methods.filter((m) => pr.parameters.allowed_merge_methods.includes(m));
    }
    return methods;
  };
  routes['GET repos/acme/widgets'] = () => state.settings;
  routes['PATCH repos/acme/widgets'] = (body) => {
    state.writes.push(['PATCH settings', body]);
    Object.assign(state.settings, body);
    state.trace.push(effective());
    return state.settings;
  };
  if (rulesets.length) routes['GET repos/acme/widgets/rules/branches/main'] = () => effectiveRules(...bindingMain());
  for (const rs of rulesets) {
    routes[`GET repos/acme/widgets/rulesets/${rs.id}`] = () => state.rulesets[rs.id];
    routes[`PUT repos/acme/widgets/rulesets/${rs.id}`] = (body) => {
      state.writes.push([`PUT ruleset ${rs.id}`, body]);
      state.rulesets[rs.id] = { ...state.rulesets[rs.id], ...body };
      state.trace.push(effective());
      return state.rulesets[rs.id];
    };
  }
  routes['GET repos/acme/widgets/actions/permissions/workflow'] = () => state.workflow;
  routes['PUT repos/acme/widgets/actions/permissions/workflow'] = (body) => {
    state.writes.push(['PUT actions', body]);
    Object.assign(state.workflow, body);
    return { data: undefined };
  };
  routes['POST repos/acme/widgets/rulesets'] = (body) => {
    state.writes.push(['POST ruleset', body]);
    return { id: 99, ...body };
  };
  return state;
}

function plan(routes, base = DEFAULTS) {
  const gh = fakeGh(routes);
  const repository = resolveRepository(gh);
  const state = readState(gh, repository, base);
  return { gh, plan: audit(state, base).plan };
}

test('a plan built from a changed state is stale and comes back with a fresh audit', async () => {
  const routes = compliantRoutes();
  const built = plan(routes);
  routes['GET repos/acme/widgets'].allow_auto_merge = true;
  const result = await applyPlan({ gh: built.gh, plan: built.plan, baseline: DEFAULTS, sleep: noSleep });
  assert.equal(result.status, 'stale');
  assert.equal(result.audit.checks.find((c) => c.id === 'repository.allow_auto_merge').status, 'drift');
  assert.equal(built.gh.calls.filter((c) => c.method !== 'GET' && c.method !== 'VIEW').length, 0);
});

test('a settings fix and an Actions fix apply, verify, and leave a clean audit', async () => {
  const rs = ruleset({ conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } } });
  const routes = compliantRoutes([rs]);
  routes['GET repos/acme/widgets'].delete_branch_on_merge = false;
  routes['GET repos/acme/widgets/actions/permissions/workflow'].default_workflow_permissions = 'write';
  const srv = server(routes);
  const built = plan(routes);
  assert.deepEqual(built.plan.steps.map((s) => s.id), ['settings-widen', 'actions-default_workflow_permissions']);
  const result = await applyPlan({ gh: built.gh, plan: built.plan, baseline: DEFAULTS, sleep: noSleep });
  assert.equal(result.status, 'applied');
  assert.deepEqual(result.steps.map((s) => s.status), ['applied', 'applied']);
  assert.deepEqual(srv.writes, [
    ['PATCH settings', { delete_branch_on_merge: true }],
    ['PUT actions', { default_workflow_permissions: 'read' }],
  ]);
  assert.deepEqual(result.audit.checks.filter((c) => c.status === 'drift'), []);
});

test('the Actions re-read waits out a lagging write', async () => {
  const routes = compliantRoutes([ruleset({ conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } } })]);
  routes['GET repos/acme/widgets/actions/permissions/workflow'].can_approve_pull_request_reviews = true;
  const srv = server(routes);
  const built = plan(routes);
  // The write lands, but the first two re-reads still show the old value.
  let reads = 0;
  const lagging = { ...srv.workflow };
  routes['PUT repos/acme/widgets/actions/permissions/workflow'] = (body) => {
    srv.writes.push(['PUT actions', body]);
    Object.assign(srv.workflow, body);
    return { data: undefined };
  };
  routes['GET repos/acme/widgets/actions/permissions/workflow'] = () => {
    if (srv.writes.length === 0) return srv.workflow;
    reads += 1;
    return reads <= 2 ? lagging : srv.workflow;
  };
  const sleeps = [];
  const result = await applyPlan({
    gh: built.gh, plan: built.plan, baseline: DEFAULTS, sleep: async (ms) => { sleeps.push(ms); },
  });
  assert.equal(result.steps[0].status, 'applied');
  assert.deepEqual(sleeps.slice(0, 2), [1000, 1000]);
  assert.deepEqual(result.audit.checks.filter((c) => c.status === 'drift'), []);
});

test('a value still wrong after five re-reads is a failed fix, not a cap', async () => {
  const routes = compliantRoutes([ruleset({ conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } } })]);
  routes['GET repos/acme/widgets/actions/permissions/workflow'].default_workflow_permissions = 'write';
  const srv = server(routes);
  const built = plan(routes);
  routes['PUT repos/acme/widgets/actions/permissions/workflow'] = (body) => {
    srv.writes.push(['PUT actions', body]);
    return { data: undefined };
  };
  const result = await applyPlan({ gh: built.gh, plan: built.plan, baseline: DEFAULTS, sleep: noSleep });
  assert.equal(result.steps[0].status, 'failed');
  assert.match(result.steps[0].message, /still reads "write" after 5 reads/);
});

test('a 409 on a loosening Actions write in an organization is the cap; on a tightening write it is not', async () => {
  const base = resolveBaseline('actions:\n  default_workflow_permissions: write\n').baseline;
  const routes = compliantRoutes([ruleset({ conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } } })]);
  routes['PUT repos/acme/widgets/actions/permissions/workflow'] = { status: 409, message: 'Conflict' };
  let built = plan(routes, base);
  let result = await applyPlan({ gh: built.gh, plan: built.plan, baseline: base, sleep: noSleep });
  assert.equal(result.steps[0].status, 'capped');
  assert.deepEqual(result.steps[0].where, ['https://github.com/organizations/acme/settings/actions']);

  routes['GET repos/acme/widgets/actions/permissions/workflow'].default_workflow_permissions = 'write';
  built = plan(routes);
  result = await applyPlan({ gh: built.gh, plan: built.plan, baseline: DEFAULTS, sleep: noSleep });
  assert.equal(result.steps[0].status, 'failed');
  assert.match(result.steps[0].message, /HTTP 409: Conflict/);
  assert.deepEqual(result.steps[0].where, ['https://github.com/acme/widgets/settings/actions']);
});

test('a refused settings PATCH names the settings page and holds a ruleset write that would strand the branch', async () => {
  // Repository allows merge only; baseline wants rebase only; no ruleset.
  const routes = compliantRoutes([]);
  routes['GET repos/acme/widgets'] = {
    allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: false,
    delete_branch_on_merge: true, allow_auto_merge: false,
  };
  const srv = server(routes);
  routes['PATCH repos/acme/widgets'] = { status: 403, message: 'Must have admin rights to Repository.' };
  const built = plan(routes);
  assert.deepEqual(built.plan.steps.map((s) => s.id), ['settings-widen', 'ruleset-create', 'settings-narrow']);
  const result = await applyPlan({ gh: built.gh, plan: built.plan, baseline: DEFAULTS, sleep: noSleep });
  assert.deepEqual(result.steps.map((s) => s.status), ['refused', 'skipped', 'skipped']);
  assert.deepEqual(result.steps[0].where, ['https://github.com/acme/widgets/settings']);
  assert.match(result.steps[1].reason, /blocked on the settings fix/);
  assert.match(result.steps[2].reason, /transition was aborted/);
  assert.deepEqual(srv.writes, []);
});

test('a failed widening ruleset write aborts the transition but not unrelated writes', async () => {
  const a = ruleset({
    id: 1, name: 'A', conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } },
    rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'required_linear_history' },
      { type: 'pull_request', parameters: { allowed_merge_methods: ['squash'] } }],
  });
  const b = ruleset({ ...a, id: 2, name: 'B' });
  const routes = compliantRoutes([a, b]);
  routes['GET repos/acme/widgets'].allow_squash_merge = true;
  routes['GET repos/acme/widgets/actions/permissions/workflow'].default_workflow_permissions = 'write';
  const srv = server(routes);
  routes['PUT repos/acme/widgets/rulesets/1'] = { status: 422, message: 'Validation Failed' };
  const built = plan(routes);
  assert.deepEqual(built.plan.steps.map((s) => s.id), [
    'ruleset-1-widen', 'ruleset-2-widen', 'ruleset-1', 'ruleset-2', 'settings-narrow', 'actions-default_workflow_permissions',
  ]);
  const result = await applyPlan({ gh: built.gh, plan: built.plan, baseline: DEFAULTS, sleep: noSleep });
  assert.deepEqual(result.steps.map((s) => s.status), ['failed', 'skipped', 'skipped', 'skipped', 'skipped', 'applied']);
  assert.match(result.steps[0].message, /HTTP 422/);
  assert.deepEqual(srv.writes, [['PUT actions', { default_workflow_permissions: 'read' }]]);
});

// Two exact-scope squash-only rulesets under a rebase-only baseline, with
// squash and rebase both enabled: the transition that interleaving widen and
// narrow per ruleset would break.
function twoSquashOnlyRulesets() {
  const a = ruleset({
    id: 1, name: 'A', conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } },
    rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'required_linear_history' },
      { type: 'pull_request', parameters: { allowed_merge_methods: ['squash'] } }],
  });
  const b = ruleset({ ...a, id: 2, name: 'B' });
  const routes = compliantRoutes([a, b]);
  routes['GET repos/acme/widgets'].allow_squash_merge = true;
  return { routes, rulesets: [a, b] };
}

test('every ruleset widens before any narrows, so main stays mergeable through the transition', async () => {
  const { routes, rulesets } = twoSquashOnlyRulesets();
  const srv = server(routes, rulesets);
  const built = plan(routes);
  assert.deepEqual(built.plan.steps.map((s) => s.id), [
    'ruleset-1-widen', 'ruleset-2-widen', 'ruleset-1', 'ruleset-2', 'settings-narrow',
  ]);
  const result = await applyPlan({ gh: built.gh, plan: built.plan, baseline: DEFAULTS, sleep: noSleep });
  assert.deepEqual(result.steps.map((s) => s.status), ['applied', 'applied', 'applied', 'applied', 'applied']);
  assert.deepEqual(srv.trace, [['squash'], ['squash', 'rebase'], ['rebase'], ['rebase'], ['rebase']]);
  assert.deepEqual(result.audit.checks.filter((c) => c.status === 'drift'), []);
});

test('a widening write that fails after another landed leaves main mergeable and waits on no fix', async () => {
  const { routes, rulesets } = twoSquashOnlyRulesets();
  const srv = server(routes, rulesets);
  routes['PUT repos/acme/widgets/rulesets/2'] = { status: 422, message: 'Validation Failed' };
  const built = plan(routes);
  assert.deepEqual(built.plan.steps.find((s) => s.id === 'ruleset-1-widen').fixes, []);
  let reads = 0;
  const sleeps = [];
  const result = await applyPlan({
    gh: built.gh, plan: built.plan, baseline: DEFAULTS,
    sleep: async (ms) => { sleeps.push(ms); },
    read: (...args) => { reads += 1; return readState(...args); },
  });
  assert.deepEqual(result.steps.map((s) => s.status), ['applied', 'failed', 'skipped', 'skipped', 'skipped']);
  assert.deepEqual(srv.trace, [['squash']]);
  // The widen that applied claims no check, so the verify loop reads once and never sleeps.
  assert.equal(reads, 2);
  assert.deepEqual(sleeps, []);
  assert.equal(result.audit.checks.find((c) => c.id === 'branch:main.merge_methods').status, 'drift');
});

test('an empty body on the Actions re-read leaves the write unverified instead of crashing', async () => {
  const routes = compliantRoutes([ruleset({ conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/master'], exclude: [] } } })]);
  routes['GET repos/acme/widgets/actions/permissions/workflow'].default_workflow_permissions = 'write';
  const srv = server(routes);
  const built = plan(routes);
  routes['GET repos/acme/widgets/actions/permissions/workflow'] = () => (srv.writes.length ? { data: undefined } : srv.workflow);
  const result = await applyPlan({ gh: built.gh, plan: built.plan, baseline: DEFAULTS, sleep: noSleep });
  assert.equal(result.steps[0].status, 'unverified');
  assert.match(result.steps[0].message, /no fields/);
});

test('ruleset writes go in plan order with the exact bodies', async () => {
  const routes = compliantRoutes([]);
  const srv = server(routes);
  const built = plan(routes);
  const result = await applyPlan({ gh: built.gh, plan: built.plan, baseline: DEFAULTS, sleep: noSleep });
  assert.deepEqual(result.steps, [{ id: 'ruleset-create', status: 'applied' }]);
  assert.equal(srv.writes.length, 1);
  assert.equal(srv.writes[0][0], 'POST ruleset');
  assert.deepEqual(srv.writes[0][1].conditions.ref_name.include, ['refs/heads/main', 'refs/heads/master']);
  const put = built.gh.calls.find((c) => c.method === 'POST');
  assert.equal(put.path, 'repos/acme/widgets/rulesets');
});
