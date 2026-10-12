---
name: test-debugging
description: 'Diagnoses a failing or flaky RSpec test, finds the root cause, reports it, and applies the right kind of fix. Use when a test fails consistently, fails intermittently, passes alone but fails in the suite, passes locally but fails elsewhere, or when asked to debug, diagnose, or fix a test. If the current project has its own test-debugging skill, that file holds project-specific changes and additions: still apply this skill, and apply those changes on top (Step 0).'
---

# Test debugging

Diagnose a failing or flaky test, report the root cause, and fix it in the way the
cause calls for. Stop after the report unless asked to fix.

## Contents

- [Step 0: Apply project overrides](#step-0-apply-project-overrides)
- [Step 1: Run and observe](#step-1-run-and-observe)
- [Step 2: Find the root cause](#step-2-find-the-root-cause)
- [Step 3: Report](#step-3-report)
- [Step 4: Choose the fix](#step-4-choose-the-fix)
- [Step 5: Verify the fix](#step-5-verify-the-fix)

## Step 0: Apply project overrides

A project may carry its own thin copy of this skill holding only its local changes
and additions: the commands that run one spec, the suite, and the suite in parallel,
the number of random-order runs that verify an order-dependence fix, its shared
contexts and helpers, where its fixtures live, and which skill handles failures that
appear only in CI. Check for one at each of these paths and use the first that exists:

- `.claude/skills/test-debugging/SKILL.md`
- `.github/skills/test-debugging/SKILL.md`

If neither exists, fall back to searching wherever the project keeps agent skills
for a `SKILL.md` whose frontmatter `name` is `test-debugging`:

```bash
grep -rlE --include=SKILL.md "^name: *['\"]?test-debugging['\"]? *$" . \
  --exclude-dir=node_modules --exclude-dir=vendor --exclude-dir=.git
```

The name may be quoted or bare, and the anchors keep it from matching a longer
name. Never treat a vendored or installed copy of this skill itself as the override; a
full copy holds no project deltas. Read the file found and apply its changes and
additions, with the project file winning on conflict. If that file is what invoked
this skill, its changes are already in context; do not re-read it, and do not
re-invoke anything it names.

If no override exists, run this skill as written.

## Step 1: Run and observe

1. Run the failing example on its own, by file and line.
2. If it is suspected flaky, run it twenty times and stop at the first failure.
3. If items 1 and 2 did not reproduce the failure, reproduce the run that reported it.
   Take the first of these that fits:
   - **The report gives a seed**, such as `Randomized with seed 12345`. Replay it with
     the same spec files the reported run loaded: no other run reproduces that order.
     RSpec sorts by a hash of the seed and each example's id, so the reported examples
     keep their relative order in any run with that seed, but a whole-suite replay of a
     CI shard's seed puts other examples between them, and one of those can mask the
     failure.
   - **The report gives no seed.** Run the whole suite once in the order the failure
     was reported in: whatever the CI command, `.rspec`, `.rspec-local`, or the spec
     helper's `config.order` sets, and declaration order, RSpec's own default, when
     none of them sets one. Escalate only when that run does not reproduce it, first to
     the other order, then to a parallel run.

   A test that passes alone and fails in the suite depends on something another example
   does, in whichever orders it fails. Failing in both orders does not rule order out:
   each run may have put that example first, so keep Order dependence on the list for
   Step 2.

   A failure item 1 reproduced, failing alone every time, gets one run of the whole
   suite in the configured order. One that passes there relies on state another
   example sets up, the fails-only-alone form of order dependence, and needs that setup
   of its own. One that fails there too needs no further runs. A failure that item 2
   reproduced only some of the time needs no suite run: it failed with no other example
   present, so its cause is in the example, and a seeded replay that happens to fail
   says nothing about order.
4. When a random-order run fails, record the seed RSpec prints and replay it. The
   seed is the only way to reproduce that order on purpose, and Step 5 needs it.

```bash
rerun() {  # rerun <count> <command>...: stop at the first failure and name the run
  n=$1; shift; i=1
  while [ "$i" -le "$n" ]; do
    "$@" || { echo "failed on run $i of $n" >&2; return 1; }
    i=$((i + 1))
  done
}

bundle exec rspec path/to/spec.rb:42           # item 1: the example alone
rerun 20 bundle exec rspec path/to/spec.rb:42  # item 2: suspected flaky
bundle exec rspec --seed 12345                 # items 3 and 4: a seed, and a shard's files
bundle exec rspec --order defined              # item 3 with no seed: the order it failed
bundle exec rspec --order rand                 #   in, whichever of these two that was
```

Each line after the function is one item of the list above; run the one the item
calls for, not the whole block. Run the function in the same command as a line that
calls `rerun`: a shell function does not survive between commands.

`rerun` returns non-zero naming the run that failed. Keep its output rather than
discarding it: the failing run's message and seed are in it, and a flaky test run
again to see them may not fail. A `for i in {1..20}` loop
reports neither: brace expansion is not POSIX, so a shell without it runs the body
once with the literal string, and `break` leaves the loop's status at zero after a
failure. Each iteration pays a fresh Ruby and Bundler boot, which on most suites
costs more than the example does; where a project has a gem that repeats an example
in one process, the override names it and that replaces `rerun` here.

The project override may replace the suite command and names the parallel one.

## Step 2: Find the root cause

1. Read the whole error and stack trace. Name the failing line and the expected and
   actual values before forming a theory.
2. Check what changed: `git log` and `git blame` on the spec, on the code it tests,
   and on each collaborator the spec stubs. A stub that describes a value the real
   collaborator no longer returns fails consistently while the spec itself looks
   untouched.
3. For a flaky or order-dependent test, read the [testing guide](../../docs/testing-guide.md#test-anti-patterns)
   and work through its entries in this order, which is cheapest to rule out first:
   Order dependence, then Mutating process or global state, then Non-determinism.
   The guide lists the sources under each; this skill does not repeat them, so a
   source added there is one the agent still finds.
4. For a failure that depends on where it runs, check platform paths and line
   endings, the version of any external tool the test drives, and the Ruby version.
   A failure that appears only in CI goes to the project's CI troubleshooting skill
   when the override names one. Without one, treat it as an environment failure:
   read the CI log's setup steps for the runner's platform, Ruby, external tool
   versions, and environment variables, diff them against the local ones, and report
   the difference under Step 3.

## Step 3: Report

```markdown
# Test failure: <example description>

Failure type: consistent | flaky | order-dependent | environment
Spec: <path>:<line>

## Error
<message and the relevant frames>

## Root cause
<what is wrong and the evidence>

## Recommended fix
<which row of Step 4 applies and what changes>
```

Stop here unless asked to fix. Never change an existing test without confirmation:
a test that fails may be right.

## Step 4: Choose the fix

| Cause | Fix | Commit type |
| --- | --- | --- |
| The code is wrong and the test caught it | Fix the code. The failing test is the red step. | `fix` |
| The behavior changed on purpose | Confirm first, then update the assertion. | `test` |
| The test is non-deterministic | Remove the source, per the guide's anti-pattern entry. Do not retry or sleep. | `test`, or `refactor` when a seam for the source, such as an injected clock, changes the code under test |
| The test depends on order or on state another example changed | Make the example that changes the state restore it, and the example that failed set up the state it reads rather than assume it. Inject the value a test reads from `ENV`, the working directory, or a global where a seam allows, per the guide's Order dependence and Mutating process or global state entries. | `test` |
| The environment is wrong | Fix the environment and document the requirement. | `docs` for the documented requirement, `ci` or `build` for a configuration change, none when nothing in the repository changed |

Every row names a cause of failure. A test that is hard to read is not one: fix the
cause first, and once the test is green, clean it up under the
[TDD refactor step](../tdd-refactor-step/SKILL.md), running that skill's Step 0
first; it changes no assertion.

Any change to a spec follows the
[RSpec base standards](../rspec-base-standards/SKILL.md) and then the standards for
its kind, the [unit](../rspec-unit-testing-standards/SKILL.md),
[integration](../rspec-integration-testing-standards/SKILL.md), or
[system](../rspec-system-testing-standards/SKILL.md) one. They differ on what a spec
may stub and require, so load the right one and run its Step 0 before editing. Bring
the lines the fix changes up to those standards; the rest of the example and its
neighbors are the refactor step's to clean. An integration spec's external process
runs on its own clock, which no stub reaches, so the determinism row there means
asserting nothing that clock decides rather than stubbing it.

A fix to a flaky test that adds a retry, a sleep, or a broader matcher to get past the
failure has not fixed it. The [Non-determinism](../../docs/testing-guide.md#test-anti-patterns)
entry names the alternative for each source. Narrowing an assertion is a different
fix when Step 2 showed that the part that varied was never the behavior under test,
such as an external tool's formatting or timing: asserting only what the test
controls is then what the integration standards ask for. It still changes an
existing test, so it needs confirmation like any other.

## Step 5: Verify the fix

1. Run the example.
2. For a non-determinism fix, run the example fifty times, or three times as many runs
   as it took to fail in Step 1, whichever is more. No failure in that many runs means,
   with about 95% confidence, that it now fails less often than Step 1 saw; fifty clean
   runs alone pass a test that fails one run in fifty about a third of the time.
3. For an order-dependence fix, replay the run that failed in Step 1: the example
   alone for one that failed only alone, which item 1 already did, otherwise defined
   order or the recorded seed. Then run the suite in random order ten times, or as
   many times as the project override sets. Short of a failure that showed only alone,
   one example run alone cannot show order dependence, whatever the ordering flag says.
   Ten runs of a suite that takes minutes can outlast a single command's timeout: run
   them in the background, or in batches across several commands.
4. Run the whole suite once more: in parallel where the project has a parallel
   command, serially where it does not. A serial-only project skips this after an
   order-dependence fix, since the random-order runs above already covered the suite.

```bash
rerun() {  # defined again: a shell function does not survive between commands
  n=$1; shift; i=1
  while [ "$i" -le "$n" ]; do
    "$@" || { echo "failed on run $i of $n" >&2; return 1; }
    i=$((i + 1))
  done
}

rerun 50 bundle exec rspec path/to/spec.rb:42  # item 2: or three times the runs to fail
bundle exec rspec --order defined              # item 3: or the seed with the run's files,
rerun 10 bundle exec rspec --order rand        #   whichever failed; then ten random runs
bundle exec rspec                              # item 4: or the project's parallel command
```

As in Step 1, run only the lines the fix's items call for, with the function in the
same command as a line that calls `rerun`.
