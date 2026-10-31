// Tests for lib/read.mjs: resolving the repository from gh repo view, and
// reading its configuration when a response is missing, malformed or partial.
// The happy paths are covered through audit.test.mjs and apply.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from './lib/baseline.mjs';
import { ResolveError, readState, resolveRepository, snapshot } from './lib/read.mjs';
import { REPO, compliantRoutes, fakeGh, ruleset } from './fake-gh.mjs';

// A runner whose gh repo view answers with `result`.
const viewing = (result) => () => ({ ok: true, status: 0, stdout: '', stderr: '', ...result });
const resolveError = (gh) => {
  try {
    resolveRepository(gh);
  } catch (error) {
    assert.ok(error instanceof ResolveError, String(error));
    return error.message;
  }
  return assert.fail('resolveRepository did not throw');
};

const view = (overrides) => JSON.stringify({
  url: 'https://github.com/acme/widgets', owner: { login: 'acme' }, name: 'widgets', isInOrganization: true, ...overrides,
});

test('resolveRepository reports why gh repo view failed', () => {
  assert.equal(
    resolveError(viewing({ ok: false, status: 1, stderr: 'no git remotes found\n' })),
    'could not resolve the repository from the checkout: no git remotes found',
  );
  assert.equal(
    resolveError(viewing({ ok: false, status: 1 })),
    'could not resolve the repository from the checkout: gh repo view failed',
  );
});

test('resolveRepository reports a gh repo view that returned no JSON', () => {
  assert.equal(
    resolveError(viewing({ stdout: 'not json' })),
    'could not resolve the repository from the checkout: gh repo view returned no JSON',
  );
});

test('resolveRepository reports a URL that does not parse, and any field that is missing', () => {
  const empty = 'could not resolve the repository from the checkout: a field came back empty';
  assert.equal(resolveError(viewing({ stdout: view({ url: 'not a url' }) })), empty);
  assert.equal(resolveError(viewing({ stdout: view({ owner: undefined }) })), empty);
  assert.equal(resolveError(viewing({ stdout: view({ name: undefined }) })), empty);
  assert.equal(resolveError(viewing({ stdout: view({ isInOrganization: 'yes' }) })), empty);
});

const read = (routes) => {
  const gh = fakeGh(routes);
  return readState(gh, REPO, DEFAULTS);
};

test('readState reads an empty Actions permissions body as unknown, not disabled', () => {
  const routes = compliantRoutes();
  routes['GET repos/acme/widgets/actions/permissions'] = { data: undefined };
  const state = read(routes);
  assert.deepEqual(state.actionsEnabled, { ok: true, value: null });
  assert.equal(state.actionsWorkflow.ok, true);
  assert.ok(state.actionsWorkflow.value);
});

test('readState finds a ruleset with no self link at the path for its source', () => {
  const repoRuleset = ruleset({ id: 5, name: 'Repo' });
  const orgRuleset = ruleset({ id: 6, name: 'Org', source_type: 'Organization', source: 'acme' });
  delete repoRuleset._links;
  delete orgRuleset._links;
  const routes = compliantRoutes([ruleset()]);
  routes['GET repos/acme/widgets/rulesets'] = [repoRuleset, orgRuleset];
  routes['GET repos/acme/widgets/rulesets/5'] = repoRuleset;
  routes['GET orgs/acme/rulesets/6'] = orgRuleset;
  const state = read(routes);
  assert.equal(state.rulesets[5].href, 'repos/acme/widgets/rulesets/5');
  assert.equal(state.rulesets[6].href, 'orgs/acme/rulesets/6');
  assert.equal(state.rulesets[5].ok && state.rulesets[6].ok, true);
});

test('readState skips a ruleset that does not target branches', () => {
  const tagRuleset = ruleset({ id: 7, name: 'Tags', target: 'tag' });
  const routes = compliantRoutes([ruleset()]);
  routes['GET repos/acme/widgets/rulesets'] = [ruleset(), tagRuleset];
  const state = read(routes);
  assert.deepEqual(Object.keys(state.rulesets), ['1']);
});

test('readState keeps a ruleset it could not read, with where it is and what it was called', () => {
  const routes = compliantRoutes([ruleset()]);
  routes['GET repos/acme/widgets/rulesets/1'] = { status: 403, message: 'Must have admin rights' };
  const state = read(routes);
  assert.deepEqual(state.rulesets[1], {
    ok: false,
    httpStatus: 403,
    message: 'Must have admin rights',
    href: 'repos/acme/widgets/rulesets/1',
    summary: { id: 1, name: 'Guardrails', source_type: 'Repository', source: 'acme/widgets', enforcement: 'active' },
  });
});

test('readState fills a ruleset from its list entry where the detail leaves a field out', () => {
  const routes = compliantRoutes([ruleset()]);
  routes['GET repos/acme/widgets/rulesets/1'] = {};
  const { value } = read(routes).rulesets[1];
  assert.deepEqual(value, {
    id: 1,
    name: 'Guardrails',
    source_type: 'Repository',
    source: 'acme/widgets',
    target: 'branch',
    enforcement: 'active',
    bypass_actors: [],
    conditions: {},
    rules: [],
  });
});

test('readState ignores bypass actors and rules that are not lists', () => {
  const routes = compliantRoutes([ruleset()]);
  routes['GET repos/acme/widgets/rulesets/1'] = { ...ruleset(), bypass_actors: 'none', rules: { type: 'deletion' } };
  const { value } = read(routes).rulesets[1];
  assert.deepEqual([value.bypass_actors, value.rules], [[], []]);
});

test('snapshot is the same for the same state and changes when the state does', () => {
  const routes = compliantRoutes();
  assert.equal(snapshot(read(routes)), snapshot(read(routes)));
  routes['GET repos/acme/widgets'] = { ...routes['GET repos/acme/widgets'], allow_squash_merge: true };
  assert.notEqual(snapshot(read(compliantRoutes())), snapshot(read(routes)));
});

test('snapshot ignores the list of branches when it can be read, and keeps the failure when it cannot', () => {
  const withTopic = compliantRoutes(undefined, ['main', 'feature/x']);
  const without = compliantRoutes(undefined, ['main']);
  assert.equal(snapshot(read(withTopic)), snapshot(read(without)));
  const unreadable = compliantRoutes();
  unreadable['GET repos/acme/widgets/branches'] = { status: 500, message: 'boom' };
  assert.notEqual(snapshot(read(unreadable)), snapshot(read(without)));
});
