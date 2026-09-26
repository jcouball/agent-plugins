---
name: rspec-system-testing-standards
description: 'Rules for RSpec system specs, on top of the rspec-base-standards skill it loads first: which journeys earn one, one file per feature and one scenario per example, driving only through the interface a user or caller has, nothing in the application doubled, waiting instead of sleeping, finding elements as a user does, and owning state across the app server. Use when writing, reviewing, or auditing a Rails system or feature spec, an end-to-end spec of a command-line tool or a library against real state, or deciding whether a behavior needs a system test. If the current project has its own rspec-system-testing-standards skill, that file holds project-specific changes and additions: still apply this skill, and apply those changes on top (Step 0).'
---

# RSpec system testing standards

Rules for writing and reviewing RSpec system specs: tests that drive the whole
application from the outside, the way a user or a calling process would. In a Rails
app these are system and feature specs, driven through a browser with Capybara; for a
command-line tool, the executable run against real files; for a library, its public
API against real external state. Load the
[RSpec base standards](../rspec-base-standards/SKILL.md) first and apply it as
amended below. Each rule is one sentence with a priority word, an example where one
helps, and, where the guide reasons about it, a link to the paragraph of the
[testing guide](../../docs/testing-guide.md) it derives from.

**MUST** is mandatory; do not violate it without a documented exception. **SHOULD**
is the default; override it when a clearer test requires it, and say so in a comment.

A system spec's subject is a workflow, not Ruby code, so these base rules change:

- The top-level group names the feature in a string (base Rule 1), and examples are
  grouped by scenario, not by method (base Rule 2, replaced by Rule 2 below).
- The spec path is named for the feature (base Rule 4), not mirrored from a source file.
- Rules 10 to 13 of the base standards, on `subject`, do not apply; the steps of a
  scenario live in its example (Rule 2 below).
- One concept per example becomes one scenario per example (base Rule 8, replaced by
  Rule 7 below).
- The base rules on doubles have nothing to govern: nothing in the application is
  doubled (Rule 4 below).

The [unit](../rspec-unit-testing-standards/SKILL.md) and
[integration](../rspec-integration-testing-standards/SKILL.md) standards do not apply
here. System specs do not count toward the unit coverage gate.

## Contents

- [Step 0: Apply project overrides](#step-0-apply-project-overrides)
- [Checklist](#checklist)
- [Scope and structure](#scope-and-structure)
- [Driving the application](#driving-the-application)
- [Assertions](#assertions)
- [State](#state)
- [What the tools check](#what-the-tools-check)
- [Verification](#verification)
- [Output](#output)

## Step 0: Apply project overrides

A project may carry its own thin copy of this skill holding only its local changes and
additions: where its system specs live, which driver runs them locally and in CI, how
it cleans the database, which third-party services it replaces at the network edge
and with what, and its own conventions for particular features. Check for one at each
of these paths and use the first that exists:

- `.claude/skills/rspec-system-testing-standards/SKILL.md`
- `.github/skills/rspec-system-testing-standards/SKILL.md`

If neither exists, fall back to searching wherever the project keeps agent skills
for a `SKILL.md` whose frontmatter `name` is `rspec-system-testing-standards`:

```bash
grep -rlE --include=SKILL.md "^name: *['\"]?rspec-system-testing-standards['\"]? *$" . \
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

1. Name the journey this spec proves that no narrower test can (Rule 1).
2. One file per feature, one scenario per example (Rule 2).
3. Only main journeys and escaped-bug regressions; logic variants go to unit specs
   (Rule 3).
4. Nothing in the application doubled; a third-party service replaced only at the
   network edge, as the override names (Rule 4).
5. Preconditions built directly; actions and assertions only through the interface a
   user or caller has (Rule 5).
6. Waiting finders and matchers, no `sleep`; elements found by what a user sees
   (Rules 6, 8).
7. Each example asserts the outcome of its scenario, not internal state (Rule 7).
8. State owned by the example and visible to the app server; time set with
   `travel_to` (Rules 9, 10).
9. Every base convention the list above does not amend holds too. Run the
   [shared checklist](../rspec-base-standards/SKILL.md#checklist).

## Scope and structure

### Rule 1 (MUST): A system spec exists for a journey no narrower test can prove

The journey is a main path through the shipped software, such as signing up or
checking out, or the path where an escaped bug was visible. Name it in the example's
description. A behavior a unit or integration spec can observe is proved there and not
here. Guide: [System tests](../../docs/testing-guide.md#system-tests), when to choose
it.

### Rule 2 (MUST): One file per feature, one scenario per example

```ruby
RSpec.describe 'Checkout', type: :system do
  context 'with a saved card' do
    it 'places the order and shows the receipt' do
      visit cart_path
      click_on 'Check out'
      click_on 'Pay with card ending 4242'

      expect(page).to have_content('Order placed')
    end
  end
end
```

The steps of the scenario live in the example, in the order a user takes them, so the
example reads as the journey. A `context` names the condition a scenario starts from.
Preconditions go in `let` and `before` as the base standards say; the actions do not.
Guide: [Feature and system specs](../../docs/testing-guide.md#feature-and-system-specs).

### Rule 3 (SHOULD): Keep the suite to main journeys and escaped-bug regressions

A scenario that differs from another only in a branch of the code's logic, such as a
validation message, is a unit or integration case. Each system example is slow and
points at no one component when it fails. Guide: [System
tests](../../docs/testing-guide.md#system-tests), anti-patterns.

## Driving the application

### Rule 4 (MUST): Double nothing in the application

Every class, the database, the filesystem, and the browser or entry point are real.
A third-party service the team does not run, such as a payment provider, is the one
exception: replace it at the network edge with a sandbox or a fake that the project
override names, and treat what that replacement fakes as unproved. No `allow` or
`expect(...).to receive` on application code. Guide: [System
tests](../../docs/testing-guide.md#system-tests), real and doubled.

### Rule 5 (MUST): Act and assert only through the interface a user or caller has

Build preconditions directly, with factories or the library's own API, since
reaching them through the interface only makes the spec slower. The actions under
test and the assertions go through the browser, the executable, or the public API:
no reading the database, calling a model, or inspecting an instance variable to
check an outcome the user could see. Guide: [System
tests](../../docs/testing-guide.md#system-tests), anti-patterns.

### Rule 6 (MUST): Wait with Capybara's finders and matchers, never `sleep`

```ruby
expect(page).to have_content('Order placed')     # waits for the text
expect(page.text).to include('Order placed')     # reads once, races the page
```

Capybara's finders and `have_` matchers retry until their wait time runs out; a
string read from the page and a `sleep` do not. Raise the wait for one slow step with
`using_wait_time`, not globally. Guide: [Rails
anti-patterns](../../docs/testing-guide.md#rails-anti-patterns), `sleep` in system
specs.

## Assertions

### Rule 7 (MUST): Each example asserts the outcome of one scenario

One scenario can need several expectations: the page it ends on, the message shown,
the file written. An expectation mid-scenario that confirms a step was reached is part
of that scenario, and with Capybara it also waits for the step. Two outcomes reached
by different journeys are two examples. This replaces the base rule of one concept per
example. Guide: [System tests](../../docs/testing-guide.md#system-tests), what it
proves.

### Rule 8 (SHOULD): Find elements the way a user does

Click buttons and links by their text, fill fields by their labels, and scope with
`within` a landmark or heading. A CSS class or XPath tied to layout breaks when the
design changes and the behavior does not. Where no visible text identifies an element,
add a `data-testid` attribute and find it by that. Guide: [Feature and system
specs](../../docs/testing-guide.md#feature-and-system-specs).

## State

### Rule 9 (MUST): Every example owns its state, where the app server can see it

Build it inside the example or its `let` and `before`, and leave nothing another
example reads. Rails shares the test's database connection with the app server
thread, so transactional tests work in the default setup; custom database cleaning, or
an app server in another process, has to make the example's rows visible to the server
and remove them afterwards. Files go in a temporary directory
the example creates and removes. Guide: [Rails
anti-patterns](../../docs/testing-guide.md#rails-anti-patterns), transactional tests
across a browser process.

### Rule 10 (MUST): Set time with `travel_to`, not by stubbing the clock

`travel_to` from `ActiveSupport::Testing::TimeHelpers` covers `Time.current` and
`Date.today` and restores itself; stubbing `Time.now` would double the application,
which Rule 4 forbids. The browser keeps its own clock, so a scenario that depends on
time in JavaScript sets it in the page as well. Outside Rails, pass the time in through
the interface the user or caller has. Guide: [Rails
anti-patterns](../../docs/testing-guide.md#rails-anti-patterns), stubbing `Time.now`.

## What the tools check

RSpec/DescribeClass exempts system and feature specs by their `type` metadata and
their directory, so it accepts the string Rule 2 shows. Rule 6 is partly mechanical:
Capybara/CurrentPathExpectation in rubocop-capybara flags `expect(current_path)`,
which reads once instead of waiting, and `grep -rnw sleep spec/system spec/features`
finds each `sleep`. A string read from the page has no cop. The other rules are
read. The project override says which of these run in
the project.

## Verification

After writing or changing a spec:

1. Run the spec file with the driver CI uses, headless if CI is headless.
2. Run it five times in a row. A system spec that fails once in five is flaky, and
   flakiness is the usual way these specs fail; find the missing wait or the shared
   state before calling it done.
3. Run it with the rest of the system suite in random order.
4. Scan the spec against every MUST rule, this skill's and the base ones, and fix
   what fails.

For step 2, use `rerun`, which stops at the first failure and exits non-zero naming
the run. A shell function does not survive between commands, so define it in the
same command that calls it:

```bash
rerun() {  # rerun <count> <command>...: stop at the first failure and name the run
  n=$1; shift; i=1
  while [ "$i" -le "$n" ]; do
    "$@" || { echo "failed on run $i of $n" >&2; return 1; }
    i=$((i + 1))
  done
}

rerun 5 bundle exec rspec spec/system/checkout_spec.rb
```

A `for i in {1..5}` loop reports neither the failure nor the run: brace expansion is
not POSIX, and `break` leaves the loop's status at zero after a failure.

## Output

When writing, produce the spec and run the verification above. When reviewing or
auditing, produce a table with one row per rule, marked Pass, Fail, or N/A with the
issue, then the MUST violations to fix, then the SHOULD deviations ordered by impact.
The table covers the base rules as well as this skill's ten.
