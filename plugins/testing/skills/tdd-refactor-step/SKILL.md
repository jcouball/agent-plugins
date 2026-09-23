---
name: tdd-refactor-step
description: 'Guides the refactor step of red-green-refactor: deciding whether to refactor, the code smells to look for with thresholds, the technique for each, cleaning the test code, running rubocop, and verifying nothing changed. Use after a test goes green, when asked what to refactor, or when reviewing the refactor step of a TDD cycle. If the current project has its own tdd-refactor-step skill, that file holds project-specific changes and additions: still apply this skill, and apply those changes on top (Step 0).'
---

# TDD refactor step

The refactor step of red-green-refactor, after every test passes. Decide whether to
refactor, find the smells, apply the smallest technique that removes each, clean the
tests, and prove nothing changed.

## Contents

- [Step 0: Apply project overrides](#step-0-apply-project-overrides)
- [Refactor or skip](#refactor-or-skip)
- [Code smells](#code-smells)
- [Techniques](#techniques)
- [Test code](#test-code)
- [Rubocop](#rubocop)
- [Verification](#verification)
- [Boundaries](#boundaries)

## Step 0: Apply project overrides

A project may carry its own thin copy of this skill holding only its local changes
and additions: architectural patterns the refactor step enforces, such as where
parsing may live or how error classes are organized, its rubocop configuration, and
its own thresholds. Check for one at each of these paths and use the first that
exists:

- `.claude/skills/tdd-refactor-step/SKILL.md`
- `.github/skills/tdd-refactor-step/SKILL.md`

If neither exists, fall back to searching wherever the project keeps agent skills
for a `SKILL.md` whose frontmatter `name` is `tdd-refactor-step`:

```bash
grep -rlE --include=SKILL.md "^name: *['\"]?tdd-refactor-step['\"]? *$" . \
  --exclude-dir=node_modules --exclude-dir=vendor --exclude-dir=.git
```

The name may be quoted or bare, and the anchors keep it from matching a longer
name. Never treat a vendored or installed copy of this skill itself as the override; a
full copy holds no project deltas. Read the file found and apply its changes and
additions, with the project file winning on conflict. If that file is what invoked
this skill, its changes are already in context; do not re-read it, and do not
re-invoke anything it names.

If no override exists, run this skill as written.

## Refactor or skip

Run [Rubocop](#rubocop) first. Its auto-correct clears the formatting offenses, and what
it leaves uncorrected is one input to this decision. Skip the step only when the code
touched in this task has none of the [code smells](#code-smells) at the thresholds the
table gives, none of the [test code](#test-code) smells, and no uncorrected rubocop
offense on a line the task changed. Otherwise apply the technique the table names for
each smell present and run rubocop again. The tables are the only list of smells and the
only statement of the thresholds: the Metrics cops name the same smells at their own,
looser defaults, so a clean rubocop report does not settle a row the table would fail.

## Code smells

Check the code written or changed in this task, in this order. Broader cleanup is a
separate task.

| Smell | Threshold | Technique |
| --- | --- | --- |
| Hard-coded value from the green step | Any | Replace with the logic it stood in for |
| Duplication with existing code | Three or more similar lines | Extract a method or constant |
| Long method | Body over ten lines | Extract a private helper |
| Long parameter list | Over three positional parameters | Keyword arguments for the trailing ones; on a public method, note it for a later task |
| Inconsistent naming | Differs from the file or module | Rename to match |
| Deep conditionals | Over two levels | Guard clause or a helper |
| Complex method | Metrics/AbcSize or either complexity cop reports it | Extract private helpers until the offense clears |
| Feature envy | Uses another object's data more than its own | Move the method or extract a delegator |
| Dead code | Unreachable branch or unused variable | Remove |

## Techniques

Apply the simplest one that removes the smell.

**Extract method.** Split a long method into the public method and private helpers
named for what they do, not how.

```ruby
def call(order)
  charge(order, amount_due(order))
end

private

def amount_due(order)
  order.lines.sum(&:total) - order.discount
end
```

**Keyword arguments.** When optional trailing positionals accumulate, convert them
and update the call sites in the same change. Only on a method that is not
public: a public method's signature is a boundary this step does not cross, so
note the smell for a later task instead.

```ruby
private

def format_line(item, currency: 'USD', tax: 0.0)
```

**Guard clause.** Replace nested conditions with early returns.

```ruby
def validate(value)
  return unless value.is_a?(String)
  return if value.empty?

  process(value)
end
```

**Introduce constant.** Name a magic value and freeze it.

```ruby
MINIMUM_VERSION = Gem::Version.new('2.43.0').freeze
```

**Shared setup.** When two methods share a preamble or teardown, extract it. In
tests, see the next section instead.

## Test code

Test code gets the same attention. The smells and their fixes come from the
[testing guide](../../docs/testing-guide.md#test-smells), and the result must follow
the standards for the kind of spec being refactored: a unit spec follows the
[RSpec base standards](../rspec-base-standards/SKILL.md) and the
[unit standards](../rspec-unit-testing-standards/SKILL.md) on top of them, and an
integration spec follows the shared standards and the
[integration standards](../rspec-integration-testing-standards/SKILL.md),
which overrides several unit rules for it. Load that skill and run its Step 0 before
touching an integration spec: the unit rules on requires, shared contexts, and
stubbing every collaborator are the ones it overrides, and applying them would
remove the seam the spec exists to test.

| Smell | Technique |
| --- | --- |
| The same `let` or `before` in sibling contexts | Move it to the nearest shared group |
| An example body heavy with setup | Move it out, values and side effects each to the construct the standards give them |
| A literal repeated across examples | One `let`, named for its role |
| Identical examples across files | A `shared_examples` group the spec helper loads, so no spec gains a require, at the threshold the standards set for sharing |
| A description that does not match the assertion | Rewrite it to state the behavior |

Refactoring a test never changes what it asserts. If an assertion needs to change,
that is a red step, not a refactor.

## Rubocop

Run it on the changed files before deciding whether to refactor, and again after
refactoring; auto-correct only safe offenses. Metrics offenses want a structural
change, not a formatting one, and are what the
[Refactor or skip](#refactor-or-skip) decision reads.

```bash
cd "$(git rev-parse --show-toplevel)" || exit 1
files=$(git rev-parse --git-dir)/refactor-files
rm -f "$files"            # a list left by an earlier task must not survive a failed run
base=                     # the commit the task started from
[ -n "$base" ] || { echo 'set base first' >&2; exit 1; }
git rev-parse --verify --quiet "$base^{commit}" > /dev/null || exit 1
{
  git diff --name-only -z --diff-filter=d "$base" -- '*.rb'
  git ls-files --others --exclude-standard -z -- '*.rb'
} > "$files"
[ -s "$files" ] || { echo 'no Ruby file for this task; check base' >&2; exit 1; }
tr '\0' '\n' < "$files"
```

Read that list before running the next line: it is what `rubocop -a` rewrites.

```bash
cd "$(git rev-parse --show-toplevel)" || exit 1
files=$(git rev-parse --git-dir)/refactor-files
[ -s "$files" ] || { echo 'run the first block first' >&2; exit 1; }
xargs -0r bundle exec rubocop -a --force-exclusion < "$files"; rm -f "$files"
```

The `cd` matters: `git diff` prints paths relative to the repository root and
`git ls-files` prints them relative to the current directory, so run from
anywhere else the two lists disagree and rubocop cannot find half the files.
`base` is the commit the task started from, so the list holds the task's files
and not the branch's, which Boundaries requires: `HEAD` while the task's red and
green steps are uncommitted, the commit before the task's first commit once they
are, and the merge base with the default branch only when the branch carries one
task. It is left empty on purpose, because a `base` that is stale rather than
wrong fails silently: with the green step committed and `base` still `HEAD`,
`git diff` finds nothing, and a script that ran anyway would auto-correct the
untracked files alone and report the task clean without having read it. So an
empty list stops the script rather than skipping rubocop. The `git diff`
compares the working tree with `base`, so it lists every Ruby file the task has
changed, committed or not, and `--diff-filter=d` drops a file the working tree
no longer has even when a commit added it. `git ls-files` adds the files created
and not yet added, which is where a file the green step wrote usually sits.
Nothing dates an untracked file, so that half is the one part the script cannot
scope to the task: read the printed list, and stash or delete anything left over
from earlier work before running the second command. `--force-exclusion` keeps
the project's `.rubocop.yml` exclusions in force; rubocop otherwise inspects
every file named on the command line, so a vendored or generated file the task
touched would be auto-corrected. `-z` on both git commands and `-0` on xargs
carry the list NUL-separated, so a path with a space, a newline, or a non-ASCII
character reaches rubocop intact; without `-z`, git quotes and escapes such a
path into a string rubocop cannot find. The two blocks are separate shell
invocations, so the list passes between them through a file, which a shell
variable could not hold anyway because of the NUL bytes. That file is removed
before the first block does anything and again once rubocop has read it, and the
second block stops when it is missing. Otherwise a first block that exited on a
guard would leave the previous task's list in place for the second to
auto-correct, which is the wrong-scope rewrite the guards exist to prevent. The
file sits in the directory `git rev-parse --git-dir` resolves, which is a real
directory both in a plain clone and in a linked worktree, where `.git` itself is
a file. One auto-correcting pass is enough, however many invocations xargs
splits it into: its report marks each offense it corrected and leaves the rest
unmarked, and those are what the skip decision and Verification step 2 read. A
separate plain run would report offenses the auto-correct then removes. Both
blocks guard on the list being non-empty, and xargs carries `-r` as well,
because GNU xargs, which is what a Linux runner has, runs its command once even
on empty input, and rubocop given no files runs on the whole project, where `-a`
rewrites files outside the task.

## Verification

Whether the step was skipped or not, since rubocop's auto-correct rewrote files
either way:

1. The task's tests still pass.
2. Rubocop, run again after any refactor, reports no uncorrected offense on a line
   the task changed. An offense on a line the task did not touch was there before
   the task; leave it and note it for a later task.
3. `git diff` on each file rubocop corrected holds no hunk outside the lines the
   task changed. Auto-correct works on whole files, so a file the task barely
   touched can come back reformatted throughout. Revert that churn, or commit it on
   its own so the task's own commit stays reviewable.
4. No assertion was added, removed, or changed. A refactor that needs a new
   assertion skipped a red step.

If a test fails after a refactor, the refactor changed behavior. Revert it and make
a smaller change. If it fails after a skipped step, the auto-correct changed
behavior: revert that file and report the cop as unsafe.

## Boundaries

The refactor step does not:

- Add behavior, including new test cases.
- Change a public method signature.
- Touch files outside this task; note wider cleanup for a later task.
- Optimize without profiling data.
- Abstract something used once.
