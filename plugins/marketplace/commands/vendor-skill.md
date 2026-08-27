---
description: Vendor a third-party skill into this marketplace in two commits — the upstream file byte for byte, then every local modification — recording provenance in NOTICE.md
argument-hint: "[source and destination — upstream repo and path, and the plugin to vendor into]"
---

Vendor the third-party skill named in `$ARGUMENTS` into this marketplace.
If `$ARGUMENTS` does not name the upstream repository, the file path in it,
and the destination plugin, ask before doing anything. Work in the root of
the jcouball/agent-plugins repository; if the current project is not it,
stop and say so.

Land it in two commits, always.

1. Check the upstream license before anything else. If it does not permit
   redistribution with attribution, stop and tell the user. Otherwise carry
   its notice in `NOTICE.md`.
2. First commit: the upstream file, byte for byte, at
   `plugins/<plugin>/skills/<name>/SKILL.md`, with no local changes — fetch
   it at a specific commit so the provenance is exact:

   ```bash
   gh api 'repos/<owner>/<repo>/contents/<path>?ref=<sha>' --jq .content | base64 -d
   ```

   In the same commit, record the source repository, path, and commit in
   `NOTICE.md`, along with the license notice. Record nothing about local
   changes there — the git history is the record of those. `npm run ci` may
   fail at this point (undeclared skill, upstream formatting); that is
   expected until the second commit.
3. Second commit: every local modification, with the reasoning in the commit
   body. This is where the skill joins the marketplace: declare it in the
   plugin manifest, give the description trigger words, and add the
   project-overrides contract (step 4 of /jcouball-marketplace:add-skill).
   Formatting counts as a local modification — a vendored file is linted
   like any other, so rewrap for line length or renumber for stable IDs
   here, with no wording changes mixed in beyond what the reasoning in the
   commit body covers.
4. Run `npm run ci` and fix anything it reports before finishing the second
   commit.
5. Both commits are `feat` scoped to the plugin, on a topic branch; open a
   PR.

`git diff <vendor-commit> <modify-commit>` then answers what was changed
locally, which is why `NOTICE.md` describes the local changes not at all.
