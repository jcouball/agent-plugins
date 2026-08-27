---
description: Create a thin project-local override file for a skill that lives in the jcouball/agent-plugins marketplace
argument-hint: "[skill-name — the marketplace skill to override]"
---

Create a project-local override file for the `$ARGUMENTS` skill from the
jcouball/agent-plugins marketplace, following the model used for
resolve-pr-feedback. If `$ARGUMENTS` is empty, ask which marketplace skill
to override before doing anything.

1. Confirm the plugin skill has its project-overrides hook: a step at the
   start of its workflow that names the project paths it checks. The label
   varies — resolve-pr-feedback calls it "Step 0", unslop numbers it 0 in
   its Process list — so look for the path check, not the word "Step".
   Every skill in the marketplace carries the hook by convention, so a
   missing one is a gap in the plugin: add it there first, following step 3
   of the /jcouball-marketplace:promote-skill command.
   Without the hook, overrides apply only when the workflow is entered
   through this file.
2. Create the file at a path the plugin skill checks —
   .claude/skills/<skill-name>/SKILL.md or
   .github/skills/<skill-name>/SKILL.md, checked in that order — with the
   frontmatter name matching the directory and a description adapted from
   the plugin skill, adding any project-specific trigger words. The skill
   uses only the first file it finds, so create exactly one. A directory
   the project already uses for agent skills also works — the hook falls
   back to a same-named SKILL.md found elsewhere in the project — but the
   two named paths are checked first and are the deterministic choice.
3. Write the pointer body: say to invoke /<marketplace-qualified-skill>
   and apply the changes below throughout its workflow; add the guard "if
   you arrived here because that skill told you to read this file, do not
   invoke it again — apply the changes below and continue"; include the
   marketplace install commands and a link to the plugin source for agents
   that cannot use Claude Code plugins.
4. Add a "Changes and additions for <project>" section holding only
   genuine differences: protected branches, the local CI command, links to
   related project skills, and anything else the plugin skill states
   generically. Anchor each delta to the wording or step name it modifies
   in the plugin skill, not to step numbers alone, so the deltas survive
   the plugin skill being edited.
