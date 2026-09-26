---
name: testing-guide
description: 'Points at the testing guide, the reference that defines the vocabulary for talking about tests, classifies them on six dimensions, and says how to choose which kind to write, with sections mapping it to Ruby, RSpec, and Rails. Load only when asked why a testing rule exists, what a test term means, how to classify or name a test, or when writing or reviewing a testing skill or standard. Do not load it for ordinary test writing; the standards skills are self-sufficient for that. If the current project has its own testing-guide skill, that file holds project-specific changes and additions: still apply this skill, and apply those changes on top (Step 0).'
---

# Testing guide

The guide itself is [docs/testing-guide.md](../../docs/testing-guide.md) in this
plugin. This skill is the door to it: it says when to read the guide, which part to
read, and how a project layers its own choices on top.

## Contents

- [Step 0: Apply project overrides](#step-0-apply-project-overrides)
- [When to load the guide](#when-to-load-the-guide)
- [Which part to read](#which-part-to-read)

## Step 0: Apply project overrides

A project may carry its own thin copy of this skill holding only its local
changes and additions: which defaults it flips, how its test suite is laid out,
and which of its own standards derive from the guide. Check for one at each of
these paths and use the first that exists:

- `.claude/skills/testing-guide/SKILL.md`
- `.github/skills/testing-guide/SKILL.md`

If neither exists, fall back to searching wherever the project keeps agent skills
for a `SKILL.md` whose frontmatter `name` is `testing-guide`:

```bash
grep -rlE --include=SKILL.md "^name: *['\"]?testing-guide['\"]? *$" . \
  --exclude-dir=node_modules --exclude-dir=vendor --exclude-dir=.git
```

The name may be quoted or bare, and the anchors keep it from matching a longer
name. Never treat a vendored or installed copy of this skill itself as the override; a
full copy holds no project deltas. Read the file found and apply its changes and
additions, with the project file winning on conflict. If that file is what invoked
this skill, its changes are already in context; do not re-read it, and do not
re-invoke anything it names.

If no override exists, run this skill as written.

## When to load the guide

Read the guide when the question is about terms or reasons:

- Why a rule in a testing standard exists, or whether a rule is right.
- What a term means: unit, integration, system, stub, mock, fake, contract test,
  characterization test, smoke test, and the rest.
- How to classify a test, or which kind of test to write for a given change.
- Whether a test is an anti-pattern or a smell, and whether the case is legitimate.
- Writing or reviewing a testing skill, standard, or convention document, so its
  terms and rules match the guide.

Do not read the guide for ordinary test writing or review. The standards skills
state the rules an agent needs for that job on their own and cite the guide only
for the reasoning.

## Which part to read

The guide is long. Read the section that answers the question, not the whole file.

- Choosing which kind of test to write: **Choosing a test**.
- What the six dimensions are and how they combine: **Test classification**.
- Building inputs, fixtures, and factories: **Test data**.
- Doubles and their names: **Test doubles**.
- What a kind of test is and what it is for: **Test types**, then the entry.
- Attributes that vary independently of type: **Test attributes**, then the
  dimension.
- Smoke, sanity, and other names that combine dimensions: **Named combinations**.
- Whether a test is a problem: **Test anti-patterns** and **Test smells**.
- Ruby, RSpec, and Rails specifics: **Ruby and RSpec** and **Rails spec types**,
  after the neutral section they build on.

Cite the guide by heading. The headings are an interface: skills and standards
refer to them, so renaming one is a breaking change to every document that cites
it.
