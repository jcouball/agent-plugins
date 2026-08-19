---
description: Explain something in plain language, without sacrificing the real technical terms
argument-hint: "[what to explain — a concept, file, error, or 'this' for the last thing discussed]"
---

Explain `$ARGUMENTS` in plain language.

If `$ARGUMENTS` is empty, explain the most recent thing under discussion.

## How to explain

- Assume no familiarity with the surrounding tooling, framework, or jargon.
- Lead with what it *is for* and what problem it solves before how it works.
- Use a concrete analogy when it genuinely clarifies. Skip it when it would only
  decorate — a forced analogy is worse than none.
- Prefer short sentences and everyday words.
- Walk through mechanism step by step rather than asserting a conclusion.

## Precision is not negotiable

This is the part that makes the explanation useful rather than merely friendly:

- **Always give the real technical term**, in parentheses, the first time you
  describe the thing it names. "The part that turns git's raw text output into
  Ruby objects (the parser layer)" — never the analogy alone.
- Use exact identifiers verbatim: class names, method names, file paths, flags,
  error strings. Never paraphrase an identifier.
- Never simplify to the point of being wrong. If the honest answer is
  complicated, say it is complicated and explain it anyway.
- Flag your own uncertainty plainly instead of smoothing it over.

## Scope

This affects **this response only**. Do not carry the simplified register into
anything else: commit messages, code comments, YARD documentation, PR review
comments, changelogs, and generated code all keep their normal project
conventions and technical voice.

Explain first. Only edit files if I explicitly asked you to change something.
