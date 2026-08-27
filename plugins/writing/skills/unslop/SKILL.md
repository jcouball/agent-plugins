---
name: unslop
description: 'Removes AI writing tells from prose and rewrites it in plain, direct language. Use when writing or editing documentation, README and CHANGELOG entries, PR descriptions, commit message bodies, code comments, or any prose that reads as machine-generated.'
---

# Unslop

Edit text to remove AI patterns and add human voice.

## Process

1. Identify the voice level for what is being edited (see next section).
2. Scan for the patterns below. They apply at every voice level.
3. Rewrite. Preserve meaning, match intended tone.
4. Be specific. Not "this is concerning" but "there's something unsettling
   about agents churning away at 3am". Vague writing reads as generated at
   every voice level, including reference.
5. Apply the voice level.
6. Self-audit: "What makes this obviously AI generated?" Fix remaining tells.

## Voice levels

Cutting AI patterns applies everywhere. How much personality to add does not.
Sterile writing is a tell in a PR description and correct in an API reference.

Pick the level from the surface being edited.

| Level | Surfaces |
| --- | --- |
| Reference | YARD doc comments, API reference, CHANGELOG entries, SKILL.md and other agent instruction files, config file comments, commit subject lines |
| Explanatory | README, CONTRIBUTING, UPGRADING, design and architecture docs, code comments explaining why, issue bodies, commit message bodies |
| Conversational | PR descriptions, PR review comments, issue and PR discussion, replies to contributors, release announcements, blog posts |

When one file mixes levels, use the level of the passage, not the file. A
worked example inside a README stays Explanatory. A rationale note inside a
YARD `@note` tag stays Reference.

### Reference

No added voice. State the fact and stop.

- Third person. Never "I". Use "you" only when instructing the caller.
- Uniform sentence rhythm. Predictable structure is a feature here.
- No hedging, no opinions, no asides. If behavior is conditional, name the
  condition instead of softening the sentence.

### Explanatory

Restrained voice. The reader needs to understand a decision, not meet the author.

- Have opinions about tradeoffs. "Slower, but it survives a locale change"
  beats listing both options neutrally.
- Vary rhythm. Short sentences. Then longer ones that take their time.
- Acknowledge complexity. Say when something is genuinely awkward, and why.
- Still third person. No "I", no conversational asides, no deliberate mess.

### Conversational

Full voice. The reader is a person who may reply.

- Everything in Explanatory, plus the following.
- Use "I" when it fits. First person is not unprofessional.
- Let some mess in. Perfect structure looks machine made.

## Patterns to detect and fix

Each pattern carries a stable ID for citing in review feedback ("that's a
3.1"). New patterns go at the end of their section so existing IDs never
change.

### 1. Content

**1.1 Puffery.** "pivotal moment", "testament to", "evolving landscape",
"setting the stage for", "indelible mark", "deeply rooted". Cut puffery, state
what happened.

**1.2 Superficial -ing phrases.** "highlighting...", "ensuring...",
"reflecting...", "showcasing...", "fostering...". The tell is a trailing
participle asserting significance the sentence never established. Delete it,
or expand it with real sources.

### 2. Language

**2.1 AI vocabulary.** Additionally, crucial, delve, enduring, enhance,
fostering, garner, interplay, intricate, landscape (abstract), pivotal,
showcase, tapestry (abstract), testament, underscore, vibrant. Replace with
plain words.

**2.2 Fancy ways to say "is".** "serves as", "stands as", "boasts",
"features". Just say "is" or "has".

**2.3 "Not just X, but Y."** Also its variants: "not only X but also Y", "It's
not about X; it's about Y", "more than just X". State the point directly
instead.

**2.4 Rule of three.** Forcing ideas into groups of three. Use the natural
number.

**2.5 Synonym cycling.** Protagonist, main character, central figure, hero all
in one paragraph. Pick one, repeat it.

**2.6 False ranges.** "from X to Y" where X and Y aren't on a meaningful
scale. List topics directly.

### 3. Style

**3.1 Em dash overuse.** Avoid em dashes entirely. Use periods or commas only
(no parentheses, no en dashes, no hyphen-as-dash substitutes). Em dashes are
an AI tell, and reaching for parentheses instead just trades one tell for
another. If a thought needs separation, end the sentence or use a comma.

**3.2 Colon overuse.** Colons are fine before a list or example. Not as
mid-sentence connectors. "If you're coming from traditional automation:
instead of registering event handlers, you describe conditions" adds nothing
with the colon. Rewrite to let the point stand on its own without comparison
framing. "Describing when the scheduler should fire works best as plain
English." Same meaning, no crutch punctuation.

**3.3 Boldface overuse.** Don't bold every proper noun or acronym. Unbold
everything except the few terms a reader skimming the page must find.

**3.4 Inline-header lists.** The tell is a bold label and colon that restates
the line: "**Performance:** Performance improved...". Convert those to prose.
A bold lead-in that ends in a period, names the item, and is followed by
genuinely new detail ("**Schema in TypeScript.** Tables live in one file.") is
fine, not a tell.

**3.5 Title case headings.** Use sentence case.

**3.6 Decorative emojis.** Remove from headings, bullets, and body text. An
emoji stays only where it carries meaning the words do not.

**3.7 Curly quotes.** Replace with straight quotes.

### 4. Communication artifacts

**4.1 Chatbot phrases.** "I hope this helps!", "Let me know if...", "Of
course!", "Certainly!", "Found the smoking gun!" More generally: openers,
closers, and canned enthusiasm addressed to the reader instead of the subject.
Remove.

**4.2 Sycophantic tone.** Praise or agreement used as an opener or filler:
"Great question!", "You're absolutely right!", "Excellent point!". Delete the
praise and respond directly. Specific, earned credit ("good catch, that guard
was dead code") is not sycophancy and stays.

### 5. Filler

**5.1 Filler phrases.** "In order to" becomes "To". "Due to the fact that"
becomes "Because". "It is important to note that" gets deleted.

**5.2 Excessive hedging.** "could potentially possibly be argued that it
might" becomes "may". One hedge is enough when uncertainty is real; none when
it is not. Do not strip a hedge that marks genuine doubt.

**5.3 Generic conclusions.** "The future looks bright." State specific plans
or facts, or end without a conclusion. A summary that restates the section is
also a generic conclusion.

### 6. Jargon

**6.1 Abstract metaphor nouns.** Substrate, wedge, vector, locus, vantage,
nexus, primitive (as noun), harness (as metaphor), surface (as in "API
surface"), bedrock, scaffolding (as metaphor), modality, paradigm,
gold-plating, ratchet (as metaphor), evacuate (for moving code), endgame,
north star, flywheel. These read as technical but usually have a plainer
concrete word. "Substrate" becomes "base". "Wedge in" becomes "add". "Vector"
becomes "way" or "method". "Gold-plating" becomes "more than the job needs".
"Ratchet" becomes the mechanism's real name or "a limit that only tightens".
"Evacuate" becomes "move out". "Endgame" becomes "the last phase". Pick the
concrete word.

### 7. Plain speech

**7.1 Say what it does, not how it feels.** "the database stays close at
hand", "SQL you can read", "types that follow your schema" name a feeling. The
fix names the mechanism or a number: "`.toSQL()` returns the exact string sent
to the database", "a column rename fails the build". Ask what the sentence
tells the reader to do or know, then write that. If you can't restate it as a
concrete instruction, fact, or number, cut it. One more check: if the sentence
could appear unchanged in another project's docs, it says nothing about this
one. Cut it.

**7.2 Shorten or split dense sentences.** If the reader has to backtrack to
parse a sentence, break it in two or drop clauses. One idea per sentence.

**7.3 Active voice.** Prefer it. Catch "is/are/was/were + past participle" and
name the actor: "queries are validated" becomes "the compiler validates
queries", "the file is parsed by the loader" becomes "the loader parses the
file". Passive is fine only when the actor is unknown or genuinely doesn't
matter.

**7.4 Cut adverbs, or use a stronger verb.** "runs quickly" becomes "is fast"
or the number. "significantly improves" becomes the measured delta. An adverb
propping up a weak verb means the verb is wrong.

**7.5 Prefer the plain word.** "utilize" becomes "use", "leverage" becomes
"use", "facilitate" becomes "help", "numerous" becomes "many", "in the event
that" becomes "if". The fancier synonym is rarely clearer.
