---
name: rspec-base-standards
description: 'Conventions every RSpec spec follows whatever its scope: naming the subject in `RSpec.describe`, one `describe` per method or endpoint, the spec path, testing through the public interface, `context` and `it` wording, nesting, `subject` and `let`, `allow` and `expect`, verifying doubles, error assertions, edge-case placement, observable behavior, random order, the forbidden stubbing forms, and no conditional logic or declared constants in a spec. Load it with the unit, integration, or system standards, which add what their scope needs; the system standards also amend a few of these rules. Use when writing, reviewing, or auditing any RSpec spec. If the current project has its own rspec-base-standards skill, that file holds project-specific changes and additions: still apply this skill, and apply those changes on top (Step 0).'
---

# RSpec base standards

The conventions every RSpec spec follows, whatever it tests. The
[unit](../rspec-unit-testing-standards/SKILL.md),
[integration](../rspec-integration-testing-standards/SKILL.md), and
[system](../rspec-system-testing-standards/SKILL.md) standards each load
this skill and add the rules their scope needs; where one of them overrides a rule
here, it says so. Each rule is one sentence with a priority word, an example where one
helps, and, where the guide reasons about it, a link to the paragraph of the
[testing guide](../../docs/testing-guide.md) it derives from. The few rules a tool
settles outright name the cop instead.

**MUST** is mandatory; do not violate it without a documented exception. **SHOULD**
is the default; override it when a clearer test requires it, and say so in a comment.

## Contents

- [Step 0: Apply project overrides](#step-0-apply-project-overrides)
- [Checklist](#checklist)
- [Structure](#structure)
- [Naming and organization](#naming-and-organization)
- [Setup and subject](#setup-and-subject)
- [Doubles and stubbing](#doubles-and-stubbing)
- [Assertions](#assertions)
- [Reliability](#reliability)
- [What the tools check](#what-the-tools-check)

## Step 0: Apply project overrides

A project may carry its own thin copy of this skill holding only its local changes and
additions: naming conventions it flips, constructs it forbids or permits, and where its
specs live. Check for one at each of these paths and use the first that exists:

- `.claude/skills/rspec-base-standards/SKILL.md`
- `.github/skills/rspec-base-standards/SKILL.md`

If neither exists, fall back to searching wherever the project keeps agent skills
for a `SKILL.md` whose frontmatter `name` is `rspec-base-standards`:

```bash
grep -rlE --include=SKILL.md "^name: *['\"]?rspec-base-standards['\"]? *$" . \
  --exclude-dir=node_modules --exclude-dir=vendor --exclude-dir=.git
```

The name may be quoted or bare, and the anchors keep it from matching a longer
name. Never treat a vendored or installed copy of this skill itself as the override; a
full copy holds no project deltas. Read the file found and apply its changes and
additions, with the project file winning on conflict. If that file is what invoked
this skill, its changes are already in context; do not re-read it, and do not
re-invoke anything it names.

If no override exists, run this skill as written.

## Checklist

In order, for every spec written or reviewed, whatever its scope:

1. One `RSpec.describe` naming the subject, with the constant when the subject is
   Ruby code; `described_class` inside; `# frozen_string_literal: true` at the top;
   one `describe` per method or endpoint; and a path that follows from the subject
   (Rules 1 to 4, 6).
2. Nothing reached except through the public interface: no `send`, `__send__`, or
   `instance_variable_get` (Rule 5).
3. `context` descriptions start with when, with, or without; each `it` asserts one
   concept and says what it asserts (Rules 7, 8).
4. `describe`, then `context`, then `it`, no deeper than three levels (Rule 9).
5. Where the subject is Ruby code, a named `subject` first, the `let` inputs after
   it, a `context` overriding only the input its condition is about (Rules 10 to 13).
6. `change` and `raise_error` matchers over before-and-after assertions; `let` for
   every value and `before` only for side effects (Rules 14, 15).
7. `allow` unless the message is the behavior under test, then `expect`; verifying
   doubles, with a disable directive on each permitted exception (Rules 16, 17).
8. Error assertions name the class and a message pattern; edge cases sit beside the
   normal case; every assertion names an outcome a specific code change would break
   (Rules 18 to 20).
9. Every example passes alone and in random order; no committed focus, skip, or
   `pending` marker; no `allow_any_instance_of`, `receive_message_chain`, or stub on the
   subject; no conditional logic inside an example; and no constant declared in a spec
   file (Rules 21 to 25).

Then run the checklist of the standards for this spec's scope, which adds what that
scope requires and says which of these rules it overrides.

## Structure

A spec's subject is what its top-level group names. Usually it is Ruby code: a class,
a module mixed into a host, or a module of functions. In some Rails spec types it is
not: an endpoint in a request spec, a template in a view spec, and a user workflow in a
system spec. Rules 1, 2, 4, and 6 say what each kind of subject takes, and Rules 10 to
13 hold only where the subject is Ruby code.

A routing spec sits between the two. It names the controller class, the form the
rspec-rails generator writes, but it calls no method of the class: its examples check
the routes that dispatch to it. It groups them under one `describe 'routing'`, lives
at `spec/routing/<resource>_routing_spec.rb`, and Rule 2, the mirroring in Rule 4, and
Rules 10 to 13 do not apply to it.

### Rule 1 (MUST): One top-level `RSpec.describe` per file, naming the subject

```ruby
RSpec.describe Billing::Invoice do               # Ruby code: the constant
RSpec.describe '/invoices', type: :request do    # endpoints: the resource path
RSpec.describe 'invoices/show', type: :view do   # a template: its path
RSpec.describe 'Checkout', type: :system do      # a workflow: the feature
```

When the subject is Ruby code, use the constant, never a string: a string loses
`described_class` and the load-time detection of a typo in the constant. A Rails spec
carries its `type` unless the project infers it from the directory. Guide: [Class unit
tests](../../docs/testing-guide.md#class-unit-tests) and [Rails spec
types](../../docs/testing-guide.md#rails-spec-types).

### Rule 2 (MUST): One `describe` per method or endpoint

```ruby
describe '#total' do ... end         # instance method
describe '.from_order' do ... end    # class or module method
describe 'POST /invoices' do ... end # endpoint, under its resource
```

The constructor is not a public method for this rule; the unit standards say when it
gets a group of its own. A subject with one entry point, such as a template, puts its
`context` groups directly under the top-level group, and the system standards say how a
workflow's examples are grouped. Guide: [Class unit
tests](../../docs/testing-guide.md#class-unit-tests).

### Rule 3 (SHOULD): `# frozen_string_literal: true` at the top of every spec

Mechanical: Style/FrozenStringLiteralComment enforces it where rubocop runs.

### Rule 4 (MUST): The spec path follows from the subject

For Ruby code it mirrors the source path: `lib/billing/invoice.rb` is tested by
`.../billing/invoice_spec.rb`, under whichever spec root the scope's standards name.
Any other subject sits in its spec type's directory, named for the subject:
`spec/requests/invoices_spec.rb`, `spec/views/invoices/show.html.erb_spec.rb`,
`spec/system/checkout_spec.rb`. Guide: [Class unit tests](../../docs/testing-guide.md#class-unit-tests).

### Rule 5 (MUST): Test only through the public interface

Never call a private method, and never use `send`, `__send__`, or
`instance_variable_get` to reach private state. If private logic cannot be reached
through a public method, stop and propose one of: extract a class, make the method
public, or split the public method. Guide:
[Unit tests](../../docs/testing-guide.md#unit-tests) and
[Asserting on implementation details](../../docs/testing-guide.md#test-anti-patterns).

## Naming and organization

### Rule 6 (SHOULD): Use `described_class` inside a group that names a constant

Mechanical: RSpec/DescribedClass enforces it where rubocop-rspec runs.

### Rule 7 (MUST): `context` descriptions start with "when", "with", or "without"

```ruby
context 'when the order is empty' do
context 'with a discount code' do
context 'without a due date' do
```

Guide:
[Structure and naming in RSpec](../../docs/testing-guide.md#structure-and-naming-in-rspec).

### Rule 8 (MUST): Each `it` asserts one concept, and its description matches the assertion

Several `expect` calls are one concept when one code change would fail them all, such
as the type, status, and fields of a single return value. Two assertions that
different changes would break are two examples.

```ruby
it 'returns the invoice with the failure details' do
  expect(invoice).to have_attributes(status: :failed, code: 'E42', retryable: false)
end
```

Guide:
[A description that does not match the assertion](../../docs/testing-guide.md#test-anti-patterns)
and [Eager Test](../../docs/testing-guide.md#test-smells).

### Rule 9 (SHOULD): Nest `describe #method`, then `context`, then `it`

A method with one path and no conditions worth naming puts `it` directly under
`describe`. Deeper than three groups, counting the top-level one, is a smell, and
RSpec/NestedGroups' default `Max: 3` flags it. Guide: [Deep
nesting](../../docs/testing-guide.md#rspec-smells).

## Setup and subject

Rules 10 to 13 name the return value of a method, so they hold where the subject is Ruby
code. In a request or view spec, the request or the `render` is the action: put it in
a `before` in the group its examples share, and assert on `response` or `rendered`.
The system standards say where a workflow's steps go.

### Rule 10 (SHOULD): A named `subject` comes first in each `describe #method`

```ruby
describe '#total' do
  subject(:total) { described_class.new(lines, tax: tax).total }
  let(:lines) { [line(100), line(250)] }
  let(:tax) { 0.0 }
```

Name it for what the call returns. Never redefine `subject` in a nested `context`;
vary the `let` inputs instead. Guide:
[Structure and naming in RSpec](../../docs/testing-guide.md#structure-and-naming-in-rspec).

### Rule 11 (SHOULD): `let` defaults follow `subject`; a `context` overrides one input

```ruby
  context 'with tax' do
    let(:tax) { 0.2 }
    it { is_expected.to eq(420) }
  end
```

Guide: [Test data](../../docs/testing-guide.md#test-data), build the minimum and
name what matters.

### Rule 12 (SHOULD): One `let(:described_instance)` when methods share construction

```ruby
RSpec.describe Billing::Invoice do
  let(:lines) { [] }
  let(:described_instance) { described_class.new(lines) }

  describe '#total' do
    subject(:total) { described_instance.total }
```

Use `let`, not `subject`, so it is never the implicit assertion target. Reference only
`let`-defined arguments so a nested `context` can override one. For `#initialize`,
alias it: `subject(:instance) { described_instance }`; the unit standards' rule on
the constructor says how many examples it gets. Guide:
[Structure and naming in RSpec](../../docs/testing-guide.md#structure-and-naming-in-rspec).

### Rule 13 (SHOULD): `subject` is the return value of the method under test

For `#initialize`, the constructed object is the return value. Guide:
[Structure and naming in RSpec](../../docs/testing-guide.md#structure-and-naming-in-rspec).

### Rule 14 (SHOULD): Use `change` and `raise_error` matchers, not before-and-after assertions

```ruby
expect { invoice.void! }.to change(invoice, :status).from(:open).to(:void)
```

Guide: [Verification in RSpec](../../docs/testing-guide.md#verification-in-rspec),
state-based.

### Rule 15 (MUST): `let` for every value, `before` only for side effects

`let!` is `let` plus a `before` that calls it, not a third kind of thing: reach for
it only when the object must exist whether or not the example names it, and declare
it in the narrowest group that needs it. In a group where some examples do not, it
is the hidden fixture its guide entry names. `before` holds only work that produces
no value worth naming, and sets no instance variable. Guide:
[`let!` as a hidden fixture](../../docs/testing-guide.md#rspec-smells).

## Doubles and stubbing

### Rule 16 (MUST): `allow` to stub; `expect` only when the message is the behavior

```ruby
# The return value is the behavior
allow(gateway).to receive(:charge).and_return(receipt)
expect(total).to eq(420)

# The message is the behavior
expect(gateway).to receive(:charge).with(amount: 420, currency: 'USD')
invoice.pay
```

When arguments need destructuring, pass a block to `receive` and assert inside it.
Guide: [Verification](../../docs/testing-guide.md#verification) and
[Communication-based](../../docs/testing-guide.md#communication-based).

### Rule 17 (MUST): Use verifying doubles

`instance_double` and `class_double`, not `double`. Pass the constant,
`instance_double(Billing::Gateway)`, so the double always verifies and a missing class
fails the example. The string form, `instance_double('Billing::Gateway')`, verifies only
if the class is already loaded the first time the double is checked, and otherwise that
double stays unverified, as a plain `double` would. Use it only for a class that may be
absent from the test environment, such as an optional dependency, with an inline comment
saying so. A project with no such class can set `verify_doubled_constant_names` in its
spec helper, which makes an unloaded name fail. Plain `double` is allowed, with an
inline comment saying which case applies, as a dummy the example never sends a message
to, when the collaborator is a duck type with no single class to verify against, or when
the class forwards methods through `SimpleDelegator` or `method_missing`, which
verifying doubles reject. Where RSpec/VerifiedDoubles runs, its default ignores a
nameless `double` and flags one given a name. A flagged one carries
`# rubocop:disable RSpec/VerifiedDoubles` at the end of its line, next to that comment;
a nameless one gets no directive, because Lint/RedundantCopDisableDirective reports a
directive that disables nothing. An end-of-line directive covers that line only, so the
cop stays on for every other double. Guide: [Doubles in
RSpec](../../docs/testing-guide.md#doubles-in-rspec).

## Assertions

### Rule 18 (MUST): Error assertions name the class and a message pattern

```ruby
expect { invoice.pay }.to raise_error(Billing::DeclinedError, /card ending 4242/)
```

The block form does not replace the message check; use both. Guide:
[Error assertions without a message pattern](../../docs/testing-guide.md#test-anti-patterns).

### Rule 19 (MUST): Edge cases sit beside the normal case for their condition

`nil`, empty, and boundary values are examples of the condition they are edges of,
not a group at the end of the file. One example per equivalence class, not per
value: when a method treats every string the same way, one string proves it, and a
second string proves nothing. Guide:
[Example-based](../../docs/testing-guide.md#example-based-default).

### Rule 20 (MUST): Assert observable behavior a specific code change would break

A return value, a raised error, a state change, or a message to a collaborator. Before
approving an assertion ask what change would fail only this example; if every other
example would fail first, delete it. `not_to be_nil`, `not_to raise_error`, a test
that a constant exists, or that a namespace is a `Module` all fail this test. So does
an example that re-proves what a collaborator's own spec already proves: assert that
the subject called the collaborator correctly, not that the collaborator works.
Guide:
[Asserting on implementation details](../../docs/testing-guide.md#test-anti-patterns),
[A tautological test](../../docs/testing-guide.md#test-anti-patterns), and
[Change detector](../../docs/testing-guide.md#test-smells).

## Reliability

### Rule 21 (MUST): Every example passes alone and in random order

The project sets `config.order = :random`; RSpec's own default is declaration order,
which never exercises this rule. Where it is set, every run checks the order half. The
alone half needs each example run on its own, which the scope standards' verification
does for each new or changed example. Guide:
[Order dependence](../../docs/testing-guide.md#test-anti-patterns).

### Rule 22 (MUST): No committed focus, skip, or `pending` markers

Focus markers are an `f`-prefixed group or example, such as `fit`, `fdescribe`, or
`fcontext`, and `:focus` metadata. Skip markers are an `x`-prefixed one, such as `xit`,
`xdescribe`, or `xcontext`, an unconditional `skip`, and an `it` with no block, which
RSpec reports as pending and never runs. A focus marker that reaches the main branch
turns the rest of the suite off, and a skip marker is a test that silently stopped
running. A committed `pending` is forbidden for a different reason: the example still
runs and fails once the code starts working, so nothing goes quiet, but the suite
carries a known failure that belongs in the issue tracker. A skip guarded on a stated
condition, such as a dependency older than the feature under test, is not one of these:
it names why it skipped and it runs everywhere the condition holds. Guide: [Committed
skip or focus markers](../../docs/testing-guide.md#test-anti-patterns).

### Rule 23 (MUST): No `allow_any_instance_of`, `receive_message_chain`, or stub on the subject

The first two hide the object boundary, and `allow(subject).to receive` replaces part
of the thing under test. Allowed only when there is no seam and refactoring is out of
scope, with an inline comment and a follow-up to add the seam. Guide:
[Stubbing the subject](../../docs/testing-guide.md#rspec-anti-patterns).

### Rule 24 (MUST): No conditional logic inside an example

An `if`, a loop, or a `rescue` inside an example makes it test different things on
different runs, and the example can itself be wrong. Each branch of the conditional is
its own example, and an expected error is a `raise_error` matcher. Guide: [Conditional
logic in a test](../../docs/testing-guide.md#test-anti-patterns).

### Rule 25 (MUST): No class, module, or constant declared in a spec file

A class or constant declared in a spec file, at the top level or inside a group,
persists into every later example in the process. Build a test class with `Class.new`
in a `let`, and replace a constant with `stub_const`. Guide: [Leaky
constants](../../docs/testing-guide.md#rspec-anti-patterns).

## What the tools check

Where a project runs rubocop-rspec, these rules are enforced mechanically and need no
reading to check: Rule 1 in part (RSpec/DescribeClass for the constant,
RSpec/MultipleDescribes for one top-level group per file), 4 in part
(RSpec/SpecFilePathFormat, for a constant subject outside `spec/routing`), 7
(RSpec/ContextWording), 17 (RSpec/VerifiedDoubles, with the end-of-line directive Rule
17 puts on each permitted exception the cop flags), 18 in part
(RSpec/UnspecifiedException), 22 (RSpec/Focus for the focus markers, and RSpec/Pending
for the skip and `pending` markers once a project enables it, since it is off by
default), 23 (RSpec/AnyInstance, RSpec/MessageChain, RSpec/SubjectStub), and 25 in part
(RSpec/LeakyConstantDeclaration, for a declaration inside an example group). Rules 3 and
6 name their own cop in their bodies, and random ordering checks the order half of Rule
21.

RSpec/DescribeClass does not ask for a constant where Rule 1 asks for a string: its
defaults exempt any spec whose `type` metadata names a Rails spec type, and any file
under `spec/features`, `spec/requests`, `spec/routing`, `spec/system`, or `spec/views`.
The same defaults exempt the Rails specs whose subject is a constant, such as helper,
mailer, job, channel, routing, model, and controller specs, so Rule 1 is read for
those. A project can shrink the cop's `IgnoredMetadata` to the string-subject types,
`request`, `view`, `system`, and `feature`, so it checks helper, mailer, job, channel,
model, and controller specs too.

Some cops touch a rule without checking it. RSpec/MultipleExpectations counts `expect`
calls against `Max` and cannot tell one concept from several. The `have_attributes`
example in Rule 8 is a single call, so the cop passes it. Several `expect` calls that
one change would fail together are also one concept, and the cop flags them; raising
`Max` to let them through lets the eager examples through as well. RSpec/DescribeMethod
checks only the second argument of the top-level `describe`, not the nested
`describe '#method'` blocks Rule 2 requires. RSpec/NestedGroups caps the depth of
nesting and does not check the order Rule 9 sets, so a `context` directly under the
class with `describe '#method'` inside it passes. RSpec/LeadingSubject checks that
`subject` comes first, and RSpec/NamedSubject flags a bare `subject` reference inside an
example, not an unnamed definition, so the named half of Rule 10 is read.
RSpec/InstanceVariable catches instance variables and nothing else in Rule 15: a
`before` that assigns values it should have left to `let` passes. RSpec/ExpectChange
settles the argument style of `change`, not whether a before-and-after assertion should
have been one (Rule 14). RSpec/MessageSpies is on by default in its `have_received`
style, where it flags the `expect(...).to receive` form Rule 16 shows; a project
adopting rubocop-rspec must set `EnforcedStyle: receive` or turn the cop off, or the two
disagree from the first run. RSpec/StubbedMock flags
`expect(...).to receive(...).and_return`, which is one half of Rule 16. Rules 2, 8, 9,
10, 14, 15, 16, and 24 are still read, as is Rule 4 for a string subject or a routing
spec. The project override says which of these run in the project.
