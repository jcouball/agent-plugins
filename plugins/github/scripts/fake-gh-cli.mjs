// A `gh` for tests that spawn a script: the fake in fake-gh.mjs behind a
// command line. The fake gh executable the test puts on PATH runs this.
//
//   FAKE_GH_STATE  a JSON file holding { routes, repoView }, as fakeGh takes

import fs from 'node:fs';
import { fakeGh } from './fake-gh.mjs';

const { routes, repoView } = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
const args = process.argv.slice(2);
const gh = fakeGh(routes, { repoView });
const result = gh(args, { input: args.includes('--input') ? fs.readFileSync(0, 'utf8') : undefined });
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
// Not process.exit: that can cut off what is still queued to a pipe, which holds
// 64 KB at most, and the caller would read invalid JSON.
process.exitCode = result.ok ? 0 : 1;
