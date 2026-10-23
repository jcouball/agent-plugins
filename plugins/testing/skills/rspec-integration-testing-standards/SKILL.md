---
name: rspec-integration-testing-standards
description: 'Rules for RSpec integration specs, on top of the rspec-base-standards skill it loads first: when a seam earns one, one spec per class or module, what to assert against a real dependency and what not to, owning temporary state and the environment, subprocesses without a shell, portability, and Rails model, request, and generator specs covering framework-bound code. Use when writing, reviewing, or auditing RSpec integration specs, deciding whether a behavior needs an integration test or a unit test, or asserting on the output of a real external process. If the current project has its own rspec-integration-testing-standards skill, that file holds project-specific changes and additions: still apply this skill, and apply those changes on top (Step 0).'
---

# RSpec integration testing standards

An integration spec proves that the layers in a path agree with each other and with
the real dependency at the end. It does not prove each layer's conditional paths;
unit specs prove those, except in framework-bound code, which only an integration
spec can reach (Rule 13). Guide:
[Integration tests](../../docs/testing-guide.md#integration-tests).

Rules for writing and reviewing RSpec integration specs: tests that run several real
components together down to a real external process, service, or filesystem, short of
the whole system. Integration specs live under `spec/integration`, or in a Rails app
in the spec type directories at integration scope, such as `spec/models` and
`spec/requests`; a project override may name other roots. Load the
[RSpec base standards](../rspec-base-standards/SKILL.md)
first and apply it in full; every convention there holds at this scope. Each rule below
is one sentence with a priority word, an example where one helps, and, where the guide
reasons about it, a link to the paragraph of the
[testing guide](../../docs/testing-guide.md) it derives from.

**MUST** is mandatory; do not violate it without a documented exception. **SHOULD**
is the default; override it when a clearer test requires it, and say so in a comment.

The [unit standards](../rspec-unit-testing-standards/SKILL.md) do not apply here. They
hold the rules a spec has because it is a unit spec, and this list says what becomes
of each at this scope, named by subject so a renumbering there cannot repoint it:

- The constructor's group and its `have_attributes` example do not apply to a
  constructor that only stores its arguments, since it reaches no dependency. One that
  opens a handle or starts the process is a seam like any other and gets its group.
- Requires widen: the spec may require the helpers and shared contexts that build its
  temporary state, as well as the spec helper and the file under test.
- Shared setup is permitted: a shared context that builds temporary state is what an
  integration spec is for; Rule 8 below says what that state must be, and the shared
  rule on shared contexts says what the context itself may hold.
- Stubbing collaborators is inverted. The classes in the path and the dependency at
  its end are real; a double sits only at the outermost edge, cutting off a part of
  the system the seam under test does not reach.
- The coverage gate is replaced by Rule 7 below, except for framework-bound code,
  which Rule 13 puts in the coverage run.
- Determinism changes shape: the external process runs on its own clock with its own
  randomness, which no stub reaches. The spec asserts nothing those decide, per Rule 5
  below, and pins what the process would otherwise take from the machine, per Rule 11
  below. Time and randomness inside the process are still stubbed or injected. The
  example never calls `sleep`; only the subject may, as a fixture process that must
  outlive a timeout under test. To wait for the process, wait on it: `Process.wait`,
  or read its output to end of file. To order two events in the same process, use a
  barrier such as a `Queue`. To make two results differ in time, pass the time to the
  dependency the way it accepts it, as git takes `--date` or a committer date in the
  environment handed to that one command, never through `ENV`, which Rule 10 forbids.
- Global state is restated as Rule 10 below.
- Mixins and module functions need no rules of their own: the spec belongs to the
  class or module whose public method the example calls, per Rule 2 below.
- The rspec-rails harnesses are for the spec types at unit scope. Model, request,
  and generator specs follow the Rails section below.

This skill states only what differs at integration scope.

## Contents

- [Step 0: Apply project overrides](#step-0-apply-project-overrides)
- [Checklist](#checklist)
- [Scope](#scope)
- [Assertions](#assertions)
- [State and environment](#state-and-environment)
- [Rails model, request, and generator specs](#rails-model-request-and-generator-specs)
- [What the tools check](#what-the-tools-check)
- [Verification](#verification)
- [Output](#output)

## Step 0: Apply project overrides

A project may carry its own thin copy of this skill holding only its local changes and
additions: where its integration specs live, the helpers and shared contexts that build
its temporary state, how it starts the external process, how its coverage run is
configured, where the minimum dependency version is
recorded and how its version-guard helper is defined, and its own conventions for
particular class families, which win over these rules as the shared standards' Step 0
says. Check for one at each of these paths and use the first that exists:

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

If no override exists, run this skill as written.

Whether or not this skill has an override, apply the project's
`rspec-base-standards` override too, if it has one, found the same way; its deltas
govern every convention this skill builds on.

## Checklist

Run the [shared checklist](../rspec-base-standards/SKILL.md#checklist) first; every
shared convention holds at this scope. Then, in order, for each spec written or
reviewed:

1. Name the seam this test checks that no unit test can (Rule 1).
2. One spec file per class, module, or resource; group by public method or endpoint
   (Rule 2).
3. One example per shape the real dependency returns, plus at least one failure
   (Rules 3, 4).
4. Assert the values the test put in, with a shape check only in the smoke test, and
   never the dependency's formatting (Rules 5, 6).
5. No conditional path that a unit spec already covers (Rule 7).
6. All state in a temporary place the example creates and removes (Rule 8).
7. No shell, no change to `cwd`, `ENV`, or other process-wide state, no platform-only
   paths (Rules 9 to 11).
8. An example that needs a newer dependency than the project's minimum skips with
   a reason (Rule 12).
9. A Rails model, request, controller, or generator spec covers every conditional path
   of its code; a model or request spec uses records it builds or names, and a
   transaction removes them (Rules 13, 14).

## Scope

### Rule 1 (MUST): An integration spec exists for a seam that unit specs cannot reach

A seam is a boundary the unit specs double: argument order between layers, a return
shape one layer produces and the next reads, an encoding or path assumption, or a
belief a stub encodes about what the real dependency returns. Name the seam in the
example's description. A behavior that is pure Ruby with no dependency in the path is
unit work and does not get an integration spec. Guide:
[Integration tests](../../docs/testing-guide.md#integration-tests), when to choose
it.

### Rule 2 (MUST): One spec file per class, module, or resource

The path an example runs crosses several real classes on its way to the dependency;
the file belongs to the class whose public method the example calls, and it does not
also exercise the lower classes through their own interfaces. A spec that drives the
whole application, or a workflow a user performs rather than a method the code
exposes, is a system test and follows the
[system standards](../rspec-system-testing-standards/SKILL.md). A request spec's file belongs
to its resource, with one group per endpoint, as the base rules on the top-level group
and on one `describe` per endpoint show. Guide:
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
[Happy path only](../../docs/testing-guide.md#test-smells).

## Assertions

### Rule 5 (MUST): Assert the values the test put in; a shape check only in the smoke test

Assert the values the test put in, exactly: the records it created, the file it wrote,
the message it committed. Use `have_attributes`, `include` with a specific element, or
`contain_exactly` on those fields, not `eq` on the whole record, which also asserts on
fields the dependency chose and so tests the dependency. A class check,
`not_to be_empty`, a count, or `respond_to` proves only that the dependency returned
something. One example per spec file may make that its claim: the smoke test, whose
only assertion is that the call succeeds against the real dependency and returns the
expected class. No other example relies on the smoke test's checks, and no other
example uses them in place of a value. An identifier the dependency generates has no
value the test knows: match its shape with a pattern, then use it, by handing it back
to the dependency and asserting on what comes back, as a SHA that matches `/\h{40}/`
and then names a commit whose message is the one the test wrote. Text the dependency
composes is Rule 6's concern. Guide:
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
name, and never drop the pattern because the tool's wording may change.

That pattern is the right check when the message comes from the tool's output, as
Rule 4's example does. It checks nothing when the library builds the message from the
call itself, so that the input is in it whatever failed: then it matches a failure the
tool reports before it reads the input, such as an unknown option, as readily as the
one the example forces. In that case use the block form and assert on what the
failure produced, which the exception carries. First the exit status, a shape Rule 3
already recognizes, which separates a usage error from a failure of the operation.
Then the input in the dependency's own error output, anchored on the input as above.
Do not assert on the wording that tells two failures apart; that is the tool's. When
the exception carries neither a status nor the output, the message pattern on the
input is still the best check available and stays.

```ruby
# The message is "git rev-parse nonexistent-ref: ..." for every failure of the call
expect { command.call('nonexistent-ref') }
  .to raise_error(Runner::Failed) { |error|
    expect(error.status).to eq(128)                   # 129 would be a usage error
    expect(error.stderr).to include('nonexistent-ref')
  }
```

Guide: [Testing
the framework or a library](../../docs/testing-guide.md#test-anti-patterns),
[Sensitive Equality](../../docs/testing-guide.md#test-smells), and [Error assertions
without a message pattern](../../docs/testing-guide.md#test-anti-patterns).

### Rule 7 (MUST): Do not cover a conditional path a unit spec covers

An integration example that exercises a branch of the code's own logic, rather than a
shape the real dependency returns, is a missing unit spec; the integration suite does
not repeat option-by-option cases. Integration specs are outside the coverage run,
except for framework-bound code, which Rule 13 covers. Guide: [Integration
tests](../../docs/testing-guide.md#integration-tests), anti-patterns.

## State and environment

### Rule 8 (MUST): Every example owns the state it uses

Build it inside the example or its `let` and `before`, in a temporary directory the
example creates. Create that directory in a `let` and remove it in an `after` hook,
which runs even when an assertion fails: `let(:tmp_dir) { Dir.mktmpdir }` with
`after { FileUtils.remove_entry(tmp_dir) }`. A `let` with no matching `after` leaves the
directory behind. No example reads
state it did not create, and none writes where another reads. Fixed fixture files are
for inputs whose exact shape is the point. Guide: [Integration
tests](../../docs/testing-guide.md#integration-tests), real and doubled, and [Test
data](../../docs/testing-guide.md#test-data).

### Rule 9 (MUST): Start the external process as the code does, never through a shell

No backticks, `system`, `%x[]`, `spawn`, `exec`, `fork`, `Process.daemon`, `popen` on
`IO` or `File`, `PTY.getpty`, `Open3`, Bundler's `unbundled_system` family, or `open`,
`IO.read`, `IO.readlines`, `IO.foreach`, `IO.write`, `IO.binread`, or `IO.binwrite` with
a leading `|` in a spec, including setup: nothing that starts a process outside the
library. Use the library's own execution path so the spec proves the real one and does
not depend on shell quoting or on `PATH`. For files and directories, use the standard
library. Guide: [Integration tests](../../docs/testing-guide.md#integration-tests), real
and doubled.

### Rule 10 (MUST): Do not change process-wide state

Pass the directory and any variables to the process explicitly. `cwd`, `ENV`, locale,
and global configuration are process-wide: a change in one example is visible, while it
lasts, to every thread in the process, including threads the library or an earlier
example started, so restoring it afterwards does not make it safe. One exception: when
the code under test exists to read that state and has no seam, change it inside an
`around` hook that restores it even on failure, comment why, and add the seam as the
follow-up.
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
code declares it supports. A guarded example still reports its skip and the reason on a
machine with an older version, so the run shows what it did not cover instead of failing
or leaving the example out. Which examples run still depends on the installed version,
so CI runs both the oldest supported version and a current one. The project override
says where the minimum is recorded and how its version helper is defined, which decides
the form: a helper that reads a `let` has to be called as `skip` inside the example,
because `skip:` metadata is evaluated in the group body where no `let` exists yet; one
defined at module level works in either form. Guide: [Integration
tests](../../docs/testing-guide.md#integration-tests), real and doubled.

## Rails model, request, and generator specs

A model, a controller, and a generator are framework-bound code: rspec-rails has no
unit-scope harness for them, so no unit spec reaches them, and their integration specs
do the unit specs' job. For a model, request, or generator spec, Rule 13 replaces Rules
1, 3, 4, and 7. For a model or request spec, Rule 14 replaces Rule 8 for database
records; Rule 8 still holds for files, including the temporary destination a generator
spec writes to. The spec exists for the code, not for a seam, and neither the database
nor the generator framework is the external program those rules assume. Controller specs
follow the same rules, but new work goes in request specs, which Rails recommends in
their place.

### Rule 13 (MUST): Framework-bound specs cover every conditional path of their code

A model spec covers the model's validations, scopes, callbacks, and methods; a request
spec covers each branch of its action, through the request; a generator spec covers each
branch of the generator, run against a temporary destination. All three are in the
framework-bound coverage run: these specs alone, measured only on the framework-bound
files, which are the ActiveRecord models, controllers, and generators. SimpleCov selects
files by path, so the split is by path: the project override names the paths, usually
`app/models`, `app/controllers`, and `lib/generators`. A plain Ruby class, an
ActiveModel-only class, or a concern a host can test lives outside them, such as in
`app/services` or a subdirectory the run excludes, and belongs to the unit run.
Measuring on those files keeps a request spec from counting for a service object, which
the unit run covers. Within the run the gate cannot say which spec covered a line, so a
request spec that happens to reach a model branch hides a gap in the model spec: check
each model branch against the model spec itself. Guide: [Integration
tests](../../docs/testing-guide.md#integration-tests), when to choose it, [Model
specs](../../docs/testing-guide.md#model-specs), and [Generator
specs](../../docs/testing-guide.md#generator-specs).

### Rule 14 (MUST): Each example names its records, and a transaction removes them

Build them with factories inside the example or its `let` and `before`, or read named
fixtures such as `users(:alice)`, and let Rails' transactional tests roll back what the
example changes. Use `build` or `build_stubbed` where the example never reads the record
back from the database. No example depends on a record it does not name, which is the
guide's Mystery Guest. Guide: [Rails smells](../../docs/testing-guide.md#rails-smells)
and [Mystery Guest](../../docs/testing-guide.md#test-smells).

## What the tools check

Rule 13 is mechanical as the gate of the framework-bound coverage run, which the project
override names the command for. Rules 8 and 10 are partly mechanical: a suite that runs
in random order and in parallel surfaces shared or mutated state as failures. Rule 9 has
no cop; grep the integration spec roots for the calls Rule 9 lists, with or without
parentheses. The roots are `spec/integration`, in a Rails app the spec type directories
at integration scope, and the shared helpers and contexts, usually `spec/support`, since
Rule 9 covers a spec's setup and that is where an integration spec's setup lives.
Substitute whatever paths the project override names.

```bash
grep -rnE --include='*.rb' '`|%x|(^|[^[:alnum:]_:]|::)(system|spawn|exec|fork|daemon|popen|getpty)([^[:alnum:]_]|$)|unbundled_(system|exec)|Open3|(open|IO(\.|::)(read|readlines|foreach|write|binread|binwrite)) *\(? *(%[qQ]?)?.\|' spec/integration spec/support
# In a Rails app, also: spec/models spec/requests spec/controllers spec/generators
```

Rule 9 owns the list of calls and the pattern follows it, so adding a call means editing
those two and not a third copy here. The pattern catches the calls written as literals;
a command built in a variable and passed to `open` or `IO.read` matches nothing, so read
the spec's setup for one. The leading character class rejects an underscore or a single
colon before the word, so `instance_exec` and `type: :system` do not match, while `::`
is allowed for a call written as `Process::spawn`, and Bundler's `unbundled_system`
family has an alternative of its own. `Kernel#open` and those `IO` methods run a command
on a leading `|`, in a quoted or a `%q` string, on every Ruby before 4.0, which removed
it after a deprecation in 3.3, so the pattern keeps them. Read the hits: the word inside
a description string is not a call. A gem that wraps these, such as `TTY::Command` or
`Open4`, matches nothing here; read the spec's requires for one.

The coverage run shows one half of Rule 7: a branch only an integration spec reaches
reads as uncovered there, since integration specs of code that is not framework-bound
are outside it. A coverage report from one run of the whole suite hides it. The other
half, an integration file that repeats cases the unit specs cover, leaves no trace in
any report.
For each `context` in the integration file, ask what differs at the dependency. A
distinct shape the real dependency returns is a Rule 3 example and stays, even when a
unit context stubs the same condition, because confirming that stub is its purpose. A
branch of the code's own logic, reached with a shape another example already confirms,
is Rule 7's duplication and goes. The project override says which of these run in the
project.

## Verification

After writing or changing a spec:

1. Run the spec file with the block below. It points `TMPDIR` at a directory made for
   the run, so the leak check in step 3 sees only what this run created, exits non-zero
   when the specs fail, and removes the directory either way. Run each new or changed
   example alone too, by line number, since the shared rule on ordering asks that every
   example pass alone and no other step runs one that way.
2. Run it in parallel with the rest of the suite if the project supports that. That
   run, not a re-run of the file, is what surfaces the cross-example state Rules 8
   and 10 exist for; re-running one file only reshuffles its own examples.
3. Confirm the run left nothing in that directory. The block exits non-zero and names
   anything an example did not remove, so its exit status covers steps 1 and 3.
4. For a model, request, controller, or generator spec, confirm its code is fully
   covered in the framework-bound coverage run (Rule 13). The project override names the
   command; without one, run those specs alone with SimpleCov, tracking only the
   framework-bound files with `enable_coverage :branch` on, and read each file's line
   and branch figures.
5. Scan the spec against every MUST rule, this skill's and the shared ones, and fix
   what fails.

```bash
(
  run_tmp=$(mktemp -d)
  trap 'rm -rf "$run_tmp"' EXIT
  TMPDIR="$run_tmp" bundle exec rspec path/to/integration_spec.rb || exit
  left=$(ls -A "$run_tmp")
  [ -z "$left" ] || { echo "not removed: $left" >&2; exit 1; }
)
```

The subshell keeps `exit` from closing the shell that runs the block, and the `trap`
removes the directory whether the specs pass, fail, or leave something behind.

## Output

When writing, produce the spec and run the verification above. When reviewing or
auditing, produce a table with one row per rule, marked Pass, Fail, or N/A with the
issue, then the MUST violations to fix, then the SHOULD deviations ordered by
impact. The table covers the shared rules as well as this skill's own; one that lists
only this skill's rules has audited a fraction of what applies.
