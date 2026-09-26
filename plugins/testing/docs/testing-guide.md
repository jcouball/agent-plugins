# Testing guide

This guide defines a vocabulary for talking about tests and says how to choose which
kind to write. Most of it applies to any test suite in any language. The last
sections show how it maps to Ruby, RSpec, and Rails.

This guide covers tests of functional correctness. Performance, load, and security
tests measure other qualities and are out of scope.

- [Choosing a test](#choosing-a-test)
- [Test doubles](#test-doubles)
- [Test classification](#test-classification)
- [Test types](#test-types)
  - [System tests](#system-tests)
  - [Integration tests](#integration-tests)
  - [Unit tests](#unit-tests)
- [Test attributes](#test-attributes)
  - [Case generation](#case-generation)
    - [Example-based (default)](#example-based-default)
    - [Contract tests](#contract-tests)
    - [Property-based tests](#property-based-tests)
    - [Snapshot tests](#snapshot-tests)
  - [Verification](#verification)
    - [Output-based (default)](#output-based-default)
    - [State-based](#state-based)
    - [Communication-based](#communication-based)
  - [Audience](#audience)
    - [Developer-facing (default)](#developer-facing-default)
    - [Acceptance tests](#acceptance-tests)
  - [Purpose](#purpose)
    - [Specification (default)](#specification-default)
    - [Regression tests](#regression-tests)
    - [Characterization tests](#characterization-tests)
  - [When it runs](#when-it-runs)
    - [Every change (default)](#every-change-default)
    - [Inner loop](#inner-loop)
    - [Scheduled](#scheduled)
    - [Pre-release](#pre-release)
    - [Post-deploy](#post-deploy)
- [Named combinations](#named-combinations)
- [Test data](#test-data)
- [Test anti-patterns](#test-anti-patterns)
- [Test smells](#test-smells)
- [Ruby and RSpec](#ruby-and-rspec)
  - [Unit test shapes](#unit-test-shapes)
    - [Class unit tests](#class-unit-tests)
    - [Module and mixin unit tests](#module-and-mixin-unit-tests)
    - [Module method unit tests](#module-method-unit-tests)
  - [Structure and naming in RSpec](#structure-and-naming-in-rspec)
  - [Doubles in RSpec](#doubles-in-rspec)
  - [Verification in RSpec](#verification-in-rspec)
  - [Gems](#gems)
  - [Anti-patterns and smells in RSpec](#anti-patterns-and-smells-in-rspec)
    - [RSpec anti-patterns](#rspec-anti-patterns)
    - [RSpec smells](#rspec-smells)
- [Rails spec types](#rails-spec-types)
  - [Model specs](#model-specs)
  - [Request specs](#request-specs)
  - [Feature and system specs](#feature-and-system-specs)
  - [Job specs](#job-specs)
  - [Mailer specs](#mailer-specs)
  - [Helper specs](#helper-specs)
  - [Routing specs](#routing-specs)
  - [View specs](#view-specs)
  - [Channel specs](#channel-specs)
  - [Controller specs](#controller-specs)
  - [Generator specs](#generator-specs)
  - [Anti-patterns and smells in Rails specs](#anti-patterns-and-smells-in-rails-specs)
    - [Rails anti-patterns](#rails-anti-patterns)
    - [Rails smells](#rails-smells)

## Choosing a test

The rest of this guide explains the choices. This is the order to make them in.

1. **Scope.** Start at unit. Move to integration only if the behavior cannot be
   observed with collaborators doubled, or if a unit test's stubs assume something a
   real collaborator must confirm. Move to system only if no narrower test can answer
   the question. See [Test types](#test-types).
2. **Verification.** Assert on the return value. If the method's job is a side
   effect, assert on the state it changed. Use a mock only when the message to a
   collaborator is the behavior and nothing in the process records it. See
   [Verification](#verification).
3. **Doubles.** Under the default solitary school, stub every non-trivial
   collaborator with a verifying double. Under the sociable school, if the project's
   override file chooses it, use real in-process collaborators and double only what
   is slow, non-deterministic, or outside the process. Either way, pass strings,
   hashes, and other plain values as they are, and reach for a fake when the
   collaborator's state is what the test reads. See [Test doubles](#test-doubles)
   and [Unit tests](#unit-tests).
4. **Cases.** One example per conditional path, chosen by equivalence class and
   boundary. If the input space is large and structured, consider a property. If the
   expected output is large and structured, consider a snapshot. See [Case
   generation](#case-generation).
5. **Data.** Build inputs inside the example, as small as the case allows, with
   values that make the assertion obvious. See [Test data](#test-data).
6. **Purpose.** If the test pins a bug, name the issue. If it records existing
   behavior with no claim it is right, say so and plan to promote or delete it. See
   [Purpose](#purpose).
7. **Check.** Read the example's description against the assertion, then read the
   [anti-patterns](#test-anti-patterns) and [smells](#test-smells)
   lists once.

## Test doubles

The vocabulary is Meszaros' from xUnit Test Patterns. The rest of this document uses
these terms instead of the generic "double" wherever the difference matters.

- **Dummy.** Passed to satisfy a signature and never used.
- **Stub.** Returns canned answers to calls made during the test, and never fails a
  test by itself.
- **Spy.** A stub that also records the calls it received so the test can assert on
  them after the action.
- **Mock.** Programmed before the action with the calls it expects, and fails the
  test if they do not arrive.
- **Fake.** A working implementation that takes a shortcut unsuitable for production,
  such as an in-memory store standing in for a database. Written by hand, not with a
  mocking library.

A verifying double is a stub, spy, or mock that checks each stubbed or expected
message against the real class's interface. That check is what makes a unit test's
doubles trustworthy without an integration test.

In everyday speech, and in the name of RSpec's rspec-mocks library, "mock" means any
double. This guide keeps the strict meaning above, because the difference between a
stub and a mock is the difference between two verification styles.

## Test classification

Every test has a position on each of six dimensions. **Scope** says how much real
code runs per test. **Case generation** says where the test cases come from.
**Verification** says what the test inspects to decide whether it passed.
**Audience** says who the test text is written for. **Purpose** says what claim the
test makes about the code. **When it runs** says at what point in the development
cycle a failure is seen. The first five are independent of each other; the sixth
follows from the cost the others impose.

This is a faceted classification, not a tree. A test is described by one value from
each dimension rather than by a single place in a hierarchy, which is why a unit test
can also be property-based and a contract test can be a unit test or an integration
test depending on the implementers.

## Test types

Scope is how much real code runs in one test and where the doubles sit. The three
values are **system**, **integration**, and **unit**, from most real code to least.
Scope sets a test's cost, how precisely a failure points at the fault, and whether
the test counts toward the coverage gate. Use the narrowest scope that can prove the
claim. Every step outward costs speed, makes a failure point at more code, and moves
the test out of the coverage gate, so a claim a unit test can prove is proved there
and nowhere else. A test moves outward to integration or system for one of two
reasons: the behavior it checks cannot be observed with collaborators doubled, or a
unit test's stubs assume something about a real collaborator that only running the
real collaborator can confirm.

Cohn's test pyramid is the usual picture of the result: many unit tests, fewer
integration tests, few system tests, because cost rises and failure precision falls
as scope widens. Dodds' testing trophy argues for a wider integration layer on the
ground that tests with real collaborators catch more bugs per test. Which shape a
suite ends up with follows from the choice of unit test school, described under [Unit
tests](#unit-tests).

Each type follows the same template. Attribute values with conventions of their own,
such as contract tests and acceptance tests, use it too.

- **Definition.** What the test exercises.
- **Real and doubled.** Which code runs for real, which collaborators are doubled,
  and whether the test touches external state such as the filesystem or a subprocess.
  For attribute values this heading is **Scope**, and says where the scope comes
  from. The vocabulary under [Test doubles](#test-doubles) names the doubles.
- **When to choose it.** The situation that calls for this type rather than a
  neighbor.
- **What it proves.** The evidence a passing test gives, and what it does not give.
- **Cost.** Speed, flakiness risk, and setup burden.
- **Anti-patterns.** Ways a test of this type drifts into another type or stops
  proving what it claims. Generic testing mistakes that apply to every type, such as
  order dependence or asserting on implementation details, are listed once under
  [Test anti-patterns](#test-anti-patterns).

### System tests

**Definition.** A system test drives the whole application from the outside, the way
a user or a calling process would. For a library, it calls the public API against
real external state and asserts on the resulting state. Rails and ISTQB say system
test; Fowler, Khorikov, and most writing about web applications say end-to-end test.
They mean the same thing.

**Real and doubled.** Everything is real: every class, every dependency, the
database, the filesystem, the network, the browser or the command-line entry point.
Nothing is doubled.

**When to choose it.** When the question is "does the shipped software do the job",
and no narrower test can answer it because the behavior depends on how all the pieces
fit together. Also when a bug escaped every narrower test and the fix needs a
regression test at the level where the bug was visible.

**What it proves.** That a specific end-to-end path works in an environment like the
one users have. It does not prove which component is at fault when it fails, and it
does not prove the path works under conditions the test did not set up.

**Cost.** Slowest to run and most sensitive to the environment. Setup usually means
provisioning real state and tearing it down. A small number covering the main paths
is usually the right amount.

**Anti-patterns.** Using system tests as the primary way to cover conditional paths,
so the suite is slow and a failure takes a long time to localize. Asserting on
internal calls or intermediate state instead of the observable outcome. Depending on
state left by an earlier test.

### Integration tests

**Definition.** An integration test runs several real components together across a
boundary that unit tests replace with doubles, without covering the whole system. The
typical case is a high-level method that calls a lower-level class which in turn
talks to an external process or service.

The term is the most overloaded in testing. Fowler splits it into narrow integration
tests, two components with everything else doubled, and broad ones, a live-like slice
of the whole system. Khorikov uses it for any automated test that is not a unit test,
which includes what this guide calls system tests. The meaning here sits between
Fowler's two: more than two real components, a real dependency at the far end, and
short of the whole application.

**Real and doubled.** The classes in the path under test are real, and so is the
external process, service, or filesystem at the far end of the path. Doubles, if any,
sit at the outermost edge to cut off parts of the system that are not under test. The
test owns any external state it creates: it builds that state inside the example, in
a place no other example can reach, and removes it when the example ends whether the
assertions passed or not. No test reads state it did not create, and no test writes
to state that others read.

Owning the state means owning the environment around it, and the environment is wider
here than for a unit test. Anything the process shares, the working directory and the
environment among it, is read by every thread in that process, so a test that changes it
is not isolated however carefully it restores it. Anything the test reads but did not
create, including a file left where other tests reach it, is a result it cannot account
for; a fixture read and never written is input rather than state, and [Test
data](#test-data) says when one earns its place. And the dependency at the end of the
path is a program, not a library: what it does varies by version and by platform, so a
test that does not pin what it takes from the machine is measuring the machine, and a
suite whose coverage depends on the version that happens to be installed is measuring it
too.

**When to choose it.** When the risk is in a seam: wrong argument order between two
layers, a return shape one layer produces and the next misreads, an encoding
assumption that holds in one place and not another. Unit tests cannot find these
because each side of the seam is doubled from the other's point of view.

Also to confirm what a unit test's stubs assume. A stub encodes a belief about what
the real collaborator returns, and a verifying double checks only that the method
exists, not what it returns. Rainsberger calls the unit tests collaboration tests and
the tests that confirm their stubs contract tests; one integration test per stubbed
return shape is what keeps a solitary unit suite honest. Without it, a stub can
describe a value the collaborator never produces while both suites stay green. Under
the sociable school there are fewer stubs, and this reason applies only to the doubles
that remain.

**What it proves.** That the layers in the path agree with each other and with the
real dependency at the end. It does not prove each layer's conditional paths; that is
unit test work, and duplicating it here makes the suite slow for no added confidence.

**Cost.** Slower than unit tests, faster than system tests. Setup that touches a
subprocess or the filesystem is a frequent source of order dependence and flakiness.

**Anti-patterns.** Covering conditional paths that a unit test already covers.
Leaving external state behind for the next test to trip over. Stubbing a layer in the
middle of the path, which removes the seam the test exists to check while still
paying the integration-test cost.

### Unit tests

**Definition.** A unit test exercises one unit, a class or module, through its public
interface, with collaborators doubled as the unit test school in force requires.

Two schools disagree about the doubling, and Fowler names the styles. A solitary unit
test replaces every collaborator with a double; this is the London or mockist school.
A sociable unit test uses real in-process collaborators and doubles only what is
slow, non-deterministic, or outside the process; this is the classical or Detroit
school. Khorikov argues for sociable tests, because doubles for in-process
collaborators couple the test to the implementation.

The default in this guide is solitary. A suite that must prove every conditional path
in every unit needs failures that point at one unit, and a sociable test spreads a
failure across every class in the call chain. The cost is the coupling Khorikov
describes, and the [Verification](#verification) dimension limits it by reserving
mocks for messages that are the behavior under test.

**Unit test school** is the override point. A project that chooses sociable tests
states it in its override file, and the entries that depend on the school, marked
below and under [Choosing a test](#choosing-a-test) and
[Integration tests](#integration-tests), say what changes. Nothing else in this guide
depends on the choice.

**Real and doubled.** The unit under test is real. Verifying stubs replace
non-trivial collaborators, meaning anything with behavior worth testing on its own. A
mock replaces a collaborator only when the message to it is the behavior under test,
as the [Verification](#verification) dimension explains. Trivial values such as
strings, hashes, arrays, and other standard library objects with no behavior of their
own are passed in as they are; doubling them adds noise without adding isolation. No
external state: no filesystem, no subprocess, no network, no clock.

Under the sociable school, real in-process collaborators take the place of the stubs.
Doubles remain for anything slow, non-deterministic, or outside the process, and the
rules on trivial values and external state are unchanged.

**When to choose it.** For every conditional path in the unit. This is the default
scope, and the question "which scope should this test be" starts here. It moves
outward only for one of the two reasons given under [Test types](#test-types).

**What it proves.** That the unit does the right thing given what its collaborators
return, for every conditional path. It does not prove that the collaborators return
that, or that the doubles match the real interface beyond what verifying doubles
check. Those are integration-test facts.

The unit tests alone must reach 100% line and branch coverage of the code they cover.
Integration and system tests add confidence about seams and environments, but they do
not count toward that gate, and a branch that only an integration test reaches is a
gap in the unit tests. Coverage says a line ran, not that a test would fail if the
line were wrong. Mutation testing answers that second question by changing the code
and checking that some test fails. It is the check to reach for when 100% coverage
feels unearned.

**Cost.** Fast, deterministic, and cheap to set up. Failures point at one unit.

**Anti-patterns.** Reaching a real external dependency, which turns the test into an
integration test with a unit test's name and none of its isolation. Stubbing the unit
under test itself. Testing private methods directly instead of through the public
method that calls them.

## Test attributes

An attribute is a value on one of the five dimensions other than scope. Scope is the
dimension a suite is organized by and a directory is named for, so its values are the
test types. A test has one value on each of the other five, and none of them changes
what the test is called. Where an attribute value has conventions of its own it uses
the template under [Test types](#test-types); where it is a choice and nothing more,
its entry is a paragraph.

### Case generation

Case generation is how the concrete test cases come to exist. The default is
example-based. Each alternative changes one part of an example-based test: contract
tests vary the subject, property-based tests vary the inputs, and snapshot tests
record the expected output instead of having the author write it. None has a scope of
its own. Contract tests answer a different question from the other two, how many
subjects the examples run against rather than where the expected values come from, so
a set of shared examples can itself be property-based or snapshot-based. When it is,
the test takes the value that describes its expected values, and the contract is a
fact about how it is run.

#### Example-based (default)

An example is one concrete case: a specific input and a specific expected output that
the author wrote out, one example each. The author also chose which cases exist at
all, so every case is one the author thought of. This is the baseline the rest of the
document assumes.

Three techniques from the testing literature answer "which cases". Equivalence
partitioning divides the input space into classes the code treats alike and takes one
example from each. Boundary value analysis adds the values at each class's edges,
where off-by-one mistakes live: zero, one, the maximum, one past it. Decision tables
enumerate the combinations of conditions a method branches on so that no combination
is skipped. Together they turn "I thought of these cases" into "these are the cases,
and here is why there are no others".

A boundary case lives beside the normal case for the same method and condition, not
in a separate group of edge cases at the end. The reader should see a class and its
edges together, and a group named "edge cases" says nothing about which condition
each one is an edge of.

#### Contract tests

**Definition.** Contract test has two established meanings. In Rainsberger's usage, a
contract test is a set of shared examples that every implementation of an interface
must pass, run once against each implementer. In the Pact usage, a consumer-driven
contract test replays a consumer's recorded expectations against a real provider.
Both run one set of expectations against more than one subject, which is what places
them here. On the case-generation dimension a contract test keeps example-based
inputs but varies the subject.

**Scope.** Inherited from the implementers. Shared examples run against plain classes
with stubbed collaborators are unit tests and count toward the coverage gate. The
same shared examples run against adapters that each hit a real backing store, or a
consumer's expectations replayed against a real provider, are integration tests.

**When to choose it.** When several classes must be interchangeable behind one
interface and a caller written against one of them has to work against all of them.
The shared examples make the interface explicit and catch an implementer that drifts.

**What it proves.** That each implementer meets the shared interface. It does not
prove behavior specific to one implementer; that goes in the implementer's own tests.

**Cost.** The cost of the inherited scope, once per implementer, plus the discipline
of keeping the shared examples in one place.

**Anti-patterns.** Letting one implementer skip examples it finds inconvenient, which
means the interface no longer has a contract. Putting implementer-specific assertions
in the shared examples with conditionals to skip them for the others. Mixing
unit-scope and integration-scope implementers in one run, so the slowest implementer
sets the suite's speed and flakiness.

#### Property-based tests

**Definition.** A property-based test states a property that should hold for all
inputs, such as "parsing then serializing returns the original value", and lets a
library generate many inputs to check it. On the case-generation dimension it keeps
one subject but replaces example-based inputs with generated ones.

**Scope.** Inherited from what the property spans. A property on a pure function or a
class with stubbed collaborators is a unit test. A property that round-trips a value
through a real external process is an integration test. System-scope property tests
exist but are rare because each generated case pays the full system cost.

**When to choose it.** When the input space is large and structured, such as parsers,
serializers, and arithmetic on domain values, and example-based tests would miss edge
cases. Round-trip and invariant properties are the common shapes.

**What it proves.** That the property held for the generated inputs. It does not
prove the property for all inputs, and without a fixed seed it does not prove the
same thing on two runs.

**Cost.** The inherited scope's cost multiplied by the number of generated cases.
Failures are harder to read until the library shrinks the failing input. Random input
is a flakiness source unless the seed is fixed or recorded.

**Anti-patterns.** Writing a property that restates the implementation, so it can
only fail if the code disagrees with itself. Leaving the seed unfixed and then
ignoring intermittent failures.

#### Snapshot tests

**Definition.** A snapshot test runs the subject once, records its output to a file,
and on later runs compares the output to the recording. The author writes the input
but not the expected output; the first run supplies it and the author approves it.
Also called approval tests.

A recorded HTTP response replayed to the subject is not a snapshot. It is a recorded
stub. A snapshot records the subject's output; a recorded stub replaces one of its
inputs.

**Scope.** Inherited from what produces the output. A snapshot of a pure formatter's
return value is a unit test. A snapshot of a report generated from a real database is
an integration test.

**When to choose it.** When the expected output is large and structured, such as
rendered documents, serialized trees, or long parser output, and writing the expected
value by hand would be slower and less accurate than reviewing a recording.

**What it proves.** That the output has not changed since someone approved it. It
proves nothing about whether the approved output was correct; that judgment happened
at approval time and left no trace in the test.

**Cost.** Cheap to write. Expensive to review, because every intended output change
produces a diff someone must read and re-approve, and a reviewer who approves without
reading turns the test into one that can never fail.

**Anti-patterns.** Approving a changed snapshot without reading the diff.
Snapshotting output that contains timestamps, object ids, or anything else that
varies between runs. Using a snapshot where a few targeted assertions would say what
matters about the output.

### Verification

Verification is what the test inspects to decide whether it passed. Meszaros splits
it into state and behavior verification; Khorikov splits state further into output
and state. The choice is made per example and is available at every scope. It is the
main source of tests that break on refactors which change nothing observable, so the
default matters.

#### Output-based (default)

The test calls the subject and asserts on the return value. Collaborators, if any,
are stubs that supply inputs. This is the least coupled form: a refactor that
preserves the return value cannot break it. Choose it whenever the method's job is to
compute something. Prefer it over the other two whenever it is available.

#### State-based

The test calls the subject and asserts on state afterward: the subject's own
attributes, the contents of a collaborator, a file on disk. Choose it when the
method's job is a side effect and the side effect has a state the test can read. The
test is coupled to whatever holds the state. A fake keeps that coupling inside the
test; asserting on a real collaborator's internals leaks it into the test suite.

#### Communication-based

The test asserts that the subject sent particular messages to a collaborator, using a
mock set before the action or a spy checked after it. Choose it only when the message
itself is the observable behavior, which is the case when the collaborator is a
boundary to the outside world, such as a subprocess, an HTTP service, or a logger,
and nothing inside the process records that the call happened.

The anti-pattern is mocking an in-process collaborator whose return value or
resulting state the test could have asserted instead. That test passes when the
implementation matches the author's mental model of the call sequence and fails when
a refactor changes the sequence without changing any result.

### Audience

Audience is who the test text is written for. It has two values. The default is the
developer who will read the test when it fails or when the code changes. The
alternative is the user or stakeholder who asked for the behavior and needs to
confirm that what was built is what they meant.

#### Developer-facing (default)

The test text is written for a developer: groups are named for a class or method,
examples describe a behavior in implementation terms, and both assume the reader can
read the code. Every test in this document other than acceptance tests is
developer-facing.

#### Acceptance tests

**Definition.** An acceptance test describes behavior in the language of the people
who asked for it rather than the language of the code. Also called an executable
specification. Cucumber is the best-known implementation. It is the user-facing value
on the audience dimension.

The word has wider meanings elsewhere. Freeman and Pryce use it for the end-to-end
test a developer writes first for each feature, in code, with no business-language
layer. ISTQB uses acceptance testing for a phase near release, whoever wrote the
tests. This guide uses the narrower BDD meaning because audience is what this
dimension measures; the other two meanings are system tests on the scope dimension.

**Scope.** Inherited from what the steps drive, which is almost always the whole
application, so system scope in practice.

**When to choose it.** When the people who own the requirements need to read the
tests, and the test text is how they confirm that what was built is what they asked
for.

**What it proves.** The same as a test at the inherited scope, in a form a
non-developer can review. The audience changes who can check the test, not what it
proves.

**Cost.** The inherited scope's cost plus the overhead of keeping the
natural-language layer in step with the code.

**Anti-patterns.** Writing acceptance tests that no non-developer reads, which pays
the translation cost for nothing. Encoding UI mechanics in the step text so the tests
break on every layout change.

### Purpose

Purpose is the claim a test makes about the code and when the test was written
relative to it. The default is specification. The alternatives inherit scope, case
generation, and verification from however they are written; a regression test can be
a unit test or a system test. Purpose rarely changes how a test is written. It
changes what a reviewer checks and what a later maintainer may delete: a
specification test goes when the behavior is removed, a regression test when the
pinned issue no longer applies, a characterization test when the change it enabled
has shipped.

#### Specification (default)

The test states what the code is supposed to do, written before or alongside the
code. This is the TDD case, and every example in the unit suite is a specification
test unless it says otherwise. When one fails, either the code is wrong or the
specification changed, and the reviewer decides which.

#### Regression tests

A regression test pins a bug that was found and fixed. It is written after the bug,
reproduces it before the fix, and passes after. It names the issue it pins so a later
reader can decide whether the behavior still matters. A regression test that never
failed before the fix proves nothing about the bug. One that pins the fix's
implementation rather than the observable behavior the bug broke will fail on the
next refactor and be deleted, taking its protection with it.

Standards bodies use regression testing for re-running an existing suite after a
change, a sense in which every passing test is a regression test. This guide uses the
narrower meaning, the test added with a bug fix, which is what "add a regression
test" asks for in a code review.

#### Characterization tests

A characterization test records what existing code does today, with no claim that the
behavior is correct. Feathers' term, from Working Effectively with Legacy Code. It is
written before changing code that has no specification, so the change can be checked
against the prior behavior. Snapshot tests are the usual case-generation choice. Once
the change ships, a characterization test that is still useful should be promoted to
a specification test, with the author confirming the behavior is intended. Otherwise
it is deleted, because a test that asserts "whatever it did before" will block the
next intentional change with a failure no one can interpret.

### When it runs

When it runs is the earliest point in the development cycle at which a test's failure
blocks something. A test may also run earlier as a convenience, from the editor or in
a filtered run, but its value is the first stage that gates on it. The default is
every change. The values run in order of how far a change has traveled before the
test catches it, from the developer's editor to production. Humble and Farley's
Continuous Delivery organizes the deployment pipeline around this dimension, and
Google's small, medium, and large test sizes exist to decide it.

A test's position here follows from its cost. Anything fast and deterministic runs on
every change. A test moves later only because it is too slow, too flaky, or needs an
environment that does not exist earlier. Moving a test later is a cost accepted, not
a category chosen, and the test should say what forced it.

#### Every change (default)

The test runs on every push and blocks the merge if it fails. This is the commit
stage. Every unit test belongs here, and so does every integration test that finishes
in seconds and owns its own state.

#### Inner loop

A subset the developer runs from the editor while working: one file, one group, or
one tag. It is not a separate suite but a filter over the every-change suite, chosen
for speed. The trap is a test that only ever runs in the inner loop because someone
tagged it out of the full run and forgot.

#### Scheduled

The test runs on a timer, nightly or weekly, rather than on a change. It goes here
when it is too slow for every change, when it depends on an external service whose
outages should not block merges, or when its inputs vary over time, such as a test
against the latest release of a dependency. A scheduled failure has no commit to
blame, so the test must report enough to find the cause without one.

#### Pre-release

The test runs against the packaged artifact just before it is published: installing
the built gem into a clean environment and requiring it, or running the system suite
against a release candidate. It catches packaging mistakes that no test of the source
tree can see, such as a file missing from the gemspec or a runtime dependency listed
only under development.

#### Post-deploy

The test runs against the released artifact in the environment users have: a smoke
test that installs the published gem and calls its entry point, or synthetic
monitoring that exercises a live service. It catches what only production reveals and
is the last test whose failure can trigger a rollback.

## Named combinations

Some terms in common use name a position across several dimensions rather than a
value on one. Each entry gives the coordinates, then whatever the coordinates do not
capture.

- **The default test.** Unit scope, example-based, output-verified, developer-facing,
  a specification, and runs on every change. This is what a test is unless something
  in it says otherwise, and it is the position every other entry in this guide is
  measured against.
- **Smoke test.** System or integration scope, output- or state-verified, and run at
  the first stage that gates anything. What the coordinates do not capture is the
  assertion: a smoke test checks only that the thing under test is there and answers.
  At system scope it loads the built artifact and calls its main entry point. At
  integration scope it checks that a real collaborator is present before the suite
  that depends on it runs: the external binary is on the path, the database accepts a
  connection, the fixture exists. There is no unit smoke test, because a unit has
  nothing to be up. A smoke test that grows assertions has become an ordinary test at
  its scope and should be moved into that suite.
- **Sanity test.** ISTQB's term for a quick check, after a change, that the changed
  area still works before the full suite runs. Regression purpose, inner-loop
  when-it-runs, and the smallest assertion that would catch the change being wrong.
  It is the smoke test's sibling and the two are often swapped: a smoke test asks
  whether the build is alive, a sanity test asks whether the change did what it was
  meant to. A sanity test is a filter over existing tests, not a test written for the
  purpose, so nothing in a suite is written as one.
- **Golden master.** Snapshot case generation with characterization purpose. The
  author records the output of existing code and approves it as it stands, with no
  claim that it is correct, so that a change can be checked against it. The
  characterization entry's promote-or-delete rule applies.
- **Learning test.** Integration scope, example-based, characterization purpose, and
  the subject is a third-party library or external tool rather than the code being
  developed. Feathers' and Beck's term for a test written to find out what a
  dependency does. It is where the author discovers the assumptions a unit test's
  stubs will encode, and once the unit tests exist it can stay as the contract test
  that confirms those stubs.
- **Component test.** Fowler's term for an integration test with a fixed doubling
  boundary: everything inside one deployable is real and every external service is
  doubled. It is the narrow integration test of the integration entry's terminology
  note, made concrete.
- **Parameterized test.** Also called table-driven. Example-based case generation
  with the examples listed in a table and one example generated per row. Still
  example-based, since a person chose every row; the table is a way to apply the
  three design techniques under example-based without writing each case by hand. A
  loop of expectations inside one example is the wrong way to write one, as the RSpec
  smells list says.
- **Visual regression test.** Snapshot case generation at system scope, where the
  recorded output is a screenshot and the comparison is an image diff. Regression or
  characterization purpose. It shows that snapshot is a case-generation choice and
  not a scope.
- **Fuzz test.** Generated inputs as in a property-based test, but the generator is
  adversarial rather than structured and the only property is that the subject does
  not crash or hang. Its purpose is robustness rather than correctness, which puts it
  at the edge of this guide's scope, and it is usually classed with security testing.

## Test data

Test data is the input a test builds and the state it arranges before the action.
Most of the time spent writing a test goes here, and most Mystery Guests start here.
The rules below hold at every scope.

- **Build it in the example.** The reader should see every value the assertion
  depends on without leaving the example or its enclosing group. Setup that lives in
  a helper, a fixture file, or a shared context is a Mystery Guest unless the name
  says what it holds.
- **Build the minimum.** Include only the fields and records the case needs. A test
  that constructs a full object when the method reads one attribute hides which
  attribute matters and breaks when an unrelated field changes.
- **Make values obvious.** Meszaros' term. Choose inputs that make the expected
  output self-evident, and distinct sentinel values where the test checks that a
  value flowed through: `'input-a'` and `'input-b'` rather than two realistic strings
  a reader has to compare character by character. Realism belongs in integration and
  system tests, where the real dependency will reject unrealistic data.
- **Name what matters.** An input named for its role in the case, `expired_token`
  rather than `token1`, tells the reader why the value is there. Name the difference
  between two inputs, not the inputs.
- **Use a builder for the rest.** When an object needs many fields to be valid and
  the test cares about one, a builder or factory supplies defaults so the example
  states only the field under test. Pryce's Test Data Builder and the Object Mother
  pattern are the two standard shapes; factory_bot is the Ruby implementation of
  both. The smell to watch for is a factory whose defaults grow until every test
  depends on them.
- **Keep it deterministic.** No `Time.now`, no `rand`, no sequence counters that
  depend on how many objects were built before. A value that differs between runs is
  a failure that differs between runs.
- **Files only when the shape is the point.** A fixture file is right when the input
  is large and structured, such as captured output from an external tool, and the
  file's name says what it contains. Read it in the example so the dependency is
  visible. It is wrong for any input a few lines of code could build.

## Test anti-patterns

An anti-pattern is a way of writing a test that is always worse than a known
alternative. Each entry names the alternative. These apply at every scope, so the
per-type sections above do not repeat them.

- **Asserting on implementation details**, such as which private method ran or which
  collaborator method was called, when the observable result is what matters. Assert
  on the result.
- **Order dependence.** A test that passes only when another test ran first, or fails
  only when run alone. Every example sets up what it needs.
- **Mutating process or global state**, such as environment variables, the working
  directory, or global configuration. Inject the value instead so the test never
  touches the global. When the code under test exists to read that state and has no
  seam, change it inside a hook that restores it even when the example fails. Even
  restored, the mutation is visible to any thread running in the process at the time,
  including threads started by an earlier example, so this is a last resort.
- **Non-determinism** from the clock, random values, the order a directory listing
  returns, or thread timing that the test does not control. Fix the seed, inject the
  clock, sort the listing, and synchronize on an event rather than a delay.
- **Conditional logic in a test.** An `if`, a loop, or a `rescue` inside an example
  means the example tests different things on different runs and can itself be wrong.
  Each branch of the conditional is its own example.
- **A tautological test.** Asserting that a stub returned what it was stubbed to
  return, or that a mock received the arguments the test just passed in. The test
  cannot fail. Assert on what the subject did with the value.
- **Testing the framework or a library.** Asserting that a standard library method or
  a dependency behaves as documented. Test what the subject does with the result.
- **A description that does not match the assertion.** The description is what a
  reader trusts when the example is collapsed or listed in a failure report.
- **Error assertions without a message pattern.** Checking the class alone lets a
  different failure with the same class pass. Match the class and a message pattern.
- **Committed skip or focus markers.** An unconditional pending example that never
  gets un-pended is a test that silently stopped running. A focus marker that reaches
  the main branch turns off the rest of the suite. Both are review findings, not
  style. A guard that skips on a stated condition, such as a dependency older than the
  feature under test, is not one of these: it names why it skipped and it runs
  everywhere the condition holds.
- **Test logic in production code.** A code path, setter, or environment check that
  exists only so a test can reach something. A seam added for testability must be a
  real improvement to the design, such as a parameter with a sensible default, not a
  hook.

## Test smells

A smell is a symptom, not a verdict. Each of these is usually a sign of one of the
anti-patterns above or of a design problem in the code under test, but each has a
legitimate case, so a reviewer who sees one asks why rather than requests a change.
The names are Meszaros' where he has one.

- **Mystery Guest.** The example depends on a fixture file, a shared constant, or
  setup defined far from it, so the reader cannot see what the input is. Legitimate
  when the input is large and the file's name says what it holds.
- **General Fixture.** Setup that runs for every example whether or not the example
  uses it. Slows the suite and hides which inputs matter. Legitimate when every
  example in the group needs it.
- **Eager Test.** One example exercises several methods of the subject, so a failure
  does not say which one broke. Legitimate for a short sequence whose steps have no
  meaning alone.
- **Happy path only.** Every example passes valid input and no example shows what the
  subject does when given bad input or when a collaborator fails. Legitimate only for
  code with no failure modes, which is rare.
- **Sensitive Equality.** Asserting on a string rendering of an object, or on a whole
  large structure, when one field is the behavior under test. Fails on formatting
  changes. Legitimate when the rendering is the behavior, as in a formatter or a
  snapshot.
- **Change detector.** A test that mirrors the implementation step by step, fails on
  every refactor, and has never caught a bug. Usually a communication-based test that
  should have been output-based. Legitimate almost never; it is listed as a smell
  only because it takes a history of failures to recognize.

## Ruby and RSpec

Everything above holds for any language and framework. This section maps it to Ruby
and RSpec: the shapes a unit takes, the constructs behind the doubles and
verification vocabulary, the gems that implement the less common types, and the
anti-patterns and smells RSpec makes easy.

### Unit test shapes

A Ruby unit is a class, a module mixed into a host, or a module holding functions.
The three shapes share the contract under [Unit tests](#unit-tests) and differ only
in what the subject is and how it is set up.

#### Class unit tests

**Definition.** A class unit test exercises one class through its public interface.
The spec has one top-level `describe` for the class and one nested `describe` per
public method, and the spec file's path mirrors the source file's path, so the spec
for any class can be found without searching. The file loads the suite's helper and
the source file under test and nothing else. Every other require is a coupling: a
rename or move elsewhere in the codebase breaks a spec that never tested that code.

**Real and doubled.** Only the class under test is real. Non-trivial collaborators
are stubbed and trivial values are passed in as they are, as described under [Unit
tests](#unit-tests). No external state.

**When to choose it.** When the code under test is a class. This is the shape most
units take and the one the other two are measured against.

**What it proves.** That the class does the right thing given what its collaborators
return, for every conditional path.

**Cost.** Fast, deterministic, and cheap to set up. Failures point at one class.

**Anti-patterns.** Constructing the subject differently in different `describe`
blocks so that a failure depends on which block it is in. Letting `let` definitions
for one method's inputs leak into another method's `describe`.

#### Module and mixin unit tests

**Definition.** A mixin unit test covers a module written to be included or extended
into a host class. The module has no instances of its own, so the subject is a host
object, and the tests assert on the behavior the mixin adds to that host.

**Real and doubled.** The module is real. The host is either a real class that
includes the module or a minimal anonymous class created in the spec. Everything else
follows the shared unit test contract: non-trivial collaborators stubbed, trivial
values passed in as they are, no external state.

**When to choose it.** When the code under test is a module rather than a class, and
its behavior only exists in combination with a host. Choose a real includer when the
module depends on the host's other methods. Choose an anonymous class when the real
includer pulls in dependencies the module itself does not need.

**What it proves.** That the module adds the specified behavior to a host. With an
anonymous host it does not prove the module works with any particular real includer;
with a real host it does not prove the module works with any other.

**Cost.** Same as a class unit test. An anonymous host adds a few lines of setup per
spec file.

**Anti-patterns.** Testing the host class's own behavior in the module's spec, so the
same assertions live in two files. Building an anonymous host so elaborate that it is
a second implementation of the real includer. Asserting that a method is defined
rather than that it behaves correctly.

#### Module method unit tests

**Definition.** A module method unit test covers methods defined directly on a module
with `def self.` or `module_function`. This is the usual shape for a utility
namespace or a pure function library.

**Real and doubled.** The module is real and is the subject. Non-trivial
collaborators are stubbed, trivial values are passed in as they are, and there is no
external state, as for a class unit test.

**When to choose it.** When the code under test is a set of module-level functions
with no instance. If the functions share state or need configuration, that is a sign
they want to be a class, and the test type should follow.

**What it proves.** That each function returns the right value or raises the right
error for each conditional path over its inputs. Because the functions are usually
pure, this is often the shape with the fewest doubles.

**Cost.** Same as a class unit test.

**Anti-patterns.** Sharing mutable module state between examples. Testing a
`module_function` through an includer, which mixes this shape with a mixin test and
muddies what failed.

### Structure and naming in RSpec

The shapes above are written in RSpec's three nested groups. `describe` names what is
tested: the class at the top, then one block per public method, prefixed `#` for
instance methods and `.` for class methods. `context` names a condition, and its
description starts with "when", "with", or "without" so that the nesting reads as a
sentence. `it` states one expected behavior, in words that match the assertion. A
method with a single path and no conditions worth naming puts its `it` directly
under `describe`.

Lazy evaluation means declaration order carries no meaning for RSpec: a `let` may be
defined after the `subject` that uses it and still resolve. So the order a spec is
written in is a convention kept for the reader, who should meet the call under test
before its inputs, and see a condition change only the input it is about. A `subject`
buried under its inputs, or a `context` that redefines everything, hides what the
example is about. Writing the construction once, where several methods build the
instance the same way, is that argument applied to change: one place to edit when the
constructor moves.

### Doubles in RSpec

The construct that produces each kind of double under [Test doubles](#test-doubles):

- **Dummy.** A bare `double` or `nil`.
- **Stub.** `allow(obj).to receive(:msg).and_return(value)`.
- **Spy.** `have_received`, checked after the action runs.
- **Mock.** `expect(obj).to receive(:msg)`, set before the action runs.
- **Fake.** A hand-written class. RSpec has no construct for it.

`instance_double`, `class_double`, and `object_double` make a stub, spy, or mock
verifying. A plain `double` does not check its messages against any interface and is
only appropriate as a dummy.

### Verification in RSpec

- **Output-based.** A matcher on the return value: `expect(result).to eq(...)`,
  `have_attributes`, `match`.
- **State-based.** A matcher on the subject or a collaborator after the action:
  `expect(obj.attr).to eq(...)`, `change { ... }`, or a matcher on a fake's contents.
- **Communication-based.** `expect(obj).to receive(:msg)` before the action, or
  `expect(obj).to have_received(:msg)` after it. The RSpec base standards' rule on
  `allow` and `expect` enforces the default: `allow` for incidental stubs,
  `expect` only for a message that is the behavior under test.

### Gems

- **factory_bot.** Builds real objects for test setup from named definitions. The
  objects it builds are real, not doubles, so it changes nothing on the scope
  dimension. It replaces hand-written setup, usually of persisted models, and is
  common in Rails model and request specs. In a plain gem, `let` blocks usually cover
  the same need.
- **rantly** and **propcheck.** Input generators and shrinking for property-based
  tests.
- **approvals.** Snapshot tests. Records the output on the first run and diffs later
  runs against the approved file.
- **vcr** and **webmock.** Recorded and hand-written HTTP stubs. VCR is the recorded
  stub the snapshot section warns against confusing with a snapshot.
- **mutant.** Mutation testing. Mutates the code under test and reports mutations no
  spec kills. The check for whether 100% coverage means anything.
- **turnip.** Runs Gherkin feature files as RSpec examples, with steps defined in
  Ruby. The RSpec route to acceptance tests, in place of Cucumber. RSpec's own
  feature specs serve the same audience with Capybara's DSL instead of Gherkin.

### Anti-patterns and smells in RSpec

The split follows the general sections above. An anti-pattern is a finding and a
smell is a question.

#### RSpec anti-patterns

- **Stubbing the subject.** `allow(subject).to receive` on the object under test
  replaces part of the thing being tested. Extract the collaborator and stub that.
- **Leaky constants.** A class or constant defined at the top level of a spec file
  persists into every later example in the process. Use `stub_const` or `Class.new`
  assigned to a `let`.
- **A bare `not_to raise_error`.** Proves only that nothing blew up. Assert on the
  result the call produced.

#### RSpec smells

- **Deep nesting.** Contexts more than three levels deep, where the reader has to
  scroll up through several `let` overrides to know what the subject is. Usually a
  sign the class has too many collaborators. Legitimate for a method with a wide
  input space.
- **`let!` as a hidden fixture.** A `let!` at the top of a file is a General Fixture
  that runs for every example. Legitimate when every example needs the side effect.
- **Iterated expectations.** `each` over a collection with an `expect` inside, so a
  failure does not say which element. Legitimate with `aggregate_failures`, or when
  the collection is the assertion.

## Rails spec types

`rspec-rails` adds spec types that map onto the parts of a Rails application. They
only make sense inside a Rails app and have no equivalent in a plain gem. They are
here as a check on the classification above: if the six dimensions describe tests
well, every Rails type should have a position on each. The table gives the usual
position; any row can be a regression test, and any can run later than every change
if it is slow enough.

| Spec type | Scope | Case generation | Verification | Audience | Purpose | When it runs |
| --- | --- | --- | --- | --- | --- | --- |
| Model | Integration | Example-based | State | Developer | Specification | Every change |
| Request | Integration | Example-based | Output | Developer | Specification | Every change |
| Feature and system | System | Example-based | State | Developer, or user | Specification | Every change, or scheduled |
| Job | Unit | Example-based | Communication | Developer | Specification | Every change |
| Mailer | Unit | Example-based | Output | Developer | Specification | Every change |
| Helper | Unit | Example-based | Output | Developer | Specification | Every change |
| Routing | Unit | Example-based | Output | Developer | Specification | Every change |
| View | Unit | Example-based | Output | Developer | Specification | Every change |
| Channel | Unit | Example-based | Communication | Developer | Specification | Every change |
| Controller | Integration | Example-based | State | Developer | Specification | Every change |
| Generator | Integration | Example-based | State | Developer | Specification | Every change |

The table shows what the Rails names encode: scope and verification. Every other
column is uniform. A Rails spec type is a Rails component paired with the scope and
verification style that component needs, and nothing more. The other four dimensions
are choices the author still makes inside any of them.

### Model specs

Model specs test an ActiveRecord or ActiveModel class: validations, associations,
scopes, callbacks, and business methods. They usually run against a real test
database, so despite the name they are closer to integration tests than to class unit
tests.

### Request specs

Request specs send a full HTTP request through routing and the middleware stack and
assert on the response body, status, headers, and any side effects. Current
`rspec-rails` recommends them for testing HTTP behavior.

### Feature and system specs

These are the Rails names for system tests. They drive the app in a browser through
Capybara, using either the fast `rack_test` driver or a real browser driver.
`rspec-rails` calls them system specs when they build on Rails' `SystemTestCase` and
feature specs when they use Capybara directly.

### Job specs

Job specs test an ActiveJob class either by performing it inline and asserting on the
result, or by asserting that it was enqueued with particular arguments on a
particular queue.

### Mailer specs

Mailer specs build a message from a mailer class and assert on recipients, subject,
and body without delivering it.

### Helper specs

Helper specs test a view helper module's methods as plain functions, with the Rails
helper context available so methods that call other helpers still work.

### Routing specs

Routing specs assert that a path and HTTP verb dispatch to a particular controller
action, and that a controller action generates the expected path. No request
executes. They test the routes file alone.

### View specs

View specs render one template with supplied assigns and assert on the produced HTML.
No controller runs. They are useful when a template has enough branching logic that
testing it through a request spec would require many requests.

### Channel specs

Channel specs test an ActionCable channel: that a client can subscribe, which streams
the subscription listens to, and what the channel broadcasts in response to actions.

### Controller specs

Controller specs instantiate a controller and call an action directly, then assert on
assigned instance variables, the rendered template name, and the response status.
Rails 5 deprecated this approach in favor of request specs because it bypasses
routing and middleware and asserts on internals that request specs do not need to
know about.

### Generator specs

Generator specs run a Rails generator against a temporary destination directory and
assert on the files it creates.

### Anti-patterns and smells in Rails specs

#### Rails anti-patterns

- **`sleep` in system specs.** Capybara's finders and matchers wait; a `sleep` is a
  race with a timeout.
- **Stubbing `Time.now`.** `travel_to` from `ActiveSupport::Testing::TimeHelpers`
  also covers `Time.current` and `Date.today`, and restores itself.
- **Transactional tests across a browser process.** A system spec where the app
  server cannot see rows the test inserted, or the reverse. Rails handles the default
  case; it reappears with custom database cleaning.

#### Rails smells

- **`create` where `build` or `build_stubbed` would do.** Persisting records the test
  never reads back is the main reason Rails suites are slow. Legitimate when the test
  reads the record back or exercises a database constraint.
- **Factory cascades.** A factory whose associations build their own associations, so
  one `create` writes ten rows. Mystery Guest in factory form. Legitimate when the
  model cannot be valid without them.
- **Validation tests that prove only the declaration.** A matcher that checks a
  validation is declared tests ActiveRecord, not the model. Legitimate as a cheap
  guard against a validation being deleted, as long as the behavior the validation
  exists for has its own test.
