# jcouball-testing

This plugin gives Ruby projects a shared language for talking about tests, and rules
for RSpec specs that follow from it. People and agents read the same files. It aims
for four things:

- One set of terms that people, agents, the skills, and the specs all use with the
  same meaning. The guide defines them.
- A reason behind every rule, kept in the guide, so a reader can judge when a SHOULD
  can be set aside or a project override is justified.
- Specs that people and agents write, review, and audit the same way, by the rules
  the skills state.
- One copy of the rules shared across projects, with each project's differences
  explicit and small.

The vocabulary applies to tests in any language. The rules cover RSpec specs that
test functional correctness, not performance, load, or security tests.

## The testing guide

The [testing guide](docs/testing-guide.md) defines the vocabulary: what a unit,
integration, or system test is, what a test double is and which kind to use, and the
names for how a test generates cases, verifies results, and when it runs. Read it to
learn what a term means or why a rule exists. It gives the reasons, and the skills
state the rules.

## Where the rules are

Every spec follows the [base standards](skills/rspec-base-standards/SKILL.md): how
to name the subject, lay out `describe`, `context`, and `it`, use `subject` and
`let`, stub, and assert. Then add the standards for the spec's scope:

| When the spec | Read |
| --- | --- |
| Tests one class or module alone, with its collaborators doubled, or is a Rails helper, mailer, job, routing, view, or channel spec, or tests an ActiveModel-only class | [Unit standards](skills/rspec-unit-testing-standards/SKILL.md) |
| Runs the code against a real external process, such as a database or a command-line tool, or is a spec of an ActiveRecord model, or a Rails request, controller, or generator spec | [Integration standards](skills/rspec-integration-testing-standards/SKILL.md) |
| Drives the whole application from outside, such as a Rails system or feature spec | [System standards](skills/rspec-system-testing-standards/SKILL.md) |

Where a scope's standards change a base rule, they say so.

The skills are for writing a spec and for reviewing or auditing existing ones. A
review or audit produces a table with one row per rule, marked Pass, Fail, or N/A,
then the MUST violations to fix and the SHOULD deviations ordered by impact.

Each standards skill opens with what a spec that follows it proves, then lists its rules
in a checklist. Each rule is one sentence marked **MUST** or **SHOULD**. Break a MUST
only with a documented exception. A SHOULD is the default. Set it aside when a clearer
test needs it, and say why in a comment. Where the guide reasons about a rule, the rule
links to that paragraph.

## Refactoring

[TDD refactor step](skills/tdd-refactor-step/SKILL.md) applies the standards to a task
instead of stating rules of its own. It is the refactor step of red-green-refactor:
which smells oblige a change, the smallest technique that removes each, and how to
prove the behavior did not move. It loads the standards for the spec it changes.

## Adapting the rules to a project

A project that differs from a rule does not copy the skill. It adds a file with the
same skill name at `.claude/skills/<skill>/SKILL.md` or
`.github/skills/<skill>/SKILL.md` holding only its differences, such as where its
specs live or a construct it forbids. The skill applies that file on top of its own
rules, and the project file wins where the two disagree. The
[add-overrides command](../marketplace/commands/add-overrides.md) creates one.
