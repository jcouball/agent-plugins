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

Commit the red and green steps before starting. The working tree's changes are then the
refactor step's alone: `git diff` shows them apart from the task's work, and
`git restore` undoes them without touching it. A project that wants one commit per task
squashes the refactor into the task's red and green commits afterwards.

Run [Rubocop](#rubocop) first, where the project runs it. Its auto-correct clears the
formatting offenses, and what it leaves uncorrected is one input to this decision. Skip
the step only when the code touched in this task has none of the
[code smells](#code-smells) at the thresholds the table gives, none of the
[test code](#test-code) smells, and no uncorrected rubocop offense on a line the task
changed. Otherwise apply the technique the table names for each smell present and run
rubocop again. The tables are the only list of smells and the only statement of the
thresholds: the Metrics cops name the same smells at their own defaults, most of them
looser, so a clean rubocop report does not settle a row the table would fail.

## Code smells

Check the code written or changed in this task, in this order. Broader cleanup is a
separate task. A technique that would change the name, parameters, or owning class of a
public method that existed before this task is noted for a later task instead, since
callers outside the task depend on it. A public method the task added has none yet, and
neither does a parameter the task added to an existing one, so the technique applies to
them.

| Smell | Threshold | Technique |
| --- | --- | --- |
| Hard-coded value from the green step | Any | Replace with the logic it stood in for, as far as the examples already written pin it; logic they do not pin needs another failing example first |
| Duplication in the task's code or with existing code in a file the task changed | Three or more similar lines | Extract a method or constant; duplication with a file outside the task is noted for a later task |
| Magic value | A literal whose meaning its value does not show, such as a rate or a limit | Introduce a constant |
| Long method | Body over ten lines | Extract a private helper |
| Long parameter list | Over three positional parameters | Keyword arguments for the trailing ones |
| Inconsistent naming | Differs from the file or module | Rename to match |
| Deep conditionals | Over two levels of conditionals or loops; a block passed to an iterator does not count, as in Metrics/BlockNesting | Guard clause or a helper |
| Complex method | Metrics/AbcSize, Metrics/CyclomaticComplexity, or Metrics/PerceivedComplexity reports it; checked only where rubocop runs | Extract private helpers until the offense clears |
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
and update the call sites in the same change. The [Code smells](#code-smells) rule on
public methods that existed before this task applies.

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

Test code gets the same attention. The smells come from the testing guide's [Test
smells](../../docs/testing-guide.md#test-smells), [Test
data](../../docs/testing-guide.md#test-data), and [Test
anti-patterns](../../docs/testing-guide.md#test-anti-patterns), and the result must follow
the standards for the kind of spec being refactored: a unit spec follows the
[RSpec base standards](../rspec-base-standards/SKILL.md) and the
[unit standards](../rspec-unit-testing-standards/SKILL.md) on top of them, and an
integration spec follows the shared standards and the
[integration standards](../rspec-integration-testing-standards/SKILL.md),
which replace the unit rules for it; a system spec follows the shared standards
and the [system standards](../rspec-system-testing-standards/SKILL.md). Load the
scope's skill and run its Step 0 before touching any spec, so the project's overrides
for that scope and for the base standards apply. For an integration or system spec it
also keeps the wrong rules out: the unit rules on requires, shared contexts, and
stubbing every collaborator do not apply there, and applying them would remove what the
spec exists to test.

| Smell | Technique |
| --- | --- |
| The same `let` in sibling contexts | Move it to the nearest shared group; it is lazy, so an example that does not name it never builds it |
| The same `before` or `let!` in sibling contexts | Move it to the nearest group whose examples all need it, wrapping the siblings in a context of their own if no such group exists; it runs for every example below it, so a broader group makes it the hidden fixture the standards forbid |
| An example body heavy with setup | Move it out, values and side effects each to the construct the standards give them |
| The same literal in three or more examples, standing for the same thing | One `let`, named for its role |
| Identical examples in three or more spec files | A `shared_examples` group in a support file the spec helper already loads, so no spec gains a require, when every one of the files is part of this task; where a file is outside the task or the helper loads no support files, note it for a later task |
| A description that does not match the assertion | Rewrite it to state the behavior |

Refactoring a test never changes what it asserts. If an assertion needs to change,
that is a red step, not a refactor.

## Rubocop

A project runs rubocop when its Gemfile or gemspec lists it or it has a `.rubocop.yml`;
a rubocop installed elsewhere on the machine does not count. A project that does not
run it skips this section, and the skip decision and
Verification step 2 read only the two smell tables, less the Complex method row, which
has no threshold without rubocop's report. Long method and Deep conditionals still
cover most of what it would catch.

Run it on the changed files before deciding whether to refactor, and again after
refactoring; auto-correct only safe offenses. Metrics offenses want a structural
change, not a formatting one, and are what the
[Refactor or skip](#refactor-or-skip) decision reads.

```bash
(
  cd "$(git rev-parse --show-toplevel)" || exit 1
  files=$(git rev-parse --git-dir)/refactor-files
  rm -f "$files" "$files.base"  # nothing an earlier task left may survive a failed run
  base=                     # the commit before the task's first commit
  [ -n "$base" ] || { echo 'set base first' >&2; exit 1; }
  base=$(git rev-parse --verify --quiet "$base^{commit}") || exit 1
  git diff --name-only -z --diff-filter=d --ignore-submodules "$base" > "$files"
  [ -s "$files" ] || { echo 'no file changed since base; check base' >&2; exit 1; }
  targets=$(xargs -0r bundle exec rubocop -L --force-exclusion \
    --only-recognized-file-types -- < "$files") || { rm -f "$files"; exit 1; }
  [ -n "$targets" ] || { rm -f "$files"; echo 'no file rubocop inspects; check base' >&2; exit 1; }
  printf '%s\n' "$base" > "$files.base"
  printf '%s\n' "$targets"
)
```

Read that list before running the next line: it is what `rubocop -a` rewrites.

```bash
(
  cd "$(git rev-parse --show-toplevel)" || exit 1
  files=$(git rev-parse --git-dir)/refactor-files
  [ -s "$files" ] && [ -s "$files.base" ] || { echo 'run the first block first' >&2; exit 1; }
  git diff --name-only -z --diff-filter=d --ignore-submodules "$(cat "$files.base")" |
    cmp -s - "$files" || {
    rm -f "$files" "$files.base"; echo 'the list is stale; run the first block again' >&2; exit 1
  }
  xargs -0r bundle exec rubocop -a --force-exclusion --only-recognized-file-types -- < "$files"
  rc=$?
  rm -f "$files" "$files.base"
  exit "$rc"
)
```

The `cd` matters: `git diff` prints paths relative to the repository root, so run from
anywhere else rubocop cannot find them.

`base` is the commit before the task's first commit, so the list holds the task's files
and not the branch's, which Boundaries requires; the merge base with the default branch
serves only when the branch carries one task. It is left empty on purpose, because a
`base` that is stale rather than wrong fails silently: set to `HEAD` after the green
commit, `git diff` finds nothing, and a script that ran anyway would report the task
clean without having read it. So an empty list stops the script rather than skipping
rubocop.

The `git diff` compares the working tree with `base`, so it lists every file the task
changed, and on a second pass the refactor's edits as well. `--diff-filter=d` drops a
file the working tree no longer has even when a commit added it, and
`--ignore-submodules` drops a submodule, which rubocop would otherwise recurse into as a
directory. An untracked file is not part of the task once its red and green steps are
committed, so the list leaves it out; a file the refactor creates joins the list once
`git add -N` marks it.

The list holds every changed file and rubocop picks its own targets from it, since rubocop
otherwise inspects every file named on the command line. `--only-recognized-file-types`
keeps the files rubocop treats as Ruby: by extension, by name such as `Rakefile` or
`Gemfile`, by a Ruby shebang, or through the project's `AllCops/Include`. A pathspec such
as `'*.rb'` would miss the rest, and a task that touched only a `.rake` or `.gemspec` file
would skip the lint pass. `--force-exclusion` keeps the project's `.rubocop.yml`
exclusions in force, so a vendored or generated file the task touched is not
auto-corrected. The first block prints what `rubocop -L` lists under the same flags,
which is exactly the set the second block corrects.

`-z` on `git diff` and `-0` on xargs carry the list NUL-separated, so a path with
a space, a newline, or a non-ASCII character reaches rubocop intact; without `-z`, git
quotes and escapes such a path into a string rubocop cannot find. The `--` ends
rubocop's options before xargs appends the paths, since a root-level file named
`-dash.rb` would otherwise parse as `-d -a -s h.rb`.

Each block runs in a subshell, so an `exit` guard stops the block without closing the
shell that runs it. The second keeps rubocop's exit status across the cleanup, so it
exits non-zero when rubocop errors or leaves an offense uncorrected. It holds the
status in `rc` because zsh, which runs the blocks in many agent shells, makes `status`
a read-only variable, and assigning to it would stop the block before the cleanup.
The blocks use no other name a POSIX shell, bash, or zsh reserves. The two blocks are
separate shell invocations, so the list passes between them through a file, which a
shell variable could not hold anyway because of the NUL bytes. That file is removed
before the first block does anything and again once rubocop has read it, and the second
block stops when it is missing. Otherwise a first block that exited on a guard would
leave the previous task's list in place for the second to auto-correct, which is the
wrong-scope rewrite the guards exist to prevent. A list the first block finished but
nothing consumed is caught another way: the first block saves the resolved `base` beside
the list, and the second recomputes the diff from it and stops unless it matches the
list byte for byte. A branch switched, a task started, or a file changed since the
preview all make the two differ. The files sit in the directory
`git rev-parse --git-dir` resolves, which is a real directory both in a plain clone and
in a linked worktree, where `.git` itself is a file.

One auto-correcting pass is enough, however many invocations xargs splits it into: its
report marks each offense it corrected and leaves the rest unmarked, and those are what
the skip decision and Verification step 2 read. A separate plain run would report
offenses the auto-correct then removes.

Both blocks guard on the list being non-empty, and each xargs carries `-r` as well,
because GNU xargs, which is what a Linux runner has, runs its command once even on empty
input, and rubocop given no files runs on the whole project, where `-a` rewrites files
outside the task. BSD xargs, macOS's included, already skips empty input and accepts `-r`
for compatibility with GNU.

## Verification

Whether the step was skipped or not, since rubocop's auto-correct, where the project
runs it, rewrote files either way:

1. The task's tests still pass.
2. Rubocop, run again after any refactor, reports no uncorrected offense on a line
   the task changed. An offense on a line the task did not touch was there before
   the task; leave it and note it for a later task.
3. `git diff`, which holds rubocop's edits and the refactor's apart from the committed
   task work, has no auto-correct hunk outside the lines the task changed. Auto-correct
   works on whole files, so a file the task barely touched can come back reformatted
   throughout. Revert that churn, or commit it on its own so the task's own commit
   stays reviewable. The refactor's own edits are the step's work, including existing
   code a duplication fix extracts from.
4. No assertion was added, removed, or changed. A refactor that needs a new
   assertion skipped a red step.

Passing tests show only what the examples pin. Swapping one idiom for another, such as
`Array#sum` for a loop of `+`, can change results they do not cover: float rounding,
`nil` handling, ordering. Check those by reading the two forms side by side, or by
comparing them over many inputs.

If a test fails after a refactor, the refactor changed behavior. Revert it and make
a smaller change. If it fails after a skipped step, the auto-correct changed
behavior: `git restore` that file, which returns it to the committed task work, and
report the cop as unsafe.

## Boundaries

The refactor step does not:

- Add behavior, including new test cases.
- Change the name, parameters, or owning class of a public method that existed
  before this task, other than a parameter the task added.
- Touch files outside this task; note wider cleanup for a later task.
- Optimize without profiling data.
- Introduce a class, module, or other abstraction for something used once. A
  private helper extracted from a long method is not one, and neither is a method
  moved onto the object whose data it uses.
