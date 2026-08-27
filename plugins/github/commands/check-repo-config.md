---
description: Audit the GitHub repository's branch protection, merge methods, settings, and agent guidance against the guardrails baseline, and optionally fix drift
argument-hint: "[--fix]"
---

Audit this repository's GitHub configuration against its guardrails baseline
and report every point of drift. Apply fixes only when `$ARGUMENTS` is
exactly `--fix`, and only after showing what would change. Empty arguments
mean a report-only run, and anything else — `--fix=false`, a typo, an extra
word — is an error that stops the command: a substring test would let
`--fix=false` trigger repository writes.

Needs the `gh` CLI authenticated (`gh auth status`), `jq` on `PATH` — `gh`
does not imply the standalone `jq` its `--jq` flag resembles, and the
percent-encoding in Step 1 shells out to the real one — and a SHA-256 tool
for Step 4's ownership hashes: `shasum -a 256` or `sha256sum`, whichever
the system has; both print the same digest.

## The baseline

Read `.claude/repo-guardrails.yml` at the repository root — after
canonicalizing the path, as Step 4 does for instruction files. A
tracked symlink there can resolve outside the repository, and opening
it would read host-local data before any validation runs; a resolved
path outside the repository is a baseline error, and so is one
resolving to an untracked file inside it — untracked content is one
machine's, not the repository's, and must not drive `--fix` writes. The
file can define:

```yaml
protected_branches:      # ruleset fnmatch patterns; * stays in one segment
  - main
merge_methods:
  merge: false
  squash: false
  rebase: true
repository:
  delete_branch_on_merge: true
  allow_auto_merge: false
branch_rules:            # rule types every protected branch must carry
  - pull_request
  - non_fast_forward
  - deletion
  - required_linear_history
```

Patterns follow GitHub ruleset syntax (Ruby `fnmatch` with pathname
semantics): `*` stays within one path segment, and a terminal `**` does
too — only `**/` crosses `/`. So `release/*` matches `release/1.0` but
not `release/2026/1.0`, and `release/**` matches no more; write
`release/**/*` to cover any depth. Resolve branch matches with those
rules. In a ruleset condition a pattern appears as `refs/heads/<pattern>`:
add that prefix, and copy the fnmatch portion after it verbatim — that
part is already in the syntax rulesets read. Copying the bare pattern into
a condition drops the prefix and targets nothing.

`branch_rules` may name `pull_request` and the parameterless rule types:
`creation`, `deletion`, `non_fast_forward`, `required_linear_history`,
`required_signatures`. Other types — `required_status_checks` or
`required_deployments`, say — take parameters this baseline does not
model, so a bare rule object for them is rejected by the API; report an
unsupported type as a baseline error. Requiring status checks to pass
before merge is deliberately out of scope: check contexts vary per
repository, so configure that gate by hand in the ruleset when wanted —
the audit never removes or loosens rules the baseline does not mention,
so a hand-added rule survives every `--fix`.

Where the file is missing or a key is absent, use these defaults:

- `protected_branches`: `main`, `master`
- `merge_methods`: rebase only
- `repository`: `delete_branch_on_merge: true`, `allow_auto_merge: false`
- `branch_rules`: `pull_request`, `non_fast_forward`, `deletion`,
  `required_linear_history`

Validate the resolved baseline before comparing anything — in a
report-only run as much as under `--fix`. A misread file is worse than a
missing one: the audit would compare against defaults it was told to
override and report pass and drift confidently against the wrong baseline.
Stop with a baseline error, and report nothing else, when the guardrails
file has:

- a key the schema does not define, at the top level or within
  `merge_methods` or `repository`. A misspelled key is otherwise read as
  absent and silently replaced by its default, so `allow_auto_merg: true`
  would have the audit check — and `--fix` write — `allow_auto_merge:
  false`, the opposite of the evident intent.
- a mapping key that appears twice, at any level. YAML loaders disagree
  about duplicates — some reject them, others keep the first value or
  the last — so a file with two `rebase:` keys has the audit enforce
  whichever one the loader happened to keep, and `--fix` write a
  setting that matches at most half of what the file appears to say.
- a value of the wrong shape. The file's root, `merge_methods`, and
  `repository` must each be a mapping; the settings inside
  `merge_methods` and `repository` take booleans; `protected_branches`
  and `branch_rules` take lists of strings. A scalar or list where a
  mapping belongs — a root that is a string, or `repository: true` — is
  malformed, not "every key absent", and must stop the run rather than
  quietly resolve to the defaults.
- an explicitly empty `protected_branches` list, or an empty pattern in
  it. An absent key is not an error: it resolves to its default like any
  other.
- a `protected_branches` pattern that is a selector token or already
  carries a ref prefix — one starting with `~` or `refs/`. Patterns here
  are bare fnmatch patterns that Step 3 prefixes with `refs/heads/`, so
  `~ALL`, `~DEFAULT_BRANCH`, or `refs/heads/main` would become
  ineffective literals — `refs/heads/~ALL` matches no branch — while the
  audit compares against the same broken value and reports drift no fix
  can clear.
- a `protected_branches` pattern that appears twice. Duplicates produce
  duplicate ruleset selectors and canonical guidance that reads
  `` `main` or `main` `` — and if GitHub normalizes the selector list,
  the exact-scope comparison keeps reporting drift after every fix.
- a `branch_rules` entry naming an unsupported type, or naming one twice.
- `branch_rules` without `pull_request`, an explicitly empty list
  included. Every other supported type constrains how a branch changes,
  not whether changes must arrive by pull request — deletion, linear
  history, and signature rules all wave an ordinary direct push
  through — so a baseline omitting `pull_request` produces branches
  this command calls protected that anyone can push to. An absent
  `branch_rules` key stays fine: the default includes `pull_request`.
- `merge_methods` enabling no method at all. GitHub itself requires a
  repository to keep at least one merge method, so Step 3's settings
  `PATCH` would fail — and a `pull_request` rule needs a non-empty
  `allowed_merge_methods` for the same reason.
- `branch_rules` naming `required_linear_history` while merge commits are
  the only method `merge_methods` enables. A merge commit is exactly what
  linear history forbids, so the combination blocks every pull request:
  the rule demands what the only allowed method cannot produce. Enable
  squash or rebase, or drop the rule.

## Step 1: Read the actual configuration

Bind the target to the checkout before any read or write. `gh repo view`
honors a `GH_REPO` override, and a relative `gh api` path goes to the
CLI's default host — either can silently point every call, `--fix`
writes included, at a repository other than the one whose baseline was
just read. Resolve the host, owner, and name from the local Git remote,
ignore `GH_REPO`, and pass the host to every call:

```bash
unset GH_REPO
read -r HOST OWNER REPO < <(gh repo view --json url,owner,name \
  --jq '[(.url | sub("^https://"; "") | split("/")[0]),
         .owner.login, .name] | @tsv')
if [ -z "$HOST" ] || [ -z "$OWNER" ] || [ -z "$REPO" ]; then
  echo "could not resolve the repository from the checkout" >&2
  exit 1
fi

gh api --hostname "$HOST" "repos/$OWNER/$REPO" \
  --jq '{allow_merge_commit, allow_squash_merge,
  allow_rebase_merge, delete_branch_on_merge, allow_auto_merge}'
```

With `GH_REPO` unset, `gh repo view` resolves from the checkout's Git
remote through gh's own URL parser, which handles every remote form —
scp-like `git@host:owner/repo.git`, `ssh://` with a port, `git://` —
that a hand-rolled parse gets wrong; the canonical `url` it returns
carries the host. Validate all three values before the first call, and
stop when any is empty.

Every `gh api` call in this command takes `--hostname "$HOST"`. The
snippets below leave it off to stay readable, but it is not optional:
without it, the same owner and name on a different GitHub host is a
different repository that answers just as happily.

For each branch matching a protected pattern (resolve globs against
`gh api "repos/$OWNER/$REPO/branches" --paginate`), read the rules in force.
The branch name is a single path component of the endpoint, so
percent-encode it — a slash in a matched branch such as `release/1.0`
otherwise splits the path and the lookup fails:

```bash
set -o pipefail
BRANCH_ENC=$(jq -rn --arg b "<branch>" '$b|@uri')
gh api "repos/$OWNER/$REPO/rules/branches/$BRANCH_ENC" --paginate | jq -s 'add'
```

`pipefail` is not decoration: without it a failed `gh api` — a 403, a
network drop — leaves `jq -s 'add'` printing `null` and exiting zero,
and a failed read becomes indistinguishable from a branch with no
rules. The two print differently as well: an empty rule list is `[]`,
so treat `null` output as a failed read and stop, never as drift.

Use this effective-rules endpoint, not the classic
`branches/<branch>/protection` endpoint. Effective rules are readable with
plain read access and include rules inherited from organization rulesets;
the classic endpoint needs admin and sees only classic protection. The
endpoint pages like the listings do, so `--paginate` fetches every page
and the `jq -s 'add'` folds the per-page arrays into the one list the
checks read — without them, a branch bound by more than a page of rules
has its later rules read as absent, and the audit reports the wrong
result. A branch with no rules returns an empty array — that is drift,
not an error.

Then read the branch rulesets, which Step 2 needs for the pattern-coverage
check and Step 3 for the merge:

```bash
gh api "repos/$OWNER/$REPO/rulesets" --paginate \
  --jq '.[] | select(.target == "branch")
        | [.id, .source_type, .source, ._links.self.href] | @tsv'
gh api "repos/$OWNER/$REPO/rulesets/<id>"   # source_type Repository only
```

Fetch each candidate through its source's endpoint. The repository
endpoint above serves only `source_type: Repository` entries; an
inherited `Organization` entry lives at `orgs/<source>/rulesets/<id>`,
and the listing's `_links.self` already carries the right URL — follow
it verbatim rather than rebuilding the path. A 403 or 404 on a parent
fetch means that ruleset's conditions and rules cannot be read: report
the audit as partial for it, naming the ruleset, rather than treating
it as absent — an absent ruleset and an unreadable one support
opposite conclusions. An unreadable parent also blocks writes, not just
the report: without its conditions, merge methods, and bypasses, none
of Step 3's compatibility preflights can prove a ruleset write or
merge-method change safe — `--fix` could stack a rebase-only rule onto
an unseen squash-only parent and block every pull request. While any
applicable parent is unreadable, hold every ruleset write and the
merge-method fields and report them as blocked on reading it;
`delete_branch_on_merge` and `allow_auto_merge` carry no such
dependency and still fix.

Leave `includes_parents` at its default of `true`. The coverage check has
to see rulesets inherited from the organization: an inherited ruleset
protecting a pattern protects it as well as a repository one does, so a
listing without parents would report that pattern as drift and have
`--fix` create a redundant repository ruleset. Keep each ruleset's
`source_type` — Step 3 needs it, because a repository `PUT` cannot update
an `Organization` ruleset, so only `Repository` ones are merge candidates.
`--paginate` keeps a ruleset past the first page from being missed and
then duplicated by Step 3's create. The listing is an index only — it
carries no `conditions`, so it cannot say which branches a ruleset
targets. Fetch every branch-target candidate in full before comparing
anything.

## Step 2: Compare and report

Report a checklist, one line per checked setting, grouped as: repository
settings, then each protected branch. Mark each line pass or drift, and for
drift show expected vs actual. Checks:

- Each merge method allowed on the repository matches `merge_methods`.
- Each `repository` key matches.
- Each protected branch carries every rule type in `branch_rules`.
- Where `pull_request` rules apply to a branch, the intersection of their
  `allowed_merge_methods` permits no method `merge_methods` disables, and
  is not empty. Intersect rather than judge each rule alone: GitHub
  aggregates overlapping rulesets restrictively, so an inherited rule
  allowing every method and a repository rule allowing only rebase leave
  rebase as the effective set. The inherited rule stays visible in the
  effective rules and cannot be edited from here, so reading it on its own
  reports drift no fix can clear. The emptiness check matters because an
  empty intersection passes the subset test vacuously — an inherited
  squash-only rule against a rebase-only repository rule leaves no method
  at all, and no pull request can merge; that is drift, not a pass. A
  non-empty intersection can be just as unmergeable: where
  `required_linear_history` is among the effective rules and the
  intersection allows only merge commits, the one permitted method
  produces exactly what linear history forbids. The baseline validation
  rejects that combination in the baseline itself, but a stricter rule
  recreates it — only `merge` kept from a merge-and-rebase baseline
  passes the subset test and still blocks every pull request. Where
  linear history is in force, the intersection must keep squash or
  rebase; merge-only is drift.
- Every configured pattern is covered: some active branch ruleset includes
  it — as the literal `refs/heads/<pattern>`, or through `~ALL`, which
  matches every branch — no exclusion in a covering ruleset overlaps
  it — exclusions take precedence over includes — and the union of rules
  across the covering rulesets carries every `branch_rules` type. The
  literal pattern and `~ALL` are the only two selectors that count as
  covering. Proving that one glob subsumes another is easy to get wrong,
  so a merely broader pattern reports as drift even when it happens to
  cover; and `~DEFAULT_BRANCH` proves coverage of a branch, not of a
  pattern — it matches `main` only while `main` is the default, so the
  guarantee this check makes would quietly expire on a rename. Where
  rulesets applying to the pattern carry `pull_request` rules, the
  intersection of their `allowed_merge_methods` gets the same subset,
  non-emptiness, and linear-history checks as the per-branch audit
  above — a squash-only `~ALL` ruleset against a rebase-only baseline
  covers every rule type and still leaves the family's first branch with
  no method to merge by, which is the same underprotection this check
  exists to catch. And while coverage counts only the two selectors
  above, this intersection cannot stop at the covering rulesets: a
  ruleset whose selector overlaps the pattern without covering it —
  squash-only `release/*` against a rebase-only `release/**/*`
  baseline — binds every branch both patterns match, so `release/1.0`
  would carry an empty effective merge set the moment it exists while a
  covering-only check passes. Nor can every overlapping ruleset land in
  one pooled intersection: rulesets that each overlap the pattern can be
  disjoint from each other — a squash-only `release/one/*` and a
  rebase-only `release/two/*` under that same baseline never bind one
  branch — so pooling them reports an empty merge set no branch can ever
  carry. Intersect per combination a single branch could meet: the
  covering rulesets bind every branch of the family and always intersect
  together, and each other active branch ruleset carrying a
  `pull_request` rule joins them one group at a time, sharing a group
  with further overlapping rulesets only when those are not provably
  disjoint from each other as well. A ruleset stays out of every group
  only when provably disjoint from the pattern, judged on includes and
  exclusions together — an exclusion of the literal pattern or `~ALL`
  removes the ruleset from the family however broad its includes look —
  and disjoint meaning some segment position, before the first `**/` in
  either pattern, where both patterns are wildcard-free literals that
  differ, as `docs/*` is from `release/**/*` in the first. Positions
  past a `**/` prove nothing: it can match zero or more segments and
  shifts every alignment after it, so `foo/**/bar/**/*` and
  `foo/bar/baz/*` differ at their third literals and still both match
  `foo/bar/baz/qux`. Anything less certain intersects, and a conflict
  that appears only once a not-provably-overlapping member joins the
  group reports as not provably safe, naming the rulesets, rather than
  as plain drift; treating an
  unprovable overlap as safe is how this conflict hides until the first
  branch of the family exists. Check
  this against the rulesets themselves, not the branches: a pattern
  matching no branch yet — `release/**/*` before the first release branch —
  has no effective rules to read, so a branch-only audit finds nothing,
  `--fix` sees no missing rule, and the first branch of that family is
  created underprotected. Even full coverage leaves one gap to name:
  rules bind operations on a branch, and only the `creation` rule
  restricts bringing a matching branch into existence — a
  `pull_request` rule does not stop `git push origin release/1.0` from
  creating the branch with direct commits. Where a configured pattern
  matches no existing branch and `branch_rules` does not name
  `creation`, report that gap explicitly — a pass with a stated
  remainder, never silence. Whether to add `creation` is the baseline
  author's call: it closes the first-push hole and also blocks the
  legitimate first push of every branch in the family, so the audit
  reports the trade rather than deciding it.
- No ruleset counted on for any check above grants a `bypass_actors`
  entry whose `bypass_mode` is anything but `pull_request`. Rules bind
  pushes, but an `always` bypass lets its actor push past every rule in
  the ruleset, and an `exempt` actor is outside rule evaluation
  altogether — no rules run for them and no bypass audit entry is
  written — so the protection the checks credit that ruleset with is
  advisory for that actor. A bypass is scoped to its own ruleset,
  though, so judge what still binds the actor before calling it drift:
  where every `branch_rules` type keeps binding them through some
  co-applicable ruleset they cannot bypass, the protection holds and
  the bypass is a note in the report, not drift. Report drift — naming
  the ruleset, actor, and mode — only when the bypass leaves some
  required rule unenforced for that actor; a `pull_request`-mode bypass
  leaves direct pushes blocked and always passes. Even with `--fix`,
  never edit a bypass list — a
  bypass may be deliberate, so this drift ends in a question to the
  user, and Step 3 refuses to merge the baseline into a ruleset carrying
  one.
- The project's agent instructions cover the protected branches — Step 4
  defines this check and its fix.

Finish the report with one line stating the baseline source: the guardrails
file, or the built-in defaults.

## Step 3: Fix drift (only with --fix)

Without `--fix`, stop after the report. With it, present the exact changes,
then apply them. The writes lean on the baseline validation having already
run — a baseline error surfacing between writes would leave a partial fix,
which is why validation stops the run before Step 2 rather than merely
before the first write:

- Repository settings and merge methods. Take every value from the resolved
  baseline — the guardrails file where it sets a key, the built-in default
  where it does not — and send only the fields that drifted:

  ```bash
  gh api -X PATCH "repos/$OWNER/$REPO" \
    -F allow_merge_commit=<merge_methods.merge> \
    -F allow_squash_merge=<merge_methods.squash> \
    -F allow_rebase_merge=<merge_methods.rebase> \
    -F delete_branch_on_merge=<repository.delete_branch_on_merge> \
    -F allow_auto_merge=<repository.allow_auto_merge>
  ```

  Preflight the three merge-method fields before sending them. A pull
  request's usable methods are the intersection of these settings with
  every applicable `pull_request` rule, so no intermediate state may
  empty that intersection — and with several qualifying rulesets in
  play, rewriting them one at a time does exactly that: narrowing the
  first of two squash-only rulesets to rebase empties the intersection
  until the second write lands, and leaves it empty if that write
  fails. Run the whole merge-method transition in two phases. Phase one
  widens: `PATCH` the settings to the union of the baseline methods and
  the methods enabled today, and rewrite every qualifying ruleset's
  `pull_request` rule to the union of its current and target methods —
  enabling, never yet disabling. If any widening write fails, abort the
  whole coordinated transition and report it; a fully or partly widened
  state blocks nothing, while narrowing after a failed widening is how
  two formerly squash-only rulesets end up rebase-only against
  squash-only and block every pull request. The continue-past-refusals
  rule below covers unrelated writes only — never the remaining steps
  of a transition whose widening failed.
  Phase two narrows, only after every widening succeeded: rewrite each
  rule down to its target methods, then `PATCH` the settings down to
  exactly the baseline. Only when a conflicting rule is not writable
  from here — an inherited squash-only rule, already reported as
  found-but-not-fixable — is there no safe sequence at all: hold the
  merge-method fields, report them as blocked on that rule, and send
  the fields that carry no merge-method risk —
  `delete_branch_on_merge` and `allow_auto_merge` — on their own.

- Branch rules need a repository ruleset — one of those Step 1 fetched.
  Merge the baseline into an existing ruleset only when all of these hold:
  its `source_type` is `Repository` — Step 1's listing includes inherited
  rulesets, and a repository `PUT` cannot update an `Organization` one —
  its `target` is `branch`, its enforcement is `active`, its `ref_name`
  include list is exactly the resolved patterns as `refs/heads/<pattern>` —
  all of them and nothing more — its `ref_name` exclude list is empty,
  since exclusions take precedence over includes: a ruleset excluding
  `main` leaves `main` unprotected however exact its include list looks —
  and no `bypass_actors` entry carries a `bypass_mode` other than
  `pull_request`. The merge below preserves `bypass_actors` verbatim; an
  `always` bypass lets that actor push straight past every rule the
  merge would add, and an `exempt` one leaves the actor outside rule
  evaluation entirely — no rules run for them, and no bypass audit entry
  records it — so folding the baseline into such a ruleset claims a
  server-side guarantee one actor can walk around. Only a
  `pull_request`-mode bypass keeps direct pushes blocked and does not
  disqualify. Each condition
  rules out a way the merge
  goes wrong. A tag or push ruleset can carry matching ref-name conditions
  and still reject a `pull_request` rule, leaving branch protection unfixed.
  A broader ruleset — one targeting `~ALL`, or carrying include patterns
  outside the baseline — would impose the baseline on every branch it
  covers, and a narrower or disabled one leaves protected branches uncovered
  while looking handled. A ruleset conditioned on `~DEFAULT_BRANCH` is not
  exact scope either: that token follows a default-branch rename while the
  baseline and the generated guidance still name the old branch. Leave any
  of these alone and create the dedicated ruleset below instead.

  To merge, build a complete replacement from the writable fields of the
  fetched ruleset — `name`, `target`, `enforcement`, `bypass_actors`,
  `conditions`, `rules` — with the changes below applied, and send it with
  `PUT repos/$OWNER/$REPO/rulesets/<id>`. PUT replaces the ruleset, so any
  writable field left out is lost — but the GET response also carries
  response-only fields (`id`, `source`, `_links`, timestamps) the update
  schema rejects, so echoing it back verbatim fails validation.
  Merging means: add each
  `branch_rules` type the ruleset lacks, a parameterless type as a bare
  object but a missing `pull_request` rule with the complete parameter block
  from the creation payload below, since the API rejects that one bare; and
  drop from an existing `pull_request` rule's `allowed_merge_methods` any
  method `merge_methods` disables, keeping the rest of its list as it is —
  the audit accepts a subset stricter than the baseline, so rewriting the
  list to every enabled method would loosen a deliberately tighter rule. If
  the drop empties the list, the rule and the baseline share no method: use
  exactly the methods `merge_methods` enables instead — a `pull_request`
  rule must allow at least one, and the up-front validation guarantees there
  is one. Narrowing the repository's own rule is the whole fix, because the
  effective set is the intersection: a rule elsewhere allowing more needs
  no change. Planning each rule alone is not enough, though: two
  stricter subsets can each be valid and jointly empty — a squash-only
  and a rebase-only rule under a squash-plus-rebase baseline both
  survive the drop unchanged and intersect to nothing — and adding
  `required_linear_history` can leave a merge-only intersection that
  linear history forbids. Before writing anything, compute the
  effective intersection of every co-applicable `pull_request` rule as
  it will stand after the planned writes. If that intersection is
  empty, or merge-only while linear history will be in force, the plan
  preserves exactly the unmergeable state the audit flagged: do not
  write it. The stricter lists belong to someone, so reconciling them
  is the user's call — report the group as found-but-not-fixable,
  naming the rules. When the drift runs the other way — some other applicable
  `pull_request` rule allows no method the baseline enables, so the
  effective intersection stays empty whatever this ruleset says — first
  check where that rule lives. The merge criteria above select a set,
  not a single winner: several rulesets can satisfy every one of them,
  so enumerate the qualifying rulesets and apply the same merge to each.
  Two writable exact-scope squash-only rulesets under a rebase-only
  baseline both get rewritten and the drift clears — updating one and
  calling the other unfixable leaves the branches exactly as
  unmergeable as before. Only a conflict in a ruleset the criteria
  leave alone is beyond this command: report it found-but-not-fixable,
  naming the ruleset — it lives in organization configuration this
  command cannot write, or in a broader repository ruleset — a `~ALL`
  ruleset allowing only squash against a rebase-only baseline, say —
  and loosening either is not this command's call. An intersection that
  survives non-empty can be just as stuck: with
  `required_linear_history` in force, a stricter unwritable rule
  leaving only merge commits blocks every pull request, and widening it
  would loosen a deliberately tighter rule — the same verdict,
  found-but-not-fixable, naming the rule. Never
  remove or loosen rules the baseline does not mention.

  If no ruleset qualifies, create one — after the same compatibility
  preflight the merge runs. When an applicable `pull_request` rule this
  command cannot write shares no method with the baseline — the
  inherited squash-only rule against a rebase-only baseline above — a
  new baseline ruleset would stack its rebase-only rule on top of that
  one and empty the effective intersection, blocking every pull request
  on the branches both bind. Report that drift as still unfixed,
  blocked on the unwritable rule, and skip the create; it runs only
  when, for every co-applicable group, the intersection of all the
  unwritable applicable rules with the baseline methods stays
  non-empty — and keeps squash or rebase where linear history will be
  in force. Checking each rule on its own is not enough: an inherited
  squash-only rule and an inherited rebase-only rule each keep a method
  of a squash-plus-rebase baseline while their combined set is empty,
  and the created ruleset would land on a pattern that stays
  unmergeable. The JSON below is what the built-in
  defaults produce — build the actual payload from the resolved baseline:
  one `rules` entry per `branch_rules` type, with `allowed_merge_methods`
  listing exactly the enabled `merge_methods`:

  ```bash
  gh api -X POST "repos/$OWNER/$REPO/rulesets" --input - <<'EOF'
  {
    "name": "Protected branch guardrails",
    "target": "branch",
    "enforcement": "active",
    "conditions": {
      "ref_name": {
        "include": ["refs/heads/main", "refs/heads/master"],
        "exclude": []
      }
    },
    "rules": [
      { "type": "deletion" },
      { "type": "non_fast_forward" },
      { "type": "required_linear_history" },
      {
        "type": "pull_request",
        "parameters": {
          "required_approving_review_count": 0,
          "dismiss_stale_reviews_on_push": true,
          "require_code_owner_review": false,
          "require_last_push_approval": false,
          "required_review_thread_resolution": false,
          "allowed_merge_methods": ["rebase"]
        }
      }
    ]
  }
  EOF
  ```

  Adjust `include` to the resolved patterns — one `refs/heads/<pattern>`
  entry each, every pattern copied verbatim, since the baseline already uses
  ruleset syntax, where `*` stays within a path segment and only `**/`
  crosses `/`. Never substitute `~DEFAULT_BRANCH` for a literal pattern: it follows
  a default-branch rename, and the ruleset would then enforce a branch
  neither the baseline nor the agent guidance names.

- The settings `PATCH` and the ruleset writes all need admin. When any of
  them returns 403 or 404, report that drift as found-but-not-fixable,
  name the settings page — `https://$HOST/$OWNER/$REPO/settings` for
  the `PATCH`, `https://$HOST/$OWNER/$REPO/settings/rules` for a
  ruleset — and continue with the writes that remain. One refused write
  does not abort the run: the settings `PATCH` failing says nothing about
  whether the ruleset write would, and the report should show every fix
  that landed alongside every one that needs the browser. The exception
  is a write the failure invalidates. A `pull_request` rule's usable
  methods are the intersection of its `allowed_merge_methods` with the
  methods the repository itself enables, so after a refused settings
  `PATCH`, re-read the repository settings before any ruleset write: a
  rule sharing no method with what the repository still enables — a
  rebase-only rule landing on a repository the failed `PATCH` left
  squash-only — would leave every matched branch unmergeable. Hold that
  ruleset write, report it as blocked on the settings fix, and continue
  with the writes that do not depend on it.

Rulesets are outward-facing repository configuration: even with `--fix`,
show the whole coordinated plan — the ruleset JSON and every settings
`PATCH` it depends on — and get the user's confirmation before the first
dependent write, the phase-one widening `PATCH` included. Confirming
only the ruleset write would let a decline strand the repository
half-transitioned, its settings already widened for a ruleset change
that never happens. Confirmation can take arbitrarily long, and a `PUT`
payload built from the earlier GET replaces every writable field — so
after confirmation and before executing, re-run the Step 1 reads in
full — the repository settings, the ruleset listing with parents
included, and re-run the Step 4 discovery and classification over the
plan's local inputs too: the baseline file and every instruction source
the classification read, not only the guidance targets the plan would
write, whose ownership hashes were computed against pre-confirmation
text — an import, a nested instruction file, or a file created during
the wait can reclassify a chain while every planned target sits
untouched. Compare all of it
against the state the plan was built from. Re-fetching only the objects
the plan touches is not enough: a ruleset another administrator created
or changed during the wait can invalidate the compatibility calculation
while every touched object reads back unchanged. If anything differs,
another administrator was here: rebuild the plan from the fresh
state — the
merge-method safety calculation included — and confirm again rather
than silently overwriting their change. After
applying, re-run the read commands and report the
checklist again so the fix is verified, not assumed.

## Step 4: Agent guidance

The ruleset stops a protected-branch push at the server; guidance is what
stops an agent from attempting one. Audit it like the rest of the
configuration.

Agents do not read one shared pool of instruction files — each follows
its own entry points, and a rule an agent never loads does not guard
that agent. Audit coverage per chain, one chain for each mechanism the
repository actually carries:

- **Claude Code** loads its project memory automatically: `CLAUDE.md` at
  the repository root or `.claude/CLAUDE.md`, every markdown file under
  `.claude/rules/`, and every file any of those
  imports (an `@path` line imports that file — but only outside
  markdown code: Claude Code's import parser skips inline code spans
  and fenced code blocks, so an `@path` quoted as an example imports
  nothing, and following it would mark the chain Covered on guidance
  Claude never loads). `CLAUDE.local.md` loads
  too but never proves coverage — it is gitignored by design, one
  developer's machine-local file, and a pass that leans on it fails on
  every other clone; the audit counts only tracked files. Tracked
  `CLAUDE.md` files in subdirectories load on demand when Claude reads
  files there, like path-scoped rules, so they cannot prove
  repository-wide coverage either — but enumerate them anyway: one that
  conflicts with the rule for its subtree is a **Conflicting** finding,
  not a file to skip. Imports recurse, but
  Claude Code follows them only to its documented depth of four hops —
  bound the traversal the same way, and track visited files so an
  import cycle cannot loop the audit — because a rule reachable only
  past the fourth hop never enters Claude's context, and counting it
  reports Covered on guidance Claude never loads.
  Count a rules file only when it is unconditional: `paths:` frontmatter
  scopes a rule to reads of matching files, so a path-scoped rule is not
  in context while an agent runs a repository-wide `git commit` or
  `git push`, and guidance found only there is a false pass — as is
  anything imported solely from a path-scoped rule. Coverage counts only
  what is reachable from an unconditional entry point.
- **`AGENTS.md` agents** discover every tracked `AGENTS.md` and
  `AGENTS.override.md`, not only a root file — a repository whose only
  copy is `package/AGENTS.md`, or a lone `AGENTS.override.md`, still
  carries the chain. The override filename is no part of the standard,
  but the tools that read it discover it on its own and give it
  precedence — while standard-only agents never open it. So where both
  sit in one directory, neither file is "the one audited": they are two
  readings, and the rule must hold in each — in the override for the
  tools that prefer it, in the `AGENTS.md` for agents that know only
  the standard name — before that directory's scope passes. A lone
  `AGENTS.md` establishes the chain and is audited on its own; a lone
  `AGENTS.override.md` establishes the chain too, but it covers only
  the tools that read it — standard-only agents find no instructions in
  that directory at all — so the standard reading there is **Missing**,
  and `--fix` writes the sibling `AGENTS.md`.
  Build each scope's instructions root-to-leaf and
  classify the combination against both readings the ecosystem uses —
  the ratified standard has agents read the nearest file, a proposed
  revision makes ancestor guidance cumulative — and pass a scope only
  when every reading supplies the rule. A nested file that conflicts
  with the rule uncovers the directories it governs either way; one
  that merely omits it is not provably covered — the cumulative reading
  inherits the ancestor's rule, the nearest-file reading never loads
  it — so classify that scope as **Missing**, naming the ancestor only
  one reading would supply, and let the fix write the rule where every
  reading sees it. A standalone `AGENTS.md` is
  not in Claude Code's context unless a `CLAUDE.md` imports it, and
  `.claude/` memory is invisible to agents that read only `AGENTS.md` —
  the same rule can cover one chain and miss the other.
- **GitHub Copilot** combines several repository sources:
  `.github/copilot-instructions.md`, and where tracked, the root
  `AGENTS.md`, the root `CLAUDE.md`, and the root `GEMINI.md` too.
  Classify this chain from
  the union of those repository-wide files — a rule Copilot already
  receives through the root `AGENTS.md` is not drift here, and
  appending it again would duplicate guidance. A nested `AGENTS.md`
  never joins this union: Copilot working outside its directory loads a
  different nearest file, so a rule found only in `package/AGENTS.md`
  proves nothing repository-wide, and counting it would have `--fix`
  skip the repository-wide target. Path-scoped `*.instructions.md`
  files under `.github/instructions/` — Copilot loads nothing else
  from that directory, and loads these only for the files their
  `applyTo` frontmatter matches — never prove coverage, like
  path-scoped rules above, but enumerate them: one whose text permits
  committing or pushing to a protected branch is a **Conflicting**
  finding for the work it scopes, exactly like a conflicting nested
  `CLAUDE.md` or path-scoped rule. When the
  whole union misses the rule, the chain is
  **Missing** and the fix target is `.github/copilot-instructions.md`.

These are the audited mechanisms, and the list is a deliberate boundary,
not an oversight. Agents with other discovery conventions — Cursor
rules, Windsurf, Cline, whatever ships next — are out of scope;
extending the audit to one is a deliberate edit to this command, not an
implied requirement of any check above.

Judge the content, not strings — the rule can be worded any number of
ways, and an instruction file may itself say where guidance belongs (a
`CLAUDE.md` that defers to another file means that file is where the
rule lives and where any fix goes). Imports can resolve outside the
repository — a shared `~/.claude/CLAUDE.md`, say. An external file never
satisfies coverage, whatever it contains: the audit is of the
repository, and a pass that leans on one machine's home directory fails
on every other clone. Resolve such a path and note it — never open it.
The audit cannot use the content, so reading a repository-authored
`@~/.claude/...` or `@/etc/...` import would only pull host-local data
into the session. The boundary is judged on resolved paths, not
apparent ones: a tracked instruction file, an import, or a fix target
can be a symlink sitting at a repository path while resolving outside
it. Canonicalize every path before reading or writing — for a file to
be created, its nearest existing parent — and treat anything resolving
outside the repository as external: note it, never read it, and never
write through it. Containment is necessary, not sufficient: the
resolved target must also be tracked. A tracked symlink to an untracked
file inside the checkout reads as guidance on this machine and as
nothing on a clean clone, so it neither satisfies coverage nor accepts
a `--fix` write — report it for manual cleanup. Note the external file
in the report, but classify
each chain from its checked-in files alone; conventions pointing only at
an external file classify as **Missing**, and the fix writes to the
checked-in target.

Classify each chain by what its files say about committing or pushing to
the protected branches:

- **Covered** — some file in the chain already tells agents not to
  commit or push to them, in any wording: "no direct commits", "always
  branch first", "open a pull request instead" — and nothing else in
  the chain conflicts. Where one instruction forbids and another
  permits, **Conflicting** wins: the two classifications report and fix
  differently, so a chain is Covered only when it carries the rule and
  no contradiction of it. The chain passes; name
  the file. The guidance line of the report passes only when every chain
  the repository carries is covered — otherwise it is drift, naming each
  chain that is not.
- **Missing** — nothing in the chain says anything about it. Report
  drift for that chain.
- **Conflicting** — the guidance disagrees with the baseline: it
  permits committing or pushing to a baseline branch or pattern, names
  a different set of branches in a way that excludes a baseline one, or
  mandates a workflow the baseline forbids. Guidance that merely adds
  restrictions — extra protected patterns beyond the baseline, a
  stricter workflow — is **Covered**, not conflicting: more protection
  is not disagreement. Report drift and quote both
  texts, but never rewrite the prose — it may be deliberate, and the
  baseline may be the thing that is stale. Even with `--fix`, a conflict
  ends in a question to the user, not an edit.

With `--fix`, only the **Missing** case writes, once per missing chain —
but chains can resolve to the same file: a root `CLAUDE.md` that defers
to `AGENTS.md` makes that one file both the Claude Code target and the
`AGENTS.md` target. Collect every target path first, deduplicate, and
write one block per file — a second marked block in the same file
leaves two marker pairs the later ownership check cannot tell apart.
Deduplication only keeps this run from writing duplicates; the file may
already be malformed. Before classifying or writing anything, check
each target's marker structure: exactly zero or one begin/end pair,
matched and in order. Duplicate, nested, or unmatched markers make
"the found block" ambiguous — never edit such a file, and report it
for manual cleanup instead.
Append the marked block to the file each chain's conventions point at —
for Claude Code the root `CLAUDE.md` when nothing says otherwise, for
the Copilot chain `.github/copilot-instructions.md` itself, and
for the `AGENTS.md` chain the root `AGENTS.md`, created when the chain
lives only in nested files — a nested file governs only its subtree,
so appending to the topmost nested file would leave every sibling and
root scope bare, and once any AGENTS mechanism is tracked,
repository-wide coverage needs the root file — plus each tracked
`AGENTS.md` or `AGENTS.override.md` whose own text omits the rule, so
the nearest-file reading carries it in every scope, not only the
cumulative one. A nested file that conflicts is different: that is a
**Conflicting** classification and ends in a question, not a write. A
mechanism the
repository does not carry is no chain at all: a repository with no
tracked `AGENTS.md` anywhere is audited on the Claude Code chain
alone, and no file is created to start one.

A file the fix creates starts untracked, and the tracked-only audit
would classify its chain as Missing all over again on the post-fix
rerun — so stage the files the confirmed fix creates, and the rerun
sees them. The reverse case is off limits: a pre-existing untracked
file already sitting at a target path is the user's unfinished work.
Never edit or stage it; report the guidance fix as pending until the
user tracks or removes that file.

The block's text is canonical, not free prose:
the stale check below compares bytes, so every run must render the same
baseline to the same bytes. The text is exactly these three lines, with
`<patterns>` substituted and nothing rewrapped, however long the pattern
list makes the first line:

```text
Never commit or push to <patterns>. Create a topic branch
first (`git switch -c <type>/<short-description>`) and open a pull
request instead.
```

`<patterns>` renders the resolved patterns in baseline order — the
guardrails file's order, or `main` then `master` from the defaults —
each in backticks and joined by count: one pattern stands alone, two
read `` `a` or `b` ``, and three or more read `` `a`, `b`, or `c` `` —
a comma after every pattern but the last, and "or" before the last. A
`main` plus `release/**/*` baseline therefore produces exactly:

```markdown
<!-- jcouball-github guardrails: begin sha256:<hash> -->
Never commit or push to `main` or `release/**/*`. Create a topic branch
first (`git switch -c <type>/<short-description>`) and open a pull
request instead.
<!-- jcouball-github guardrails: end -->
```

`<hash>` is the first 12 lowercase hex digits of the SHA-256 of the
three lines between the markers, each line including its terminating
newline — the last one too — and the markers excluded (`shasum -a 256`
or `sha256sum` over exactly those bytes). That hash is the ownership
signal: on a later run,
before classifying a found block, recompute the hash of its current text
and compare.

- Hash matches → the block is untouched machine output. Compare it to
  what the current baseline generates: identical → **Covered**; different
  → the block is stale, and `--fix` rewrites the block — the three body
  lines and the opening marker both, since the marker carries the hash.
  Rewriting only the text between the markers leaves the old hash
  behind, and the next audit reads the mismatch as a user edit. This
  exact-regeneration comparison — not the semantic
  classification above — is how a changed baseline propagates.
- Hash differs → someone edited the block and it is now the user's prose:
  classify it semantically like any other text and never rewrite it —
  and never append beside it either. Whatever the classification, a
  file already carrying a marker pair is closed to the Missing write:
  appending a second block would manufacture the duplicate-marker state
  the structure check above refuses to touch. When such a file's chain
  still misses the rule, report the file for manual cleanup.

A deleted block leaves no trace, so a repository without one is simply
classified by the rules above — usually **Missing**, which means `--fix`
appends the block again. To keep the guidance out for good, replace the
block with your own wording instead of deleting it: hand-written text
classifies as **Covered** or **Conflicting** and is never overwritten.

Text outside the markers always belongs to the user and only ever gets
the semantic classification above.
