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
its shared contexts and helpers, where its fixtures live, and which skill handles
failures that appear only in CI. Check for one at each of these paths and use the
first that exists:

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
3. If it passed alone, or the failure was reported from a suite run, run the whole suite
   once in the order the failure was reported in. Read the project's `config.order` to
   know what that was: RSpec's own default is declaration order, and the RSpec spec
   standards expect a project to set random. Escalate only when that run does not
   reproduce it, first to the other order, then to a parallel run. A test that passes in
   one order and fails in the other depends on something another test does; one that
   passes alone and fails in both orders depends on the company, not the order. A
   failure that reproduces alone needs none of these runs.
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

bundle exec rspec path/to/spec.rb:42
rerun 20 bundle exec rspec path/to/spec.rb:42
bundle exec rspec --order defined
bundle exec rspec --order rand
bundle exec rspec --seed 12345
```

`rerun` returns non-zero naming the run that failed. A `for i in {1..20}` loop
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
3. For a flaky test, read the [testing guide](../../docs/testing-guide.md#test-anti-patterns)
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

Failure type: consistent | flaky | environment
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
| The test is non-deterministic | Remove the source, per the guide's anti-pattern entry. Do not retry or sleep. | `test` |
| The test depends on order or on state another example changed | Make each example own its state, and inject the value a test reads from `ENV`, the working directory, or a global, per the guide's Order dependence and Mutating process or global state entries. | `test` |
| The environment is wrong | Fix the environment and document the requirement. | none |

Every row names a cause of failure. A test that is hard to read is not one: fix the
cause first, and once the test is green, clean it up under the
[TDD Refactor Step](../tdd-refactor-step/SKILL.md), running that skill's Step 0
first; it changes no assertion.

Any change to a spec follows the
[RSpec base standards](../rspec-base-standards/SKILL.md) and then the standards for
its kind, the [unit](../rspec-unit-testing-standards/SKILL.md) or the
[integration](../rspec-integration-testing-standards/SKILL.md) one. Those two differ on
what a spec may stub and require, so load the right one and run its Step 0 before
editing. An integration spec's external process runs on its own clock, which no
stub reaches, so the determinism row there means asserting nothing that clock
decides rather than stubbing it.

A fix to a flaky test that adds a retry, a sleep, or a broader matcher has not fixed
it. The [Non-determinism](../../docs/testing-guide.md#test-anti-patterns) entry names
the alternative for each source.

## Step 5: Verify the fix

1. Run the example.
2. For a non-determinism fix, run the example fifty times.
3. For an order-dependence fix, replay the order that failed in Step 1, defined
   order or the recorded seed, then run the suite in random order ten times. One
   example run alone cannot show order dependence, whatever the ordering flag says.
4. Run the whole suite once more in parallel, where the project does. After an
   order-dependence fix the runs above already covered the serial suite.

```bash
rerun() {  # defined again: a shell function does not survive between commands
  n=$1; shift; i=1
  while [ "$i" -le "$n" ]; do
    "$@" || { echo "failed on run $i of $n" >&2; return 1; }
    i=$((i + 1))
  done
}

rerun 50 bundle exec rspec path/to/spec.rb:42
bundle exec rspec --order defined   # or --seed 12345, whichever order failed
rerun 10 bundle exec rspec --order rand
```
