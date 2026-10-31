import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, BUILT_IN_SOURCE, parseYaml, resolveBaseline } from './lib/baseline.mjs';

const errorsOf = (text) => resolveBaseline(text).errors ?? [];
const hasError = (text, fragment) => {
  const errors = errorsOf(text);
  assert.ok(errors.some((e) => e.includes(fragment)), `expected an error containing ${JSON.stringify(fragment)}, got ${JSON.stringify(errors)}`);
};

test('parseYaml reads the documented file shape', () => {
  const { value } = parseYaml(`
# comment
protected_branches:      # ruleset fnmatch patterns
  - main
  - "release/**/*"
merge_methods:
  merge: false
  squash: false
  rebase: true
repository:
  delete_branch_on_merge: true
  allow_auto_merge: false
actions:
  default_workflow_permissions: read
  can_approve_pull_request_reviews: false
branch_rules: [pull_request, non_fast_forward]
`);
  assert.deepEqual(value, {
    protected_branches: ['main', 'release/**/*'],
    merge_methods: { merge: false, squash: false, rebase: true },
    repository: { delete_branch_on_merge: true, allow_auto_merge: false },
    actions: { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false },
    branch_rules: ['pull_request', 'non_fast_forward'],
  });
});

test('parseYaml reads YAML 1.2 under the core schema', () => {
  const { value } = parseYaml(`---
protected_branches:
- main
- 'release/**/*'
merge_methods: { merge: false, squash: false, rebase: true }
actions:
  default_workflow_permissions: "read"
  can_approve_pull_request_reviews: no
`);
  assert.deepEqual(value, {
    protected_branches: ['main', 'release/**/*'],
    merge_methods: { merge: false, squash: false, rebase: true },
    // Under the core schema `no` is a string; validation then rejects it as not a boolean.
    actions: { default_workflow_permissions: 'read', can_approve_pull_request_reviews: 'no' },
  });
  assert.equal(parseYaml('').value, null);
  assert.equal(parseYaml('# only a comment\n').value, null);
  assert.equal(parseYaml('---\n').value, null);
});

test('parseYaml reports duplicate keys at every level', () => {
  assert.match(parseYaml('merge_methods:\n  rebase: true\n  rebase: false\n').error, /^line 3: duplicated mapping key/);
  assert.match(parseYaml('a: 1\nb: 2\na: 3\n').error, /^line 3: duplicated mapping key/);
  assert.match(parseYaml('m: { a: 1, a: 2 }\n').error, /^line 1: duplicated mapping key/);
});

test('parseYaml rejects a second document, tabs, and bad indentation with the line', () => {
  assert.equal(parseYaml('a: 1\n---\nb: 2\n').error, 'more than one document');
  assert.match(parseYaml('a:\n\t- b\n').error, /^line 2: tab characters/);
  assert.match(parseYaml('a: 1\n  b: 2\n').error, /^line 2: bad indentation/);
});

test('a missing file resolves to the built-in defaults', () => {
  const { baseline, source } = resolveBaseline(null);
  assert.deepEqual(baseline, DEFAULTS);
  assert.equal(source, BUILT_IN_SOURCE);
});

test('an absent key resolves to its default, including nested keys', () => {
  const { baseline } = resolveBaseline('merge_methods:\n  squash: true\n');
  assert.deepEqual(baseline.merge_methods, { merge: false, squash: true, rebase: true });
  assert.deepEqual(baseline.protected_branches, ['main', 'master']);
});

test('an empty file is every key absent', () => {
  assert.deepEqual(resolveBaseline('# nothing\n').baseline, DEFAULTS);
});

test('unknown keys are errors, not absent keys', () => {
  hasError('repository:\n  allow_auto_merg: true\n', 'unknown key: repository.allow_auto_merg');
  hasError('protected_branchs: [main]\n', 'unknown key: protected_branchs');
  hasError('actions:\n  default_permissions: read\n', 'unknown key: actions.default_permissions');
});

test('a value of the wrong shape is malformed, not absent', () => {
  hasError('just a string\n', 'root must be a mapping');
  hasError('repository: true\n', 'repository must be a mapping');
  hasError('merge_methods: [rebase]\n', 'merge_methods must be a mapping');
  hasError('merge_methods:\n  rebase: yes\n', 'merge_methods.rebase must be true or false');
  hasError('actions:\n  default_workflow_permissions: admin\n', 'read or write');
  hasError('actions:\n  can_approve_pull_request_reviews: no\n', 'true or false');
  hasError('protected_branches: main\n', 'list of strings');
  hasError('protected_branches: [main, 1]\n', 'list of strings');
  hasError('branch_rules: pull_request\n', 'list of strings');
});

test('protected_branches rules', () => {
  hasError('protected_branches: []\n', 'protected_branches is empty');
  hasError('protected_branches: [main, ""]\n', 'empty pattern');
  hasError('protected_branches: ["~ALL"]\n', 'bare fnmatch pattern');
  hasError('protected_branches: [refs/heads/main]\n', 'bare fnmatch pattern');
  hasError('protected_branches: [main, main]\n', 'appears twice');
});

test('branch_rules rules', () => {
  hasError('branch_rules: [pull_request, required_status_checks]\n', 'unsupported type: required_status_checks');
  hasError('branch_rules: [pull_request, deletion, deletion]\n', 'names a type twice: deletion');
  hasError('branch_rules: [deletion]\n', 'does not include pull_request');
  hasError('branch_rules: []\n', 'does not include pull_request');
});

test('merge method combinations', () => {
  hasError('merge_methods:\n  rebase: false\n', 'enables no method');
  hasError('merge_methods:\n  merge: true\n  rebase: false\n', 'required_linear_history while merge commits are the only');
  assert.equal(resolveBaseline('merge_methods:\n  merge: true\n  rebase: false\nbranch_rules: [pull_request]\n').errors, undefined);
});

test('every error names the source file', () => {
  const { errors } = resolveBaseline('protected_branches: []\n', { source: 'x.yml' });
  assert.ok(errors.every((e) => e.startsWith('x.yml: ')));
});

test('resolveBaseline reports a YAML syntax error with its source and line', () => {
  const { errors } = resolveBaseline('protected_branches: [main\nmerge_methods: {', { source: 'baseline.yml' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^baseline\.yml: line \d+: /);
});

test('resolveBaseline says what kind of value it found where it wanted another', () => {
  hasError('merge_methods: null\n', 'merge_methods must be a mapping, not null');
  hasError('merge_methods:\n  merge: {}\n', 'merge_methods.merge must be true or false, not a mapping');
  hasError('repository: [a]\n', 'repository must be a mapping, not a list');
  hasError('actions:\n  can_approve_pull_request_reviews: 3\n', 'must be true or false, not number 3');
});

test('resolveBaseline says an actions section that is not a mapping is wrong', () => {
  hasError('actions: 3\n', 'actions must be a mapping, not number 3');
  hasError('actions: [read]\n', 'actions must be a mapping, not a list');
});

test('parseYaml does not report an error that is not a YAML syntax error as one', () => {
  const unreadable = { toString() { throw new Error('not a syntax error'); } };
  assert.throws(() => parseYaml(unreadable), /not a syntax error/);
});
