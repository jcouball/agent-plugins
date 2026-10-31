// A `gh` for tests that spawn a script: the fake in fake-gh.mjs behind a
// command line. The fake gh executable the test puts on PATH runs this.
//
//   FAKE_GH_STATE  a JSON file holding { routes, repoView }, as fakeGh takes
//   FAKE_GH_LOG    a file each call is appended to, as one JSON line

import fs from 'node:fs';
import { fakeGh } from './fake-gh.mjs';

const { routes, repoView } = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
const args = process.argv.slice(2);
const gh = fakeGh(routes, { repoView });
const result = gh(args, { input: args.includes('--input') ? fs.readFileSync(0, 'utf8') : undefined });
if (process.env.FAKE_GH_LOG) fs.appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify(gh.calls.at(-1))}\n`);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
// Not process.exit: that can cut off what is still queued to a pipe, which holds
// 64 KB at most, and the caller would read invalid JSON.
process.exitCode = result.ok ? 0 : 1;
