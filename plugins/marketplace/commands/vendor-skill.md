---
description: Vendor a third-party skill into this marketplace in two commits — the upstream skill and its LICENSE byte for byte, then every local modification — recording provenance in NOTICE.md
argument-hint: "[source and destination — upstream repo and path, and the plugin to vendor into]"
---

Vendor the third-party skill named in `$ARGUMENTS` into this marketplace.
If `$ARGUMENTS` does not name the upstream repository, the file path in it,
and the destination plugin, ask before doing anything. Work in the root of
the jcouball/agent-plugins repository; if the current project is not it,
stop and say so.

Land it in two commits, always.

1. Check the upstream license before anything else. The file that governs
   the skill is the nearest license file walking up from the skill file:
   one in the skill's own directory, then the plugin's, then the
   repository's. If there is none, stop and ask the user, whether or not a
   manifest or a README names a license: a license file written here with
   a guessed copyright holder would misattribute the work. If the file
   does not permit redistribution with attribution, stop and tell the
   user.
2. First commit: the upstream skill and the license file step 1 chose,
   byte for byte, at `plugins/<plugin>/skills/<name>/SKILL.md` and
   `plugins/<plugin>/skills/<name>/LICENSE`, with no local changes — fetch
   each at the same specific commit so the provenance is exact:

   ```bash
   gh api 'repos/<owner>/<repo>/contents/<path>?ref=<sha>' --jq .content | base64 -d
   ```

   The license file has to ship with the skill because `claude plugin install`
   copies only the plugin directory, so a notice kept only in the root
   `NOTICE.md` never reaches an install.

   In the same commit, record the source repository, path, and commit in
   `NOTICE.md`, along with the license name, the copyright line from the
   `LICENSE`, the path of the `LICENSE` inside the upstream repository
   under `license path`, and its sha256 from `shasum -a 256` under
   `license sha256`, in the shape of the existing sections, so the record
   reads by key. The license text itself is not repeated there; the copy
   beside the skill is the one copy of it. Record nothing about local
   changes there — the git history is the record of those. `npm run ci`
   may fail at this point (undeclared skill, upstream formatting); that is
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
