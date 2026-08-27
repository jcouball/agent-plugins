---
description: Move a full skill from this project into the jcouball/agent-plugins marketplace, leaving a thin project-local override file behind
argument-hint: "[skill and destination plugin — e.g. my-skill github]"
---

Move the skill named in `$ARGUMENTS` from this project into the named plugin
in the jcouball/agent-plugins marketplace, leaving a project-local override
file here, following the model used for resolve-pr-feedback. If `$ARGUMENTS`
does not name both the skill and the destination plugin, ask before doing
anything.

Work in a local clone of jcouball/agent-plugins; if you cannot find one, ask
where it is.

First, establish provenance. Promotion makes the marketplace copy canonical,
which is only right for the project's own work. Check the skill for
attribution, and the project's NOTICE or README for a vendoring record; ask
the user if it is unclear. If the skill is third-party or derived from
third-party work, stop and use /jcouball-marketplace:vendor-skill instead —
it handles the license check and NOTICE.md. If the skill is original but
carries attribution for pieces of it, carry that attribution into the
marketplace NOTICE.md as part of step 2.

In jcouball/agent-plugins:

1. First commit: copy the skill verbatim, byte for byte, to
   plugins/<plugin>/skills/<skill-name>/SKILL.md. npm run ci may fail at
   this point (undeclared skill, project formatting); that is expected
   until the second commit.
2. Second commit: generalize and integrate, with the reasoning in the
   commit body — `git diff` between the two commits then shows exactly what
   promotion changed. Generalize everything project-specific: write "the
   default branch or a release/maintenance branch" instead of branch names,
   "the project's local CI equivalent" instead of a command, and drop links
   to other project skills. Everything generalized here becomes a project
   delta in step 6. In the same commit, follow MAINTAINING.md: declare the
   skill in the plugin manifest and give the description trigger words.
3. Also in the second commit, add a "Step 0: Apply project overrides"
   section as the first workflow step, modeled on the one in
   resolve-pr-feedback: check .claude/skills/<skill-name>/SKILL.md and then
   .github/skills/<skill-name>/SKILL.md, falling back to a SKILL.md whose
   frontmatter name is <skill-name> anywhere else the project keeps agent
   skills — never a vendored copy of the skill itself — and use only the
   first that exists; read it and apply its changes throughout, with the
   project file winning on conflict; if that file is what invoked this
   skill, do not re-read it and do not re-invoke anything it names.
4. End the description with: "If the current project has its own
   <skill-name> skill, that file holds project-specific changes and
   additions: still run this skill, and apply those changes on top (Step 0)."
   Run npm run ci and fix anything it reports before finishing the second
   commit.
5. Both commits are feat scoped to the plugin, on a topic branch; open a
   PR, and after it merges, merge the release-please PR and run
   npm run sync -- <plugin>.

   Back in this project, only after that release is installed:

6. Reduce the local skill to a pointer plus deltas, modeled on ruby-git's
   .github/skills/resolve-pr-feedback/SKILL.md: keep the frontmatter (name
   matching the directory, a trigger-rich description); say to invoke
   /<marketplace-qualified-skill> and apply the changes below throughout
   its workflow; add the guard "if you arrived here because that skill told
   you to read this file, do not invoke it again — apply the changes below
   and continue"; include the marketplace install commands and a link to the
   plugin source for agents that cannot use Claude Code plugins; and keep a
   "Changes and additions for <project>" section holding only the genuine
   deltas from step 2.
7. If the directory is renamed to match the plugin skill, update every
   cross-link from other project skills.
