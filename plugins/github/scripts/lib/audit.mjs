// Comparing the live configuration to the resolved baseline, and planning
// the writes that would clear the drift. Pure: takes the state read.mjs
// produced and the baseline, returns checks and a plan, touches nothing.
//
// Check statuses:
//   pass            the setting matches the baseline
//   drift           it does not, and the plan may carry a fix
//   partial         it could not be read from here
//   not_applicable  nothing to check (Actions disabled)
//   note            a pass with a stated remainder the user should know
//   unprovable      a conflict that appears only once a ruleset that is not
//                   provably overlapping joins the group; not safe to write
//
// Plan steps run in array order. A step with `transition: true` belongs to
// the coordinated merge-method transition and is skipped once any widening
// step of that transition fails.

import { MERGE_METHODS, enabledMergeMethods } from './baseline.mjs';
import { describeFailure } from './gh.mjs';
import {
  REF_PREFIX,
  matchesPattern,
  parseSelector,
  provablyDisjoint,
  selectorCovers,
  selectorProvablyDisjoint,
} from './glob.mjs';
import { ACTIONS_FIELDS, repoPath, snapshot } from './read.mjs';

export const MERGE_FIELD = {
  merge: 'allow_merge_commit',
  squash: 'allow_squash_merge',
  rebase: 'allow_rebase_merge',
};

const INDEPENDENT_FIELDS = ['delete_branch_on_merge', 'allow_auto_merge'];

export const CREATED_RULESET_NAME = 'Protected branch guardrails';

export function urls(repository) {
  const base = `https://${repository.host}/${repository.owner}/${repository.repo}`;
  return {
    settings: `${base}/settings`,
    actions: `${base}/settings/actions`,
    rules: `${base}/settings/rules`,
    orgActions: `https://${repository.host}/organizations/${repository.owner}/settings/actions`,
  };
}

// --- rule helpers ----------------------------------------------------------

export function prMethods(rule) {
  const methods = rule?.parameters?.allowed_merge_methods;
  return Array.isArray(methods) ? [...methods] : [...MERGE_METHODS];
}

function pullRequestRule(rules) {
  return rules.find((r) => r.type === 'pull_request');
}

function ruleTypes(rules) {
  return new Set(rules.map((r) => r.type));
}

function intersect(lists) {
  if (lists.length === 0) return [];
  return MERGE_METHODS.filter((m) => lists.every((list) => list.includes(m)));
}

function includesOf(rs) {
  return rs.conditions?.ref_name?.include ?? [];
}

function excludesOf(rs) {
  return rs.conditions?.ref_name?.exclude ?? [];
}

// Whether the ruleset covers the pattern: a literal or `~ALL` include, and
// no exclusion that could remove a branch of the family.
function covers(rs, pattern) {
  return includesOf(rs).some((s) => selectorCovers(s, pattern))
    && excludesOf(rs).every((s) => selectorProvablyDisjoint(s, pattern));
}

// Whether the ruleset may bind some branch of the pattern's family.
function inFamily(rs, pattern) {
  return includesOf(rs).some((s) => !selectorProvablyDisjoint(s, pattern))
    && !excludesOf(rs).some((s) => selectorCovers(s, pattern));
}

function rulesetsProvablyDisjoint(a, b) {
  for (const sa of includesOf(a)) {
    for (const sb of includesOf(b)) {
      const pa = parseSelector(sa);
      const pb = parseSelector(sb);
      if (pa.kind !== 'pattern' || pb.kind !== 'pattern') return false;
      if (!provablyDisjoint(pa.pattern, pb.pattern)) return false;
    }
  }
  return true;
}

function describeRuleset(rs) {
  return `${rs.source_type === 'Organization' ? 'organization' : 'repository'} ruleset "${rs.name}" (${rs.id})`;
}

// The problems a set of co-applicable pull_request rules has.
export function evaluateMethods(methodLists, { enabled, linear }) {
  const intersection = intersect(methodLists);
  const problems = [];
  if (methodLists.length > 0 && intersection.length === 0) {
    problems.push('no merge method is allowed by every applicable pull_request rule');
  }
  for (const m of intersection) {
    if (!enabled.includes(m)) problems.push(`allows ${m}, which the baseline disables`);
  }
  if (linear && intersection.length > 0 && intersection.every((m) => m === 'merge')) {
    problems.push('only merge commits are allowed while required_linear_history is in force');
  }
  return { intersection, problems };
}

// The groups of rulesets whose pull_request rules a single branch of the
// pattern's family could meet together. `rulesOf(rs)` lets the plan
// substitute the rules a ruleset will carry after the planned writes.
function patternGroups(pattern, rulesets, rulesOf) {
  const covering = rulesets.filter((rs) => covers(rs, pattern));
  const family = rulesets.filter((rs) => inFamily(rs, pattern));
  const hasPr = (rs) => Boolean(pullRequestRule(rulesOf(rs)));
  const base = covering.filter(hasPr);
  const others = family.filter((rs) => !covering.includes(rs) && hasPr(rs));
  const groups = [];
  const seen = new Set();
  const add = (members, isBase) => {
    const key = members.map((rs) => rs.id).sort().join(',');
    if (members.length === 0 || seen.has(key)) return;
    seen.add(key);
    groups.push({ members, base: isBase });
  };
  add(base, true);
  for (const o of others) {
    add([...base, ...others.filter((o2) => o2 === o || !rulesetsProvablyDisjoint(o, o2))], false);
  }
  const linearFor = (group) => [...group.members, ...covering]
    .some((rs) => ruleTypes(rulesOf(rs)).has('required_linear_history'));
  return { covering, family, groups, linearFor };
}

// --- the audit -------------------------------------------------------------

export function audit(state, baseline) {
  const { repository } = state;
  const where = urls(repository);
  const enabled = enabledMergeMethods(baseline);
  const checks = [];
  const add = (check) => {
    checks.push(check);
    return check;
  };

  // Repository settings.
  if (state.settings.ok) {
    const live = state.settings.value;
    for (const method of MERGE_METHODS) {
      const field = MERGE_FIELD[method];
      add(compare('repository', field, `repository.${field}`, baseline.merge_methods[method], live[field]));
    }
    for (const field of INDEPENDENT_FIELDS) {
      add(compare('repository', field, `repository.${field}`, baseline.repository[field], live[field]));
    }
  } else {
    for (const field of [...Object.values(MERGE_FIELD), ...INDEPENDENT_FIELDS]) {
      add({
        id: `repository.${field}`, group: 'repository', label: field, status: 'partial',
        detail: `repository settings could not be read: ${describeFailure(state.settings)}`,
        where: [where.settings],
      });
    }
  }

  // The Actions token default.
  const actionsWhere = repository.inOrg ? [where.actions, where.orgActions] : [where.actions];
  if (!state.actionsEnabled.ok) {
    add({
      id: 'actions.enabled', group: 'actions', label: 'actions/permissions read', status: 'note',
      detail: `whether Actions is enabled could not be read: ${describeFailure(state.actionsEnabled)}; the workflow read decides`,
    });
  }
  if (state.actionsWorkflow.skipped === 'disabled') {
    for (const field of ACTIONS_FIELDS) {
      add({
        id: `actions.${field}`, group: 'actions', label: field, status: 'not_applicable',
        expected: baseline.actions[field],
        detail: 'Actions is disabled on the repository, so no workflow runs and no token is issued',
        where: actionsWhere,
      });
    }
  } else if (!state.actionsWorkflow.ok) {
    for (const field of ACTIONS_FIELDS) {
      add({
        id: `actions.${field}`, group: 'actions', label: field, status: 'partial',
        expected: baseline.actions[field],
        detail: `actions/permissions/workflow could not be read: ${describeFailure(state.actionsWorkflow)}`,
        where: [where.actions],
      });
    }
  } else {
    for (const field of ACTIONS_FIELDS) {
      add(compare('actions', field, `actions.${field}`, baseline.actions[field], state.actionsWorkflow.value[field]));
    }
  }

  // Rulesets available to the branch and pattern checks. Each entry is one
  // listing row: readable rows carry the fetched definition, unreadable ones
  // carry the failure and the listing's summary of the ruleset.
  const unreadable = Object.values(state.rulesets).filter((entry) => !entry.ok);
  const readable = Object.values(state.rulesets).filter((entry) => entry.ok).map((entry) => entry.value);
  const active = readable.filter((rs) => rs.target === 'branch' && rs.enforcement === 'active');
  const rulesOf = (rs) => rs.rules;

  // Each protected branch.
  const protectedBranches = state.branches.ok ? Object.keys(state.branchRules).sort() : [];
  if (!state.branches.ok) {
    add({
      id: 'branches', group: 'branches', label: 'branch listing', status: 'partial',
      detail: `branches could not be listed: ${describeFailure(state.branches)}`,
    });
  }
  for (const name of protectedBranches) {
    const group = `branch:${name}`;
    const read = state.branchRules[name];
    if (!read.ok) {
      add({
        id: `${group}.rules`, group, label: 'effective rules', status: 'partial',
        detail: `rules could not be read: ${describeFailure(read)}`,
      });
      continue;
    }
    const types = ruleTypes(read.rules);
    for (const type of baseline.branch_rules) {
      add({
        id: `${group}.rule.${type}`, group, label: `rule ${type}`,
        status: types.has(type) ? 'pass' : 'drift', expected: 'present', actual: types.has(type) ? 'present' : 'absent',
      });
    }
    const prRules = read.rules.filter((r) => r.type === 'pull_request');
    if (prRules.length > 0) {
      const { intersection, problems } = evaluateMethods(prRules.map(prMethods), {
        enabled, linear: types.has('required_linear_history'),
      });
      add({
        id: `${group}.merge_methods`, group, label: 'effective merge methods',
        status: problems.length ? 'drift' : 'pass', expected: enabled, actual: intersection,
        detail: problems.join('; ') || undefined,
      });
    }
  }

  // Each configured pattern, against the rulesets themselves.
  for (const pattern of baseline.protected_branches) {
    const group = `pattern:${pattern}`;
    if (!state.rulesetList.ok) {
      add({
        id: `${group}.coverage`, group, label: 'ruleset coverage', status: 'partial',
        detail: `rulesets could not be listed: ${describeFailure(state.rulesetList)}`,
      });
      continue;
    }
    const { covering, groups, linearFor } = patternGroups(pattern, active, rulesOf);
    const partialNote = unreadable.length
      ? ` (${unreadable.map((u) => `ruleset ${u.summary.id} unreadable: ${u.message}`).join('; ')})`
      : '';
    if (covering.length === 0) {
      add({
        id: `${group}.coverage`, group, label: 'ruleset coverage',
        status: unreadable.length ? 'partial' : 'drift',
        expected: `an active branch ruleset including ${REF_PREFIX}${pattern} or ~ALL with no overlapping exclusion`,
        actual: 'none', detail: `no active ruleset covers the pattern${partialNote}`,
      });
    } else {
      add({
        id: `${group}.coverage`, group, label: 'ruleset coverage',
        status: unreadable.length ? 'partial' : 'pass',
        actual: covering.map(describeRuleset).join(', '),
        detail: unreadable.length ? `covered, but${partialNote}` : undefined,
      });
      const union = new Set();
      for (const rs of covering) for (const t of ruleTypes(rs.rules)) union.add(t);
      for (const type of baseline.branch_rules) {
        add({
          id: `${group}.rule.${type}`, group, label: `rule ${type}`,
          status: union.has(type) ? 'pass' : 'drift', expected: 'present', actual: union.has(type) ? 'present' : 'absent',
        });
      }
    }
    if (groups.length > 0) {
      const findings = [];
      let status = 'pass';
      for (const g of groups) {
        const { intersection, problems } = evaluateMethods(g.members.map((rs) => prMethods(pullRequestRule(rs.rules))), {
          enabled, linear: linearFor(g),
        });
        if (problems.length === 0) continue;
        const names = g.members.map(describeRuleset).join(' with ');
        findings.push(`${names}: ${problems.join('; ')} (effective: ${intersection.join(', ') || 'none'})`);
        if (g.base) status = 'drift';
        else if (status !== 'drift') status = 'unprovable';
      }
      add({
        id: `${group}.merge_methods`, group, label: 'merge methods across rulesets', status,
        expected: enabled, detail: findings.join('. ') || undefined,
      });
    }
    const matched = state.branches.ok && state.branches.names.some((n) => matchesPattern(pattern, n));
    if (state.branches.ok && !matched && !baseline.branch_rules.includes('creation')) {
      add({
        id: `${group}.creation`, group, label: 'first push', status: 'note',
        detail: `no branch matches ${pattern} yet and branch_rules does not name creation, so a direct push can create the first branch of the family with direct commits; adding creation closes that and also blocks the legitimate first push`,
      });
    }
  }

  // Bypasses on rulesets the checks count on.
  auditBypasses({
    add, baseline, active, state, protectedBranches,
  });

  const plan = buildPlan({
    state, baseline, checks, enabled, active, unreadable, where,
  });

  return { checks, plan };
}

function compare(group, label, id, expected, actual) {
  return {
    id, group, label, status: actual === expected ? 'pass' : 'drift', expected, actual,
  };
}

function actorKey(actor) {
  return `${actor.actor_type ?? 'unknown'}:${actor.actor_id ?? 'unknown'}`;
}

function hasNonPrBypass(rs, key) {
  return rs.bypass_actors.some((a) => actorKey(a) === key && a.bypass_mode !== 'pull_request');
}

function auditBypasses({ add, baseline, active, state, protectedBranches }) {
  // Contexts: each pattern's covering rulesets, and each branch's effective rules.
  const contexts = [];
  for (const pattern of baseline.protected_branches) {
    const covering = active.filter((rs) => covers(rs, pattern));
    if (covering.length) contexts.push({ name: `pattern ${pattern}`, rulesets: covering.map((rs) => ({ rs, types: ruleTypes(rs.rules) })) });
  }
  const byId = new Map(active.map((rs) => [String(rs.id), rs]));
  for (const name of protectedBranches) {
    const read = state.branchRules[name];
    if (!read.ok) continue;
    const perRuleset = new Map();
    for (const rule of read.rules) {
      const id = String(rule.ruleset_id);
      if (!perRuleset.has(id)) perRuleset.set(id, new Set());
      perRuleset.get(id).add(rule.type);
    }
    contexts.push({
      name: `branch ${name}`,
      rulesets: [...perRuleset].map(([id, types]) => ({ rs: byId.get(id) ?? { id, name: `ruleset ${id}`, bypass_actors: [] }, types })),
    });
  }
  const reported = new Set();
  for (const context of contexts) {
    for (const { rs } of context.rulesets) {
      for (const actor of rs.bypass_actors) {
        if (actor.bypass_mode === 'pull_request') continue;
        const key = actorKey(actor);
        const enforced = new Set();
        for (const other of context.rulesets) {
          if (other.rs === rs || hasNonPrBypass(other.rs, key)) continue;
          for (const t of other.types) enforced.add(t);
        }
        const unenforced = baseline.branch_rules.filter((t) => !enforced.has(t));
        const id = `bypass:${rs.id}:${key}:${context.name}`;
        if (reported.has(id)) continue;
        reported.add(id);
        add({
          id, group: 'bypass', label: `${describeRuleset(rs)} bypass for ${key} (${actor.bypass_mode})`,
          status: unenforced.length ? 'drift' : 'note',
          detail: unenforced.length
            ? `on ${context.name}, ${unenforced.join(', ')} ${unenforced.length === 1 ? 'is' : 'are'} not enforced for this actor; a bypass may be deliberate, so this is a question for the user and never edited by --fix`
            : `on ${context.name}, every required rule still binds this actor through another ruleset`,
        });
      }
    }
  }
}

// --- the plan --------------------------------------------------------------

function fullPullRequestRule(enabled) {
  return {
    type: 'pull_request',
    parameters: {
      required_approving_review_count: 0,
      dismiss_stale_reviews_on_push: true,
      require_code_owner_review: false,
      require_last_push_approval: false,
      required_review_thread_resolution: false,
      allowed_merge_methods: [...enabled],
    },
  };
}

// The rules a qualifying ruleset carries after the merge.
function mergedRules(rs, baseline, enabled) {
  const rules = structuredClone(rs.rules);
  const types = ruleTypes(rules);
  for (const type of baseline.branch_rules) {
    if (types.has(type)) continue;
    rules.push(type === 'pull_request' ? fullPullRequestRule(enabled) : { type });
  }
  const pr = pullRequestRule(rules);
  if (pr && rs.rules.some((r) => r.type === 'pull_request')) {
    const current = prMethods(pr);
    let kept = current.filter((m) => enabled.includes(m));
    if (kept.length === 0) kept = [...enabled];
    pr.parameters = { ...(pr.parameters ?? {}), allowed_merge_methods: MERGE_METHODS.filter((m) => kept.includes(m)) };
  }
  return rules;
}

function rulesetBody(rs, rules) {
  return {
    name: rs.name,
    target: rs.target,
    enforcement: rs.enforcement,
    bypass_actors: rs.bypass_actors,
    conditions: rs.conditions,
    rules,
  };
}

// `rules` come from mergedRules, which leaves a pull_request rule with its
// parameters, and its one caller skips a write without one.
function withMethods(rules, methods) {
  const copy = structuredClone(rules);
  const pr = pullRequestRule(copy);
  pr.parameters = { ...pr.parameters, allowed_merge_methods: MERGE_METHODS.filter((m) => methods.includes(m)) };
  return copy;
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function qualifies(rs, expectedIncludes) {
  if (rs.source_type !== 'Repository' || rs.target !== 'branch' || rs.enforcement !== 'active') return false;
  const includes = includesOf(rs);
  if (includes.length !== expectedIncludes.size) return false;
  if (!includes.every((s) => expectedIncludes.has(s))) return false;
  if (new Set(includes).size !== includes.length) return false;
  if (excludesOf(rs).length !== 0) return false;
  if (rs.bypass_actors.some((a) => a.bypass_mode !== 'pull_request')) return false;
  return true;
}

function buildPlan({ state, baseline, checks, enabled, active, unreadable, where }) {
  const { repository } = state;
  const steps = [];
  const held = [];
  const drifted = new Set(checks.filter((c) => c.status === 'drift').map((c) => c.id));
  const hold = (checkIds, reason, whereList) => {
    const ids = checkIds.filter((id) => drifted.has(id) || checks.some((c) => c.id === id && c.status === 'unprovable'));
    if (ids.length) held.push({ checks: ids, reason, where: whereList });
  };

  // --- rulesets
  const expectedIncludes = new Set(baseline.protected_branches.map((p) => REF_PREFIX + p));
  const rulesetCheckIds = checks
    .filter((c) => c.group.startsWith('pattern:') || c.group.startsWith('branch:'))
    .map((c) => c.id);
  const patternMergeIds = checks.filter((c) => /^pattern:.*\.merge_methods$/.test(c.id)).map((c) => c.id);
  const mergeFieldIds = MERGE_METHODS.map((m) => `repository.${MERGE_FIELD[m]}`);

  let rulesetWrites = [];
  let createBody = null;
  let holdMergeFields = null;
  let rulesetsBlocked = null;

  if (!state.rulesetList.ok) {
    rulesetsBlocked = `rulesets could not be listed (${describeFailure(state.rulesetList)})`;
  } else if (unreadable.length) {
    rulesetsBlocked = `${unreadable.map((u) => `ruleset ${u.summary.id} could not be read (${describeFailure(u)})`).join('; ')}; without its conditions, merge methods, and bypasses no ruleset write or merge-method change can be proven safe`;
  }

  const rulesetDrift = rulesetCheckIds.some((id) => drifted.has(id));
  if (rulesetsBlocked) {
    hold(rulesetCheckIds, rulesetsBlocked, [where.rules]);
    holdMergeFields = rulesetsBlocked;
  } else if (!rulesetDrift) {
    // Nothing on a branch or pattern drifted, so no ruleset is written: a
    // bypass finding, say, is a question for the user, never a write.
  } else {
    const qualifying = active.filter((rs) => qualifies(rs, expectedIncludes));
    const planned = new Map();
    for (const rs of qualifying) {
      const rules = mergedRules(rs, baseline, enabled);
      if (!sameJson(rules, rs.rules)) planned.set(rs, rules);
    }
    const virtual = qualifying.length === 0 ? {
      id: 'new', name: CREATED_RULESET_NAME, source_type: 'Repository', target: 'branch', enforcement: 'active',
      bypass_actors: [],
      conditions: { ref_name: { include: [...expectedIncludes], exclude: [] } },
      rules: [
        ...baseline.branch_rules.filter((t) => t !== 'pull_request').map((t) => ({ type: t })),
        fullPullRequestRule(enabled),
      ],
    } : null;
    const future = virtual ? [...active, virtual] : active;
    const futureRules = (rs) => planned.get(rs) ?? rs.rules;

    // Preflight: every co-applicable group as it will stand after the writes.
    const problems = [];
    for (const pattern of baseline.protected_branches) {
      const { groups, linearFor } = patternGroups(pattern, future, futureRules);
      for (const g of groups) {
        const { intersection, problems: p } = evaluateMethods(
          g.members.map((rs) => prMethods(pullRequestRule(futureRules(rs)))),
          { enabled, linear: linearFor(g) },
        );
        if (p.length === 0) continue;
        const names = g.members.map((rs) => (rs === virtual ? 'the ruleset --fix would create' : describeRuleset(rs))).join(' with ');
        problems.push(`on ${pattern}, ${names}: ${p.join('; ')} (effective: ${intersection.join(', ') || 'none'})${g.base ? '' : '; the overlap is not provable, so the conflict is possible rather than certain'}`);
      }
    }

    if (problems.length) {
      const reason = `the planned ruleset writes would leave an unmergeable or unsafe state, and the rules involved belong to someone: ${problems.join('. ')}. Reconciling them is the user's call`;
      hold([...patternMergeIds, ...rulesetCheckIds], reason, [where.rules]);
      holdMergeFields = reason;
    } else {
      for (const [rs, rules] of planned) {
        rulesetWrites.push({ rs, rules });
      }
      if (virtual) createBody = rulesetBody(virtual, virtual.rules);
    }
  }

  // --- repository settings
  const settingsOk = state.settings.ok;
  const live = settingsOk ? state.settings.value : null;
  const liveEnabled = settingsOk ? MERGE_METHODS.filter((m) => live[MERGE_FIELD[m]] === true) : [];
  const mergeDrift = settingsOk && MERGE_METHODS.some((m) => live[MERGE_FIELD[m]] !== baseline.merge_methods[m]);
  const independentDrift = settingsOk ? INDEPENDENT_FIELDS.filter((f) => live[f] !== baseline.repository[f]) : [];

  if (!settingsOk) {
    hold([...mergeFieldIds, ...INDEPENDENT_FIELDS.map((f) => `repository.${f}`)],
      `repository settings could not be read (${describeFailure(state.settings)})`, [where.settings]);
  }
  if (holdMergeFields && settingsOk && mergeDrift) {
    hold(mergeFieldIds, holdMergeFields, [where.settings, where.rules]);
  }

  const mergeAllowed = settingsOk && !holdMergeFields;
  const prNarrowing = rulesetWrites.some(({ rs, rules }) => {
    const before = pullRequestRule(rs.rules);
    const after = pullRequestRule(rules);
    return Boolean(before && after) && prMethods(before).some((m) => !prMethods(after).includes(m));
  });
  const transition = (mergeAllowed && mergeDrift) || prNarrowing;

  // Phase one: widen.
  const widenBody = {};
  for (const f of independentDrift) widenBody[f] = baseline.repository[f];
  if (mergeAllowed && mergeDrift) {
    const union = MERGE_METHODS.filter((m) => liveEnabled.includes(m) || enabled.includes(m));
    for (const m of union) if (!liveEnabled.includes(m)) widenBody[MERGE_FIELD[m]] = true;
  }
  const widenFixes = [
    ...independentDrift.map((f) => `repository.${f}`),
    ...Object.keys(widenBody).filter((f) => Object.values(MERGE_FIELD).includes(f)).map((f) => `repository.${f}`),
  ];
  if (Object.keys(widenBody).length) {
    steps.push({
      id: 'settings-widen', kind: 'patch_settings', method: 'PATCH', path: repoPath(repository), body: widenBody,
      phase: transition ? 'widen' : 'independent', transition, fixes: widenFixes, where: where.settings,
      description: transition
        ? 'enable every merge method the transition needs, and fix the fields that carry no merge-method risk'
        : 'fix the drifted repository settings',
    });
  }

  // Every ruleset widens before any ruleset narrows. The effective methods
  // are the intersection across rulesets, so narrowing one while another
  // still allows only its old methods empties that intersection until the
  // other is widened too, and leaves it empty if that widening fails.
  const rulesetFixes = checks.filter((c) => c.group.startsWith('pattern:') || c.group.startsWith('branch:'))
    .filter((c) => c.status === 'drift').map((c) => c.id);
  for (const { rs, rules } of rulesetWrites) {
    const before = pullRequestRule(rs.rules);
    const after = pullRequestRule(rules);
    if (!before || !after) continue;
    const union = MERGE_METHODS.filter((m) => prMethods(before).includes(m) || prMethods(after).includes(m));
    const widened = withMethods(rules, union);
    if (sameJson(widened, rules)) continue;
    // A widening write fixes nothing on its own: the drift clears when the
    // narrowing write after it lands, so it claims no check.
    steps.push({
      id: `ruleset-${rs.id}-widen`, kind: 'put_ruleset', method: 'PUT', path: repoPath(repository, `/rulesets/${rs.id}`),
      body: rulesetBody(rs, widened), phase: 'widen', transition: true, ruleset_id: rs.id,
      final_pr_methods: union, fixes: [], where: where.rules,
      description: `widen the pull_request rule of ${describeRuleset(rs)} to ${union.join(', ')} before narrowing`,
    });
  }

  if (createBody) {
    steps.push({
      id: 'ruleset-create', kind: 'post_ruleset', method: 'POST', path: repoPath(repository, '/rulesets'),
      body: createBody, phase: 'create', transition: false, final_pr_methods: [...enabled],
      fixes: rulesetFixes, where: where.rules,
      description: `create the "${CREATED_RULESET_NAME}" ruleset for ${[...expectedIncludes].join(', ')}`,
    });
  }

  // Phase two: narrow.
  for (const { rs, rules } of rulesetWrites) {
    const after = pullRequestRule(rules);
    steps.push({
      id: `ruleset-${rs.id}`, kind: 'put_ruleset', method: 'PUT', path: repoPath(repository, `/rulesets/${rs.id}`),
      body: rulesetBody(rs, rules), phase: transition ? 'narrow' : 'independent', transition,
      ruleset_id: rs.id, final_pr_methods: after ? prMethods(after) : null, fixes: rulesetFixes, where: where.rules,
      description: `merge the baseline into ${describeRuleset(rs)}`,
    });
  }

  if (mergeAllowed && mergeDrift) {
    const narrowBody = {};
    for (const m of MERGE_METHODS) {
      const afterWiden = liveEnabled.includes(m) || enabled.includes(m);
      if (afterWiden !== baseline.merge_methods[m]) narrowBody[MERGE_FIELD[m]] = baseline.merge_methods[m];
    }
    if (Object.keys(narrowBody).length) {
      steps.push({
        id: 'settings-narrow', kind: 'patch_settings', method: 'PATCH', path: repoPath(repository), body: narrowBody,
        phase: 'narrow', transition: true, where: where.settings,
        fixes: Object.keys(narrowBody).map((f) => `repository.${f}`),
        description: 'disable the merge methods the baseline disables, now that every rule allows a baseline method',
      });
    }
  }

  // --- the Actions token default
  if (state.actionsWorkflow.skipped !== 'disabled') {
    if (!state.actionsWorkflow.ok) {
      hold(ACTIONS_FIELDS.map((f) => `actions.${f}`),
        `actions/permissions/workflow could not be read (${describeFailure(state.actionsWorkflow)}), so the drift is unknown and a write could not be verified`,
        [where.actions]);
    } else {
      for (const field of ACTIONS_FIELDS) {
        const want = baseline.actions[field];
        if (state.actionsWorkflow.value[field] === want) continue;
        const loosening = (field === 'default_workflow_permissions' && want === 'write')
          || (field === 'can_approve_pull_request_reviews' && want === true);
        steps.push({
          id: `actions-${field}`, kind: 'put_actions', method: 'PUT', path: repoPath(repository, '/actions/permissions/workflow'),
          body: { [field]: want }, phase: 'independent', transition: false, field, loosening,
          fixes: [`actions.${field}`], where: where.actions,
          description: `set ${field} to ${JSON.stringify(want)}`,
        });
      }
    }
  }

  const confirmRequired = steps.some((s) => s.kind !== 'put_actions' && (s.kind !== 'patch_settings' || s.transition));

  return {
    snapshot: snapshot(state),
    repository,
    baseline,
    steps,
    held,
    transition,
    confirm_required: confirmRequired,
  };
}
