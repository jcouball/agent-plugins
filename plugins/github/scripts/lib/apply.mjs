// Applying a plan audit.mjs built. The plan is applied only to the state it
// was built from: the reads are repeated first, and a changed fingerprint
// means another administrator was here, so the caller gets a fresh audit
// to rebuild and confirm from instead of a write over their change.
//
// Step outcomes:
//   applied   the write returned success
//   refused   403 or 404: admin access is missing; the settings page is named
//   capped    409 on a loosening Actions write in an organization: the
//             organization caps the field
//   failed    any other error, reported with GitHub's message
//   skipped   not attempted, with the reason

import { api, describeFailure } from './gh.mjs';
import { audit, MERGE_FIELD } from './audit.mjs';
import { MERGE_METHODS } from './baseline.mjs';
import { ACTIONS_FIELDS, readState, repoPath, snapshot } from './read.mjs';

const RETRIES = 5;

export async function applyPlan({
  gh, plan, baseline, sleep = (ms) => new Promise((r) => { setTimeout(r, ms); }), read = readState,
}) {
  const { repository } = plan;
  const { host } = repository;

  const fresh = read(gh, repository, baseline);
  if (snapshot(fresh) !== plan.snapshot) {
    return {
      status: 'stale',
      reason: 'the repository changed since the plan was built; rebuild the plan from this audit and confirm again',
      audit: audit(fresh, baseline),
    };
  }

  const results = [];
  let transitionAborted = null;
  let settingsRefused = false;
  let enabledNow = enabledMethods(fresh.settings.ok ? fresh.settings.value : {});

  for (const step of plan.steps) {
    if (step.transition && transitionAborted) {
      results.push({ id: step.id, status: 'skipped', reason: `the coordinated transition was aborted: ${transitionAborted}` });
      continue;
    }
    if (settingsRefused && step.final_pr_methods) {
      const shared = step.final_pr_methods.filter((m) => enabledNow.includes(m));
      if (shared.length === 0) {
        results.push({
          id: step.id, status: 'skipped',
          reason: `blocked on the settings fix: the rule would allow ${step.final_pr_methods.join(', ')} while the repository enables ${enabledNow.join(', ') || 'no method'}, leaving every matched branch unmergeable`,
        });
        continue;
      }
    }

    const result = api(gh, host, step.path, { method: step.method, body: step.body });
    if (result.ok) {
      results.push({ id: step.id, status: 'applied' });
      if (step.kind === 'patch_settings') enabledNow = applyPatch(enabledNow, step.body);
      continue;
    }

    const outcome = classify(step, result, repository);
    results.push({ id: step.id, ...outcome });
    if (step.phase === 'widen') transitionAborted = `${step.id} ${outcome.status} (${outcome.message})`;
    if (step.kind === 'patch_settings') {
      settingsRefused = true;
      const reread = api(gh, host, repoPath(repository));
      if (reread.ok) enabledNow = enabledMethods(reread.data);
    }
  }

  // The Actions endpoint can lag its own write: re-read until it matches.
  const appliedActions = plan.steps.filter((s) => s.kind === 'put_actions'
    && results.find((r) => r.id === s.id)?.status === 'applied');
  if (appliedActions.length) {
    const want = {};
    for (const s of appliedActions) want[s.field] = s.body[s.field];
    let last = null;
    for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
      const reread = api(gh, host, repoPath(repository, '/actions/permissions/workflow'));
      // An empty body is a read that verified nothing, the same as a failed one.
      const unreadable = !reread.ok || !reread.data || typeof reread.data !== 'object';
      if (unreadable) {
        for (const s of appliedActions) {
          const r = results.find((x) => x.id === s.id);
          r.status = 'unverified';
          r.message = `re-read failed on attempt ${attempt}: ${reread.ok ? 'the response carried no fields' : reread.message}`;
        }
        last = null;
        break;
      }
      last = reread.data;
      if (ACTIONS_FIELDS.every((f) => !(f in want) || last[f] === want[f])) break;
      if (attempt < RETRIES) await sleep(1000);
    }
    if (last) {
      for (const s of appliedActions) {
        if (last[s.field] !== want[s.field]) {
          const r = results.find((x) => x.id === s.id);
          r.status = 'failed';
          r.message = `the write returned success but ${s.field} still reads ${JSON.stringify(last[s.field])} after ${RETRIES} reads`;
        }
      }
    }
  }

  // Verify by re-auditing; a line a successful write should have fixed may
  // lag, so re-read a few times before calling it a failed fix.
  const fixed = new Set();
  for (const step of plan.steps) {
    if (results.find((r) => r.id === step.id)?.status === 'applied') for (const id of step.fixes ?? []) fixed.add(id);
  }
  let final;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    final = audit(read(gh, repository, baseline), baseline);
    const lagging = final.checks.filter((c) => fixed.has(c.id) && c.status === 'drift');
    if (lagging.length === 0 || attempt === RETRIES) break;
    await sleep(1000);
  }

  return { status: 'applied', steps: results, audit: final };
}

function enabledMethods(settings) {
  return MERGE_METHODS.filter((m) => settings?.[MERGE_FIELD[m]] === true);
}

function applyPatch(enabledNow, body) {
  return MERGE_METHODS.filter((m) => {
    const field = MERGE_FIELD[m];
    return field in body ? body[field] === true : enabledNow.includes(m);
  });
}

function classify(step, result, repository) {
  const message = describeFailure(result);
  if (result.httpStatus === 403 || result.httpStatus === 404) {
    return {
      status: 'refused', message,
      detail: 'the write needs admin access that this account lacks; make the change by hand',
      where: [step.where],
    };
  }
  if (step.kind === 'put_actions' && result.httpStatus === 409) {
    if (repository.inOrg && step.loosening) {
      const orgActions = `https://${repository.host}/organizations/${repository.owner}/settings/actions`;
      return {
        status: 'capped', message,
        detail: `the organization caps ${step.field}; change it in the organization's Actions settings, or its enterprise's where the organization inherits the value`,
        where: [orgActions],
      };
    }
    return {
      status: 'failed', message,
      detail: `GitHub documents no cause for a 409 on this write; its message is reported as given`,
      where: [step.where],
    };
  }
  return { status: 'failed', message, where: [step.where] };
}
