---
description: Add a new skill to a plugin in this marketplace, with a trigger-worded description, the manifest declaration, and the project-overrides contract
argument-hint: "[plugin and skill name — e.g. github my-skill]"
---

Add the skill named in `$ARGUMENTS` to the named plugin in this repository.
If `$ARGUMENTS` does not name both a plugin and a skill, ask before doing
anything. Work in the root of the jcouball/agent-plugins repository; if the
current project is not it, stop and say so.

1. Create `plugins/<plugin>/skills/<name>/SKILL.md` with `name` and
   `description` frontmatter. The `name` has to match the directory.
2. Add `"./skills/<name>"` to the `skills` array in the plugin manifest.
   `npm run lint:manifests` fails if a skill exists on disk but is not
   declared.
3. Write the description to name its triggers. Claude Code routes on the
   description alone, so a description without trigger words means the skill
   never fires on its own.
4. Give the skill the project-overrides contract that every skill here
   carries: a first workflow step that checks
   `.claude/skills/<name>/SKILL.md` and then
   `.github/skills/<name>/SKILL.md`, falls back to a `SKILL.md` with the
   same frontmatter name anywhere else the project keeps agent skills
   (never a vendored copy of the skill itself), applies the changes and
   additions from the first file found with the project file winning on
   conflict, and refuses to re-read or re-invoke the file that invoked it.
   Copy the wording from the resolve-pr-feedback skill's Step 0, but list
   only the two paths above with the new skill's name — the extra alias
   path there is specific to that skill's history — and end the description
   with its sentence pointing at that step. Commands do not carry the
   contract; it is for skills only.
5. Run `npm run ci` and fix anything it reports.
6. Commit as `feat` scoped to the plugin, on a topic branch, and open a PR.
