---
name: rspec-integration-testing-standards
description: 'Rules for RSpec integration specs: when a seam earns one, one spec per class or module, what to assert against a real dependency and what not to, owning temporary state and the environment, subprocesses without a shell, and portability. Use when writing, reviewing, or auditing RSpec integration specs, deciding whether a behavior needs an integration test or a unit test, or asserting on the output of a real external process. If the current project has its own rspec-integration-testing-standards skill, that file holds project-specific changes and additions: still apply this skill, and apply those changes on top (Step 0).'
---

# RSpec integration testing standards

Rules for writing and reviewing RSpec integration specs: tests that run several real
components together down to a real external process, service, or filesystem, short of
the whole system. Load the [RSpec base standards](../rspec-base-standards/SKILL.md)
first and apply it in full; every convention there holds at this scope. Each rule below
is one sentence with a priority word, an example where one helps, and, where the guide
reasons about it, a link to the paragraph of the
[testing guide](../../docs/testing-guide.md) it derives from.

**MUST** is mandatory; do not violate it without a documented exception. **SHOULD**
is the default; override it when a clearer test requires it, and say so in a comment.

The [unit standards](../rspec-unit-testing-standards/SKILL.md) do not apply here. They
hold the seven rules a spec has because it is a unit spec, and each is replaced at this
scope; this list is what replaces them, named by subject so a renumbering there cannot
repoint it:

- The constructor's group and its `have_attributes` example do not apply to a
  constructor that only stores its arguments, since it reaches no dependency. One that
  opens a handle or starts the process is a seam like any other and gets its group.
- Requires widen: the spec may require the helpers and shared contexts that build its
  temporary state, as well as the spec helper and the file under test.
- Shared setup is permitted: a shared context that builds temporary state is what an
  integration spec is for, and Rule 8 below says what that state must be.
- Stubbing collaborators is inverted. The classes in the path and the dependency at
  its end are real; a double sits only at the outermost edge, cutting off a part of
  the system the seam under test does not reach.
- The coverage gate is replaced by Rule 7 below.
- Determinism changes shape: the external process runs on its own clock with its own
  randomness, which no stub reaches. The spec asserts nothing those decide, per Rule 5
  below, and pins what the process would otherwise take from the machine, per Rule 11
  below. Time and randomness inside the process are still stubbed or injected.
- Global state is restated as Rule 10 below.

This skill states only what differs at integration scope.

## Contents

- [Step 0: Apply project overrides](#step-0-apply-project-overrides)
- [Checklist](#checklist)
- [Scope](#scope)
- [Assertions](#assertions)
- [State and environment](#state-and-environment)
- [What the tools check](#what-the-tools-check)
- [Verification](#verification)
- [Output](#output)

## Step 0: Apply project overrides

A project may carry its own thin copy of this skill holding only its local changes and
additions: where its integration specs live, the helpers and shared contexts that build
its temporary state, how it starts the external process, how coverage is configured and
whether integration specs count toward the gate, where the minimum dependency version is
recorded and how its version-guard helper is defined, and its own conventions for
particular class families. Check for one at each of these paths and use the first that
exists:

- `.claude/skills/rspec-integration-testing-standards/SKILL.md`
- `.github/skills/rspec-integration-testing-standards/SKILL.md`

If neither exists, fall back to searching wherever the project keeps agent skills
for a `SKILL.md` whose frontmatter `name` is `rspec-integration-testing-standards`:

```bash
grep -rlE --include=SKILL.md "^name: *['\"]?rspec-integration-testing-standards['\"]? *$" . \
  --exclude-dir=node_modules --exclude-dir=vendor --exclude-dir=.git
```

The name may be quoted or bare, and the anchors keep it from matching a longer
name. Never treat a vendored or installed copy of this skill itself as the override; a
full copy holds no project deltas. Read the file found and apply its changes and
additions, with the project file winning on conflict. If that file is what invoked
this skill, its changes are already in context; do not re-read it, and do not
re-invoke anything it names.

If no override exists, run this skill as written. Apply the project's
`rspec-base-standards` override too, if it has one, found the same way; its deltas
govern every convention this skill builds on.

## Checklist

In order, for each spec written or reviewed:

1. Name the seam this test checks that no unit test can (Rule 1).
2. One spec file per class or module; group by public method (Rule 2).
3. One example per shape the real dependency returns, plus at least one failure
   (Rules 3, 4).
4. Assert on structure and on values the test controls, never on the dependency's
   formatting (Rules 5, 6).
5. No conditional path that a unit spec already covers (Rule 7).
6. All state in a temporary place the example creates and removes (Rule 8).
7. No shell, no `cwd` or `ENV` changes, no platform-only paths (Rules 9 to 11).
8. An example that needs a newer dependency than the project's minimum skips with
   a reason (Rule 12).
9. Every shared convention holds too. Run the
   [shared checklist](../rspec-base-standards/SKILL.md#checklist).

## Scope

### Rule 1 (MUST): An integration spec exists for a seam that unit specs cannot reach

A seam is a boundary the unit specs double: argument order between layers, a return
shape one layer produces and the next reads, an encoding or path assumption, or a
belief a stub encodes about what the real dependency returns. Name the seam in the
example's description. A behavior that is pure Ruby with no dependency in the path is
unit work and does not get an integration spec. Guide:
[Integration tests](../../docs/testing-guide.md#integration-tests), when to choose
it.

### Rule 2 (MUST): One spec file per class or module, grouped by public method

The path an example runs crosses several real classes on its way to the dependency;
the file belongs to the class whose public method the example calls, and it does not
also exercise the lower classes through their own interfaces. A spec that drives the
whole application, or a workflow a user performs rather than a method the code
exposes, is a system test and does not live here. Under each method, group by
outcome: a `context` for success and a `context` for failure. Guide:
[Integration tests](../../docs/testing-guide.md#integration-tests), definition.

### Rule 3 (MUST): One example per return shape of the real dependency

Each stub in the unit specs encodes a belief about what the dependency returns. One
integration example per distinct shape confirms it: the success shape, each
non-default exit status or status class the code handles, empty output where the
code treats it specially. Not one per input value. Guide:
[Integration tests](../../docs/testing-guide.md#integration-tests), also to confirm
what a unit test's stubs assume.

### Rule 4 (MUST): At least one example drives the dependency to fail

```ruby
context 'when the source file does not exist' do
  it 'raises with the missing path in the message' do
    expect { converter.convert('no-such-file.md') }
      .to raise_error(Converter::CommandFailed, /no-such-file\.md/)
  end
end
```

The failure path is where error wrapping meets the real error, and it is the path a
stub is most likely to get wrong. Guide:
[Integration tests](../../docs/testing-guide.md#integration-tests), what it proves.

## Assertions

### Rule 5 (MUST): Assert on the structure of the return value and on values the test controls

The class, the presence and type of fields, the count of entries, and the paths,
names, and contents the example itself created. Guide:
[Integration tests](../../docs/testing-guide.md#integration-tests), what it proves.

### Rule 6 (MUST): Do not assert on the dependency's formatting

```ruby
# Asserts what the test controls
expect(result.warnings.map(&:path)).to include('report.md')

# Tests the tool, not the code
expect(result.raw_output).to match(/^report\.md:3: warning: /)
```

Line layout, message phrasing, status letters, header syntax, and anything else that
varies by version of the external tool belongs to that tool's tests. If a flag has to be
shown to reach the tool, a unit spec asserts on the arguments. An error assertion still
names the class and a message pattern, as the shared standards require: anchor the
pattern on something the example controls, such as the input value or the subcommand
name, and never drop the pattern because the tool's wording may change. Guide: [Testing
the framework or a library](../../docs/testing-guide.md#test-anti-patterns) and
[Sensitive Equality](../../docs/testing-guide.md#test-smells).

### Rule 7 (MUST): Do not cover a conditional path a unit spec covers

An integration example that exercises a branch of the code's own logic, rather than a
shape the real dependency returns, is a missing unit spec; the integration suite does
not repeat option-by-option cases. Whether it counts toward the coverage gate is the
project's configuration, which its override records. Guide: [Integration
tests](../../docs/testing-guide.md#integration-tests), anti-patterns.

## State and environment

### Rule 8 (MUST): Every example owns the state it uses

Build it inside the example or its `let` and `before`, in a temporary directory the
example creates. Create that directory with `Dir.mktmpdir` and a block, in an `around`
hook that runs the example inside it, so it goes away even when an assertion fails; a
`let` calling `Dir.mktmpdir` without a block has no teardown at all. No example reads
state it did not create, and none writes where another reads. Fixed fixture files are
for inputs whose exact shape is the point. Guide: [Integration
tests](../../docs/testing-guide.md#integration-tests), real and doubled, and [Test
data](../../docs/testing-guide.md#test-data).

### Rule 9 (MUST): Start the external process as the code does, never through a shell

No backticks, `system`, `%x[]`, `spawn`, `exec`, `fork`, `Process.daemon`, `popen` on
`IO` or `File`, `PTY.getpty`, `Open3`, Bundler's `unbundled_system` family, or `open`
with a leading `|` in a spec, including setup: nothing that starts a process outside the
library. Use the library's own execution path so the spec proves the real one and does
not depend on shell quoting or on `PATH`. For files and directories, use the standard
library. Guide: [Integration tests](../../docs/testing-guide.md#integration-tests), real
and doubled.

### Rule 10 (MUST): Do not change the working directory or the environment

Pass the directory and any variables to the process explicitly. `cwd` and `ENV` are
process-wide: a change in one example is visible, while it lasts, to every thread in the
process, including threads the library or an earlier example started, so restoring it
afterwards does not make it safe. One exception: when the code under test exists to read
the current directory or the environment and has no seam, change it inside an `around`
hook that restores it even on failure, comment why, and add the seam as the follow-up.
Guide: [Mutating process or global
state](../../docs/testing-guide.md#test-anti-patterns).

### Rule 11 (MUST): The spec passes on every platform the code supports

No `/dev/null`, `/tmp`, or hard-coded separators; build paths with the standard
library and compare line endings after normalizing. Pin any default the external tool
takes from the machine, such as a default branch name, so the example does not depend
on the runner's configuration. Guide:
[Integration tests](../../docs/testing-guide.md#integration-tests), real and
doubled, and [Non-determinism](../../docs/testing-guide.md#test-anti-patterns).

### Rule 12 (SHOULD): Guard examples that need a newer dependency than the minimum

Skip with a reason naming the version and the feature, on the `it` when only some
examples need it and on the group when all do. The minimum is the oldest version the
code declares it supports, and the example is written and listed whatever version runs,
so what the suite covers is decided by that minimum and not by the machine. The project
override says where the minimum is recorded and how its version helper is defined, which
decides the form: a helper that reads a `let` has to be called as `skip` inside the
example, because `skip:` metadata is evaluated in the group body where no `let` exists
yet; one defined at module level works in either form. Guide: [Integration
tests](../../docs/testing-guide.md#integration-tests), real and doubled.

## What the tools check

Rules 8 and 10 are partly mechanical: a suite that runs in random order and in parallel
surfaces shared or mutated state as failures. Rule 9 has no cop; grep the integration
spec root for the calls Rule 9 lists, with or without parentheses. The roots are
`spec/integration` and the shared helpers and contexts, usually `spec/support`, since
Rule 9 covers a spec's setup and that is where an integration spec's setup lives;
substitute whatever paths the project override names.

```bash
grep -rnE --include='*.rb' '`|%x|(^|[^[:alnum:]])(system|spawn|exec|fork|daemon|popen|getpty)\b|Open3|open\(? *.\|' spec/integration spec/support
```

Rule 9 owns the list of calls and the pattern encodes it, so adding a call means editing
those two and not a third copy here. The leading character class admits an underscore
before the word, which a word boundary would not, so Bundler's `unbundled_system` family
matches. `Kernel#open` with a leading `|` runs a command on every Ruby before 4.0,
which removed it after a deprecation in 3.3, so the pattern keeps it. Read the
hits: the word inside a description string is not a call. A gem that wraps these, such
as `TTY::Command` or `Open4`, matches nothing here; read the spec's requires for one.

The coverage report shows one half of Rule 7, a branch only an integration spec reaches,
but only where the project excludes integration specs from coverage. Under one combined
run that branch reads as covered and the report says nothing. The other half, an
integration file that repeats cases the unit specs cover, leaves no trace in any report.
For each `context` in the integration file, ask what differs at the dependency. A
distinct shape the real dependency returns is a Rule 3 example and stays, even when a
unit context stubs the same condition, because confirming that stub is its purpose. A
branch of the code's own logic, reached with a shape another example already confirms,
is Rule 7's duplication and goes. The project override says which of these run in the
project.

## Verification

After writing or changing a spec:

1. Run the spec file, with `TMPDIR` pointed at a directory made for the run so the
   leak check in step 3 sees only what this run created.
2. Run it in parallel with the rest of the suite if the project supports that. That
   run, not a re-run of the file, is what surfaces the cross-example state Rules 8
   and 10 exist for; re-running one file only reshuffles its own examples.
3. Confirm the run left nothing in that directory.
4. Scan the spec against every MUST rule, this skill's and the shared ones, and fix
   what fails.

```bash
run_tmp=$(mktemp -d)
TMPDIR="$run_tmp" bundle exec rspec path/to/integration_spec.rb
ls -A "$run_tmp"    # anything listed is a directory an example did not remove
rm -rf "$run_tmp"
```

## Output

When writing, produce the spec and run the verification above. When reviewing or
auditing, produce a table with one row per rule, marked Pass, Fail, or N/A with the
issue, then the MUST violations to fix, then the SHOULD deviations ordered by
impact. The table covers the shared rules as well as this skill's twelve; a
twelve-row table has audited a fraction of what applies.
