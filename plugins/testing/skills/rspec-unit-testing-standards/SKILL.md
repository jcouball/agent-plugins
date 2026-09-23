---
name: rspec-unit-testing-standards
description: 'Rules for RSpec unit specs, on top of the scope-neutral rspec-base-standards skill it loads first: the examples a constructor earns, requiring only the spec helper and the file under test, keeping setup in the file, stubbing every non-trivial collaborator, the coverage gate, determinism, and leaving process and global state alone. Use when writing, reviewing, or auditing an RSpec unit spec, or deciding what a unit spec may stub. If the current project has its own rspec-unit-testing-standards skill, that file holds project-specific changes and additions: still apply this skill, and apply those changes on top (Step 0).'
---

# RSpec unit testing standards

What a unit spec requires beyond the conventions every spec follows. Load the
[RSpec base standards](../rspec-base-standards/SKILL.md) first and apply it in full:
this skill adds the rules that exist because the spec is a unit spec, and overrides
nothing in it. Each rule is one sentence with a priority word, an example where one
helps, and, where the guide reasons about it, a link to the paragraph of the
[testing guide](../../docs/testing-guide.md) it derives from.

**MUST** is mandatory; do not violate it without a documented exception. **SHOULD**
is the default; override it when a clearer test requires it, and say so in a comment.

## Contents

- [Step 0: Apply project overrides](#step-0-apply-project-overrides)
- [Checklist](#checklist)
- [Structure and setup](#structure-and-setup)
- [Doubles](#doubles)
- [Coverage](#coverage)
- [Reliability](#reliability)
- [What the tools check](#what-the-tools-check)
- [Verification](#verification)
- [Output](#output)

## Step 0: Apply project overrides

A project may carry its own thin copy of this skill holding only its local changes and
additions: where its unit specs live, how its coverage gate is configured, which unit
test school it follows, which rules it flips, and its own conventions for particular
class families. Check for one at each of these paths and use the first that exists:

- `.claude/skills/rspec-unit-testing-standards/SKILL.md`
- `.github/skills/rspec-unit-testing-standards/SKILL.md`

If neither exists, fall back to searching wherever the project keeps agent skills
for a `SKILL.md` whose frontmatter `name` is `rspec-unit-testing-standards`:

```bash
grep -rlE --include=SKILL.md "^name: *['\"]?rspec-unit-testing-standards['\"]? *$" . \
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
govern every rule this skill inherits.

## Checklist

Run the [shared checklist](../rspec-base-standards/SKILL.md#checklist) first. It
covers structure, naming, `subject` and `let`, doubles, assertions, and ordering.
Then, for each unit spec written or reviewed:

1. The constructor has the group and the examples it earns (Rule 1).
2. The spec requires the spec helper and the file under test, nothing else (Rule 2).
3. Setup stays in the file; a `shared_context` only for substantial reuse across
   three or more files (Rule 3).
4. Every non-trivial collaborator is stubbed, and trivial values are passed as they
   are (Rule 4).
5. The unit suite alone covers every line and branch of the class (Rule 5).
6. No real time, randomness, sleep, or external process timing, and no change to
   `ENV`, the working directory, or any global (Rules 6, 7).

## Structure and setup

### Rule 1 (SHOULD): One `have_attributes` example for `#initialize`, inherited or not

A constructor gets a `describe '#initialize'` group with one `have_attributes` example
when a public reader can observe what it stored, and one example per branch instead when
it validates or branches. A concrete class that callers instantiate but that does not
override `#initialize` still gets the group, in the one-example form, so the spec
documents the constructor and catches an accidental override. There is nothing to write
when no public reader can see the stored value: the shared rule on testing through the
public interface forbids reaching past it, the methods that use the value cover it, and
a reader added for the spec alone is the guide's Test logic in production code
anti-pattern. A project's class-family conventions may exempt a family whose constructor
is covered elsewhere. Guide: [Class unit
tests](../../docs/testing-guide.md#class-unit-tests).

### Rule 2 (MUST): Require the spec helper and the file under test, nothing else

Every other require couples the spec to code it does not test, so a rename elsewhere
breaks it. Guide:
[Class unit tests](../../docs/testing-guide.md#class-unit-tests).

### Rule 3 (SHOULD): Keep setup in the spec file; share only substantial setup

Extract only setup that is identical and used by three or more files. No
`shared_context` within a single file; the `let` hierarchy does that. Do not
extract a helper because two files have similar-looking methods; if they build
different doubles or defaults, the similarity is incidental. A unit spec that needs a
`shared_context` to run is almost always an integration spec. Guide:
[General Fixture](../../docs/testing-guide.md#test-smells) and
[Mystery Guest](../../docs/testing-guide.md#test-smells).

## Doubles

### Rule 4 (MUST): Stub every non-trivial collaborator; pass trivial values as they are

Stub anything whose real involvement would cross the unit boundary: a subprocess, the
filesystem, the network, the clock, or another class with behavior of its own. Do
not stub strings, numbers, arrays, hashes, or a value object with no IO. The
question is whether running the real thing would stop this being a unit test. This
is the solitary school, which the guide makes the default and names as the project's
override point. Where an override declares the sociable school, in-process
collaborators run real and this rule covers only what leaves the process.
Guide: [Unit tests](../../docs/testing-guide.md#unit-tests), real and doubled.

## Coverage

### Rule 5 (MUST): The unit suite alone covers every line and branch

When a branch is hard to reach, in order: reach it through the public interface; delete
it, since an unreachable branch is usually dead code; last, exclude it with a coverage
directive that carries a reason, over the narrowest span, and expect a reviewer to
challenge it. Never write an example whose only purpose is to execute a line; that is a
violation of the shared rule on observable behavior, with a green report. Guide: [Unit
tests](../../docs/testing-guide.md#unit-tests), what it proves.

## Reliability

### Rule 6 (MUST): Unit specs are deterministic

No real time, randomness, sleep, or external process timing. Stub `Time.now`,
`Process.clock_gettime`, and `SecureRandom` on their receivers, or inject the clock.
`rand` has no receiver to stub: it is a private `Kernel` method, so stubbing it stubs
the subject, which the shared rules forbid, and seeding it with `srand` changes global
state (Rule 7). Give the subject a `Random` parameter that defaults to `Random.new` and
pass a seeded instance from the spec. Guide:
[Non-determinism](../../docs/testing-guide.md#test-anti-patterns).

### Rule 7 (MUST): Do not modify process or global state

`ENV`, the working directory, locale, and global configuration stay untouched. Inject
the value; a subject that reads a global directly usually wants a parameter that
defaults to it. When the code under test exists to read that state and has no seam,
change it inside an `around` hook that restores it even on failure, comment why, and
note that restoring does nothing for other threads, so a seam is the follow-up.
Guide: [Mutating process or global state](../../docs/testing-guide.md#test-anti-patterns).

## What the tools check

The cops for the inherited rules are listed in the
[shared standards](../rspec-base-standards/SKILL.md#what-the-tools-check). Of this
skill's own rules only Rule 5 is mechanical, as the coverage gate, and the project
override names the command that runs it. The rest are read.

## Verification

After writing or changing a spec:

1. Run the spec file while writing it. Step 2 runs it again as part of the suite,
   so this is the fast inner loop and not a separate signal.
2. Confirm coverage of the class under test is complete. The project override
   names the command that fails below the gate; without one, run the unit specs
   alone with SimpleCov, so no integration example masks a gap, and read the file's
   line and branch figures in the report. SimpleCov measures lines only until its
   config calls `enable_coverage :branch`, so a report with no branch column is not
   evidence for the branch half of Rule 5. A project with no coverage tool has no
   gate, and the check is reading each method's branches against the examples.
3. Scan the spec against every MUST rule and fix what fails.
4. Run the suite once in defined order. The shared rule on ordering has the project
   running random by default, so defined is the ordering the other runs never
   produce, and running one file again in random order would only reshuffle its own
   examples.

## Output

When writing, produce the spec and run the verification above. When reviewing or
auditing, produce a table with one row per rule, marked Pass, Fail, or N/A with the
issue, then the MUST violations to fix, then the SHOULD deviations ordered by impact.
