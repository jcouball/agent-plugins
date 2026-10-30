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
4. Update the commit recorded in `NOTICE.md`. Fetch the upstream license
   at the recorded commit and at the new head, from the `license path`
   recorded there, and compare both with the `LICENSE` beside the skill:

   ```bash
   dir=$(mktemp -d)
   gh api 'repos/<owner>/<repo>/contents/<license path>?ref=<old sha>' --jq .content | base64 -d > "$dir/old"
   gh api 'repos/<owner>/<repo>/contents/<license path>?ref=<new sha>' --jq .content | base64 -d > "$dir/new"
   cmp "$dir/new" plugins/<plugin>/skills/<name>/LICENSE
   cmp "$dir/old" "$dir/new"
   ```

   Stop if either fetch prints an error or leaves an empty file: a failed
   fetch is not a difference. The two comparisons answer separate
   questions. The second, old against new, says whether upstream changed
   the license: if it reports a difference, update the license name and
   copyright line, and stop if the new terms no longer permit
   redistribution with attribution. The first, new against local, says
   whether the file needs replacing: if it reports a difference, replace
   the file with `$dir/new`, byte for byte. When only the first reports a
   difference, the local file drifted and upstream did not change the
   license, so restore it and leave the license name and copyright line
   alone.
5. Run `npm run ci`.
6. Commit once, scoped to the plugin, naming the upstream range in the
   body. Use `feat` or `fix`, not `chore`: every type the release-please
   configs list is releasable, but the changelog should tell an installer
   that the skill changed, and a `chore` entry under Other Changes does not
   say that. Use `fix` when the port corrects wording or an existing rule,
   and `feat` when it adds or changes what the skill tells an agent to do.
