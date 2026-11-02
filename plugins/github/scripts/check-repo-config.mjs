#!/usr/bin/env node
// The deterministic half of the check-repo-config command.
//
//   check-repo-config.mjs audit [--plan-out <file>]
//       Resolve the baseline and the repository, read the live configuration,
//       and print the checklist and the plan as JSON. Writes nothing to GitHub.
//   check-repo-config.mjs apply <plan.json>
//       Re-read, refuse if anything changed since the plan, else perform the
//       plan's writes in order, verify, and print the outcome and a fresh audit.
//   check-repo-config.mjs guidance render
//   check-repo-config.mjs guidance inspect <file>
//   check-repo-config.mjs guidance write <file>
//       The canonical guidance block for the resolved baseline: print it,
//       classify a file's copy of it, or append or refresh it in a file.
//
// Exit codes: 0 done (drift included); 1 usage or a fatal error; 2 baseline
// error, in which case nothing else is reported; 3 the plan is stale;
// 4 a guidance write was refused.

import { createGh } from './lib/gh.mjs';
import { run } from './lib/run.mjs';

process.exitCode = await run({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: process.env,
  gh: createGh(),
  stdout: process.stdout,
});
