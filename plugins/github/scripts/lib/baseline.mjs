// The guardrails baseline: parsing `.claude/repo-guardrails.yml`, filling in
// the built-in defaults, and validating the result before anything is
// compared against it.
//
// The file is YAML 1.2 under the core schema, read by the vendored js-yaml:
// `yes` and `on` are strings, there are no timestamps, and a value is what
// it looks like. Duplicate keys are an error at every level, because
// loaders disagree about which copy wins; so is a second document.

import { CORE_SCHEMA, YAMLException, loadAll } from '../vendor/js-yaml.mjs';

export const SUPPORTED_RULE_TYPES = [
  'pull_request',
  'creation',
  'deletion',
  'non_fast_forward',
  'required_linear_history',
  'required_signatures',
];

export const PARAMETERLESS_RULE_TYPES = SUPPORTED_RULE_TYPES.filter(
  (type) => type !== 'pull_request',
);

export const MERGE_METHODS = ['merge', 'squash', 'rebase'];

export const DEFAULTS = Object.freeze({
  protected_branches: ['main', 'master'],
  merge_methods: { merge: false, squash: false, rebase: true },
  repository: { delete_branch_on_merge: true, allow_auto_merge: false },
  actions: {
    default_workflow_permissions: 'read',
    can_approve_pull_request_reviews: false,
  },
  branch_rules: ['pull_request', 'non_fast_forward', 'deletion', 'required_linear_history'],
});

export const BUILT_IN_SOURCE = 'built-in defaults';

// ---------------------------------------------------------------------------
// Parsing

// Parse the file. Returns { value } or { error }; an empty file is a null
// value, which resolution reads as every key absent. Errors carry the line
// where js-yaml reports one.
export function parseYaml(source) {
  let documents;
  try {
    documents = loadAll(source, { schema: CORE_SCHEMA });
  } catch (err) {
    if (!(err instanceof YAMLException)) throw err;
    const where = typeof err.mark?.line === 'number' ? `line ${err.mark.line + 1}: ` : '';
    return { error: `${where}${err.reason}` };
  }
  if (documents.length > 1) return { error: 'more than one document' };
  return { value: documents.length === 0 ? null : documents[0] ?? null };
}

// ---------------------------------------------------------------------------
// Resolution and validation

const TOP_LEVEL_KEYS = ['protected_branches', 'merge_methods', 'repository', 'actions', 'branch_rules'];

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'object' ? 'a mapping' : `${typeof value} ${JSON.stringify(value)}`;
}

// Resolve the baseline from the guardrails file text, or from the built-in
// defaults when `text` is null. Returns { baseline, source } or { errors }.
export function resolveBaseline(text, { source = '.claude/repo-guardrails.yml' } = {}) {
  if (text === null || text === undefined) {
    return { baseline: structuredClone(DEFAULTS), source: BUILT_IN_SOURCE };
  }
  const parsed = parseYaml(text);
  if (parsed.error) return { errors: [`${source}: ${parsed.error}`] };
  const file = parsed.value === null ? {} : parsed.value;
  const errors = [];
  if (!isMapping(file)) {
    return { errors: [`${source}: the root must be a mapping, not ${describe(file)}`] };
  }
  for (const key of Object.keys(file)) {
    if (!TOP_LEVEL_KEYS.includes(key)) errors.push(`unknown key: ${key}`);
  }

  const baseline = structuredClone(DEFAULTS);

  // Mappings of booleans.
  for (const section of ['merge_methods', 'repository']) {
    if (!(section in file)) continue;
    const value = file[section];
    if (!isMapping(value)) {
      errors.push(`${section} must be a mapping, not ${describe(value)}`);
      continue;
    }
    for (const [key, v] of Object.entries(value)) {
      if (!(key in DEFAULTS[section])) {
        errors.push(`unknown key: ${section}.${key}`);
        continue;
      }
      if (typeof v !== 'boolean') {
        errors.push(`${section}.${key} must be true or false, not ${describe(v)}`);
        continue;
      }
      baseline[section][key] = v;
    }
  }

  if ('actions' in file) {
    const value = file.actions;
    if (!isMapping(value)) {
      errors.push(`actions must be a mapping, not ${describe(value)}`);
    } else {
      for (const [key, v] of Object.entries(value)) {
        if (key === 'default_workflow_permissions') {
          if (v !== 'read' && v !== 'write') {
            errors.push(`actions.default_workflow_permissions must be read or write, not ${describe(v)}`);
          } else baseline.actions[key] = v;
        } else if (key === 'can_approve_pull_request_reviews') {
          if (typeof v !== 'boolean') {
            errors.push(`actions.${key} must be true or false, not ${describe(v)}`);
          } else baseline.actions[key] = v;
        } else errors.push(`unknown key: actions.${key}`);
      }
    }
  }

  if ('protected_branches' in file) {
    const value = file.protected_branches;
    if (!Array.isArray(value) || value.some((p) => typeof p !== 'string')) {
      errors.push(`protected_branches must be a list of strings, not ${describe(value)}`);
    } else if (value.length === 0) {
      errors.push('protected_branches is empty');
    } else {
      const seen = new Set();
      for (const pattern of value) {
        if (pattern === '') errors.push('protected_branches has an empty pattern');
        else if (pattern.startsWith('~') || pattern.startsWith('refs/')) {
          errors.push(`protected_branches pattern must be a bare fnmatch pattern, not ${pattern}`);
        } else if (seen.has(pattern)) errors.push(`protected_branches pattern appears twice: ${pattern}`);
        seen.add(pattern);
      }
      baseline.protected_branches = [...value];
    }
  }

  if ('branch_rules' in file) {
    const value = file.branch_rules;
    if (!Array.isArray(value) || value.some((p) => typeof p !== 'string')) {
      errors.push(`branch_rules must be a list of strings, not ${describe(value)}`);
    } else {
      const seen = new Set();
      for (const type of value) {
        if (!SUPPORTED_RULE_TYPES.includes(type)) errors.push(`branch_rules names an unsupported type: ${type}`);
        else if (seen.has(type)) errors.push(`branch_rules names a type twice: ${type}`);
        seen.add(type);
      }
      if (!value.includes('pull_request')) errors.push('branch_rules does not include pull_request');
      baseline.branch_rules = [...value];
    }
  }

  if (errors.length === 0) {
    const enabled = enabledMergeMethods(baseline);
    if (enabled.length === 0) errors.push('merge_methods enables no method');
    else if (
      baseline.branch_rules.includes('required_linear_history')
      && enabled.length === 1 && enabled[0] === 'merge'
    ) {
      errors.push('branch_rules names required_linear_history while merge commits are the only enabled method');
    }
  }

  if (errors.length > 0) return { errors: errors.map((e) => `${source}: ${e}`) };
  return { baseline, source };
}

export function enabledMergeMethods(baseline) {
  return MERGE_METHODS.filter((m) => baseline.merge_methods[m]);
}
