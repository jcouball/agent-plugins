---
description: Port upstream changes into a vendored skill by hand, diffing the two upstream versions so local changes never appear, and updating NOTICE.md
argument-hint: "[skill name — e.g. unslop]"
---

Port the latest upstream changes into the vendored skill named in
`$ARGUMENTS`. If `$ARGUMENTS` is empty, ask which vendored skill to update.
Work in the root of the jcouball/agent-plugins repository; if the current
project is not it, stop and say so.

The local copy drifts from upstream on purpose — reformatting, dropped
sections, local fixes — so an upstream update is ported by hand, not
merged. `NOTICE.md` records the upstream source and the commit last
reviewed; read it first.

1. Fetch the file at the recorded commit and at the new upstream head:

   ```bash
   gh api 'repos/<owner>/<repo>/contents/<path>?ref=<sha>' --jq .content | base64 -d
   ```

2. Diff the two upstream versions. Local changes never appear in that diff,
   so it shows exactly what upstream changed and nothing else.
3. Port the hunks worth taking into the local file, applying this
   repository's formatting as you go. `git merge-file <local> <old> <new>`
   auto-applies hunks in regions with no local changes and leaves conflict
   markers where they collide.
4. Update the commit recorded in `NOTICE.md`.
5. Run `npm run ci`.
6. Commit once, scoped to the plugin, naming the upstream range in the
   body. Use `feat` or `fix`, not `chore`: a `chore` never triggers a
   release, and content on `main` without a version bump leaves installs
   pinned to the old commit (see the `npm run sync` gotcha in
   MAINTAINING.md).
