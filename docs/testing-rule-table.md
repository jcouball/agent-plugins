# Rule table

Temporary, and half spent. This is the plan for moving the ruby-git testing skills
into the testing plugin and cutting the project layer down to its own differences. It
lives outside `plugins/` so it does not install with the plugin.

The plugin half has landed: the tier-2 skills exist, and the guide paragraphs this
table said were missing are written. The unit rows split in the landing: twenty-two
of them were conventions any spec follows and went to rspec-base-standards, leaving
seven in the unit skill, so a `U` row's home is `shared` unless it is one of the
constructor, requires, shared setup, stubbing, coverage, determinism, or global
state. What is left is the ruby-git half, which
happens in that repository: writing the override files, cutting the command and
facade conventions down to their deltas, and adopting rubocop-rspec. The `C:` and
`F:` rows below describe skills that live there, not here. Delete this file in the
last commit of that work; what survives it is each rule's link to the guide, each
override file's list of flipped rules, and the cop pointers in the tier-2 skills.

The rows record the plan as it was made. Where a row and a shipped skill disagree,
the skill is what shipped.

One row per rule or convention in the five ruby-git testing skills as of
2026-09-22. Columns:

- **Rule.** Where it is stated today. `U<n>` is Rule n of
  rspec-unit-testing-standards. `C:` is command-test-conventions, `F:` is
  facade-test-conventions, `D:` is test-debugging, `R:` is tdd-refactor-step.
- **Tier.** 1 is the guide, read for reasons. 2 is a shared standards skill an agent
  loads to do the job. 3 is the project layer: an override file or a family
  convention skill in ruby-git. 0 is a mechanical check.
- **Home.** The one place the rule is stated after the move. Everything else cites it.
- **Guide.** The heading in
  [testing-guide.md](../plugins/testing/docs/testing-guide.md) the rule derives
  from. `none` is a gap: either the guide needs a paragraph or the rule needs
  questioning. `n/a` is a procedure or a project fact with nothing to derive.
- **Cop.** The rubocop-rspec cop that enforces it, if one exists. Names are from
  memory and are verified when the cop is turned on. A cop-enforced rule shrinks to
  one sentence in its home saying so.

Tier-2 homes are: `shared` (rspec-base-standards, the conventions every spec follows,
which the two below load first), `unit` (rspec-unit-testing-standards, moved into the
plugin and cut down to what is unit-specific), `integration`
(rspec-integration-testing-standards, new), `debugging`
(test-debugging, moved into the plugin), `refactor` (tdd-refactor-step, moved
into the plugin). Tier-3
homes are: `unit/override`, `integration/override`, `debugging/override`,
`refactor/override` (the ruby-git delta files), `command` and `facade` (the family
conventions, cut down).

## Unit standards, Rules 1 to 28

The U codes are this table's and number the rules as ruby-git's unit skill stated
them before the move. They are not the shipped rule numbers: a U row in `shared`
has a new number in rspec-base-standards, and one in `unit` a new number among that
skill's seven.

| Rule | Statement | Tier | Home | Guide | Cop |
| --- | --- | --- | --- | --- | --- |
| U1 | One top-level `RSpec.describe` per class, using the constant | 2 | unit | Class unit tests | RSpec/DescribeClass |
| U1 note | Backward-compat alias specs assert identity only | 3 | unit/override | none; project history | |
| U2 | One `describe` per public method, `#` and `.` prefixes | 2 | unit | Class unit tests | RSpec/DescribeMethod, top-level `describe` only |
| U2 note | Inherited `#initialize` still gets a `have_attributes` block | 2 | unit | Class unit tests | |
| U2 note | `#initialize` storing into state nothing public reads omits the block | 2 | unit | Test logic in production code | |
| U3 | `# frozen_string_literal: true` at top of spec | 0 | unit, one line | n/a | Style/FrozenStringLiteralComment |
| U4 | Spec path mirrors source path | 2 | unit | Class unit tests, Definition | RSpec/SpecFilePathFormat |
| U5 | Require spec_helper and only the file under test | 2 | unit | Class unit tests, Definition | |
| U6 | Test only through the public interface; no `send` | 2 | unit | Unit tests, Anti-patterns; Asserting on implementation details | |
| U7 | Use `described_class` | 0 | unit, one line | n/a | RSpec/DescribedClass |
| U8 | `context` starts with when, with, without | 2 | unit | Structure and naming in RSpec | RSpec/ContextWording |
| U9 | One concept per `it`; description matches assertion | 2 | unit | A description that does not match the assertion; Eager Test | none; RSpec/MultipleExpectations counts `expect` calls and cannot tell concepts apart |
| U10 | Standard nesting describe, context, it | 2 | unit | Deep nesting | RSpec/NestedGroups, depth only |
| U11 | Named `subject` first in each `describe #method` | 2 | unit | Structure and naming in RSpec | RSpec/LeadingSubject, RSpec/NamedSubject, position and bare references only |
| U12 | `let` defaults follow `subject`; contexts override one | 2 | unit | Test data; Build the minimum, Name what matters | |
| U13 | `let(:described_instance)` when describes share construction | 2 | unit | Structure and naming in RSpec | |
| U13 note | `#initialize` that only stores uses one `have_attributes` | 2 | unit | Eager Test, inverted: one concept | |
| U14 | `subject` is the method call result | 2 | unit | Structure and naming in RSpec | |
| U15 | `change` and `raise_error` matchers over before/after | 2 | unit | State-based | RSpec/ExpectChange, argument style only |
| U16 | `let` for every value, `before` only for side effects | 2 | unit | `let!` as a hidden fixture | RSpec/InstanceVariable, instance variables only |
| U17 | Keep setup local; `shared_context` only for substantial cross-file reuse | 2 | unit | General Fixture; Mystery Guest | |
| U17 note | A unit test that needs a shared_context is an integration test | 2 | unit | Unit tests, Real and doubled | |
| U17 note | Shared contexts live in `spec/support/contexts/`, explicit `include_context` | 3 | unit/override | n/a | |
| U18 | Stub non-trivial external objects; not trivial values | 2 | unit | Unit tests, Real and doubled | |
| U18 note | Solitary school by default; a sociable project says so in its override | 2 | unit | Unit tests, Real and doubled | |
| U19 | `allow` for incidental stubs, `expect` for the behavior under test | 2 | unit | Verification; Communication-based | RSpec/MessageSpies with `EnforcedStyle: receive`; RSpec/StubbedMock, one half |
| U20 | Verifying doubles, with the two documented exceptions | 2 | unit | Doubles in RSpec | RSpec/VerifiedDoubles, a flagged exception carries a disable directive |
| U21 | 100% line and branch coverage over the unit suite | 2 | unit | Unit tests, What it proves | SimpleCov gate |
| U21 note | Reach, delete, then exclude, in that order | 2 | unit | Unit tests, What it proves | |
| U21 note | `# simplecov:disable` form, criterion, and reason | 3 | unit/override | n/a; tool detail | |
| U21 note | Coverage is a floor, never write a line-executing example | 1 | guide | Unit tests, What it proves | |
| U22 | Error assertions name class and message pattern | 2 | unit | Error assertions without a message pattern | RSpec/UnspecifiedException, partial |
| U23 | Edge cases inside the relevant `context` | 2 | unit | Example-based | |
| U24 | Assert observable behavior, independent failure mode test | 2 | unit | Asserting on implementation details; A tautological test; Change detector | |
| U24 note | No constant-existence or is-a-Module tests | 2 | unit | A tautological test | |
| U25 | Deterministic: no real time, randomness, sleep | 2 | unit | Non-determinism; Test data, Keep it deterministic | |
| U26 | Do not modify global or process state; seam over restore | 2 | unit | Mutating process or global state | |
| U27 | Order-independent | 0 | unit, one line | Order dependence | `config.order = :random` |
| U28 | No `allow_any_instance_of`, `receive_message_chain`, or stub on the subject | 2 | unit | Stubbing the subject; Asserting on implementation details | RSpec/AnyInstance, RSpec/MessageChain, RSpec/SubjectStub |
| U verification | Post-write checklist | 2 | unit | n/a | |

## Command test conventions

| Rule | Statement | Tier | Home | Guide | Cop |
| --- | --- | --- | --- | --- | --- |
| C: prerequisite | Read all of the unit standards first | drop | cite unit instead | n/a | |
| C: version scope | Judge coverage against the minimum supported Git version | 3 | command | n/a | |
| C: unit cases | Base invocation, each operand, flag, alias, value form, pathspec, forwarding | 3 | command | Example-based; equivalence class per conditional path | |
| C: exit status | Test in-range and out-of-range codes when `allow_exit_status` is non-default | 3 | command | Example-based | |
| C: validation | Every declared constraint gets an `ArgumentError` test | 3 | command | Error assertions without a message pattern | |
| C: helpers | `expect_command_capturing`, `expect` not `allow` | 3 | command | Verification; Communication-based, cites U19 | |
| C: stdin | Capture the IO pipe and assert its contents | 3 | command | n/a | |
| C: not `false` flags | `option: false` is the base path | 3 | command | Example-based, equivalence class | |
| C: not repeat return | Return pass-through asserted once per file | 3 | command | Eager Test, inverted | |
| C: not intermediate ints | `max_times:` tests true and N only | 3 | command | Example-based, equivalence class | |
| C: not string variants | One test per operand, not per value | 2 | unit, as a sentence in U23 | Example-based, equivalence class | |
| C: not DSL re-tests | Command specs test use of the DSL, not the DSL | 2 | unit, as a sentence in U24 | Testing the framework or a library | |
| C: policy vs interface | Command specs test the interface, facade specs test policy | 3 | command | n/a; architecture | |
| C: no `#initialize` | Deliberate exception to U2 | 3 | command | n/a; cites U2, U24 | |
| C: unit grouping | Argument building, exit code handling, input validation | 3 | command | n/a | |
| C: integration is smoke | Integration specs are smoke tests, one class per file | 2 | integration, with the family detail in command | Named combinations, Smoke; Integration tests | |
| C: integration covers | Smoke, real exit codes, at least one error path | 3 | command | Integration tests, What it proves | |
| C: not git's format | Do not assert on git's output format | 2 | integration, as "do not test the external system" | Testing the framework or a library | |
| C: branch workflow | Feature branch, never push to main | drop | development-workflow owns it | n/a | |
| C: integration grouping | succeeds and fails contexts | 3 | command | n/a | |
| C: version guards | `skip: unless_git(...)` on newer-version options | 3 | command | n/a | |
| C: `initial_branch: 'main'` | Every `Git.init` in setup | 3 | command | Non-determinism | |
| C: no shell-outs | No backticks or `system` in tests | 2 | integration | Integration tests, Real and doubled | |
| C: cross-platform | No Unix-only paths | 2 | integration | Integration tests, Real and doubled | |

## Facade test conventions

| Rule | Statement | Tier | Home | Guide | Cop |
| --- | --- | --- | --- | --- | --- |
| F: prerequisite | Read all of the unit standards first | drop | cite unit instead | n/a | |
| F: contract | Facade unit tests verify the orchestration contract | 3 | facade | Communication-based | |
| F: setup pattern | `instance_double` per command, `execution_context` injected | 3 | facade | Doubles in RSpec | |
| F: unit cases | Defaults, each argument, each option, sequences, parser, whitelist, deprecation, call shapes | 3 | facade | Example-based | |
| F: ordered | `.ordered` for multi-command sequences | 3 | facade | Communication-based | |
| F: not argv | Do not assert CLI tokens; that is the command spec | 3 | facade | Testing the framework or a library, by analogy | |
| F: not parser internals | Stub the parser, assert the call | 3 | facade | Unit tests, Real and doubled | |
| F: not real execution | No real git in facade unit tests | 2 | unit, already U18 | Unit tests, Real and doubled | |
| F: not per value | One test per argument type | 2 | unit, as a sentence in U23 | Example-based, equivalence class | |
| F: not `#initialize` | Constructor coverage belongs to repository_spec | 3 | facade | n/a | |
| F: unit grouping | describe per method, optional trailing contexts | 3 | facade | n/a | |
| F: integration when | Only multi-command orchestration or facade-owned post-processing | 2 | integration, as "write an integration test only for a seam no other test covers" | Integration tests, When to choose it | |
| F: integration skip | Delegators, single-command with parser, pre-processing, error paths | 3 | facade | Integration tests, Anti-patterns | |
| F: document skips | Comment why a method has no integration test | 3 | facade | n/a | |
| F: integration asserts | Structure and key fields of the Ruby return value | 2 | integration | Integration tests, What it proves; Sensitive Equality | |
| F: not git phrasing | Anchor on inputs the test controls, not message text | 2 | integration | Sensitive Equality | |
| F: signature policy | Legacy-contract methods test each call shape | 3 | facade | n/a | |

## Test debugging

| Rule | Statement | Tier | Home | Guide | Cop |
| --- | --- | --- | --- | --- | --- |
| D1 | Run alone, run repeated, run in suite | 2 | debugging | Test smells, as the diagnosis of order dependence and non-determinism | |
| D1 commands | The rspec and rake invocations | 3 | debugging/override | n/a | |
| D2 | Read the error, check recent changes, look for shared state, timing, non-determinism, order | 2 | debugging | Order dependence; Non-determinism; Mutating process or global state | |
| D2 environment | Platform, git version, ruby version | 3 | debugging/override | n/a | |
| D3 | Report format | 2 | debugging | n/a | |
| D4 | Fix strategy table with commit types | 2 | debugging | Purpose; Regression tests, for the "test caught a bug" row | |
| D4 confirm | Confirm before changing an existing test | 2 | debugging | n/a | |
| D5 | Verify with repeated runs then the suite | 2 | debugging | n/a | |
| D: project | Helpers, shared contexts, fixtures, CI skill | 3 | debugging/override | n/a | |

## TDD refactor step

| Rule | Statement | Tier | Home | Guide | Cop |
| --- | --- | --- | --- | --- | --- |
| R: skip decision | Skip only with no smell from either table and no uncorrected offense | 2 | refactor | n/a; not a testing rule | Metrics cops cover three, at their own thresholds |
| R: smells | Nine production-code smells with thresholds | 2 | refactor | n/a; not a testing rule | Metrics/MethodLength, Metrics/ParameterLists, Metrics/AbcSize |
| R: techniques | Extract method, keyword args, guard clause, constant, shared setup | 2 | refactor | n/a | |
| R: test smells | Duplicated let, long bodies, repeated literals, identical examples, unclear descriptions | 2 | refactor, citing unit | Test smells; Test data | none in the landed table |
| R: rubocop | Scope the file list to the task, auto-correct, read what is left | 2 | refactor | n/a | |
| R: verification | Tests pass, no new offenses, no new test added | 2 | refactor | n/a | |
| R: project patterns | Command classes, DSL metadata, error hierarchy, frozen constants, private layout | 3 | refactor/override | n/a | |
| R: boundaries | No new behavior, API, unrelated files, premature optimization, over-abstraction | 2 | refactor | n/a | |

## What the table shows

**Rules with two homes today.** Nine, all resolved above to one:

- U18 and F "not real execution" say the same thing. Home: U18.
- U19 and C "helpers" both say `expect` for the behavior under test. Home: U19; the
  command skill keeps only the helper name.
- U2 and C "no `#initialize`" conflict on purpose. The exception stays in the command
  skill, stated as an override of U2, and U2 gains one sentence saying families may
  override it.
- C and F both say one test per argument type, not per value. Home: U23, which
  now says one example per equivalence class, derived from Example-based.
- C "not DSL re-tests" and F "not parser internals" and F "not argv" are one idea:
  do not re-test what a collaborator's own spec proves. Home: U24, which now names
  it; each family skill keeps the one-line application.
- C "integration is smoke" and F "integration when" are the scope rule stated twice
  from two directions. Home: integration, as one rule with both halves.
- C "not git's format" and F "not git phrasing" are Sensitive Equality against an
  external system. Home: integration.
- R "test smells" repeats unit rules in table form. Home: it cites unit and the guide.
- Both C and F open by requiring the whole unit standards be read. Dropped: tier 3
  loads tier 2 by citation, not by re-reading.

**Rules with no guide paragraph.** Seven were found and the guide now covers them:
U4 and U5 under Class unit tests, U8, U11, U13, and U14 under a new Structure and
naming in RSpec section, and U23 under Example-based. The two integration
environment rules were a different gap: their rows already cited the Integration
entry's Real and doubled paragraph, but that paragraph did not state them, so it
now does. The integration version-guard rule was a third gap: its citation went to
Cost, which says nothing about versions, so Real and doubled gained a sentence for
it too. Five new paragraphs and two extended ones in all. Everything marked
`n/a` is procedure or project fact and needs no paragraph.

**Rules a cop enforces.** Six unit rules have a rubocop-rspec cop that checks them
(U1, U4, U7, U8, U20, U28), U22 has one that checks it in part, and U3 has a core
rubocop cop. U3 and U7 are already one-liners in rspec-base-standards, and U27 and
the rubocop step in R are settled by configuration rather than a cop. Seven more
rows name a cop that touches the rule without checking it (U2, U9, U10, U11, U15,
U16, U19), as their Cop column says; those stay rules after adoption. If ruby-git
adopts rubocop-rspec, the five of the six rows that are not yet one-liners become
one sentence each in the home naming the cop. Adopting rubocop-rspec in ruby-git is
a step of the move, and it decides how short rspec-base-standards gets. Until then
the rules stay as rules.

The configuration that adoption settles, together with the random ordering, the
coverage gate, and the verifying-double settings the standards assume, is what a
`check-rspec-config [--fix]` command in the testing plugin would audit a project against,
in the shape of the github plugin's check-repo-config. That command is a later step
and is written from the configuration proved in ruby-git, not before it.

**What tier 3 keeps.** The command and facade skills lose their prerequisites,
their restatements of U18, U19, U24, and the shared "not per value" and "not the
collaborator's spec" rules, and their integration scope rule. They keep the case
lists, grouping, helper names, the `#initialize` exception, the policy-versus-
interface split, version guards, `initial_branch`, and the skip documentation rule.
Each should come out near a page.

**The integration skill's contents,** gathered from the rows marked `integration`:
scope, one file per class or module, smoke plus at least one error path, one test
per stubbed return shape rather than per conditional path, assert on structure the
test controls and never on the external system's formatting, own the environment
(temporary directory, no shell-outs, portable paths, restore nothing because nothing
global was touched), and when not to write one.
