---
description: Audit the GitHub repository's branch protection, merge methods, settings, Actions token default, and agent guidance against the guardrails baseline, and optionally fix drift
argument-hint: "[--fix]"
---

Audit this repository's GitHub configuration against its guardrails baseline
and report every point of drift. Apply fixes only when `$ARGUMENTS` is
exactly `--fix`, and only after showing what would change. Empty arguments
mean a report-only run, and anything else — `--fix=false`, a typo, an extra
word — is an error that stops the command: a substring test would let
`--fix=false` trigger repository writes.

The deterministic work — reading the baseline and the live configuration,
comparing them, planning and applying the writes, and rendering the guidance
block — is done by a script that ships with this plugin, so the same inputs
always produce the same checklist. This command's job is what the script
cannot do: reporting, judging the prose of agent guidance, and getting the
user's confirmation before anything outward-facing changes.

Needs the `gh` CLI authenticated (`gh auth status`) at version 2.42 or
later, `node` 22 or later, and `git`. The script is at
`${CLAUDE_PLUGIN_ROOT}/scripts/check-repo-config.mjs`. When that variable
is not set — this command was pasted rather than run from the installed
plugin — clone `https://github.com/jcouball/agent-plugins` into a
temporary directory and use `plugins/github/scripts/check-repo-config.mjs`
from the clone. Every invocation below is written as:

```bash
SCRIPT="${CLAUDE_PLUGIN_ROOT}/scripts/check-repo-config.mjs"
```

Every subcommand prints one JSON document to stdout. A non-zero exit means
the document is an error to report: 1 is a fatal error or bad usage, 2 is a
baseline error, 3 is a stale plan, and 4 is a refused guidance write.

## The baseline

The baseline is `.claude/repo-guardrails.yml` at the repository root. The
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
actions:                 # the default GITHUB_TOKEN every workflow run gets
  default_workflow_permissions: read
  can_approve_pull_request_reviews: false
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
`release/**/*` to cover any depth. `branch_rules` may name `pull_request`
and the parameterless types `creation`, `deletion`, `non_fast_forward`,
`required_linear_history`, and `required_signatures`. Requiring status
checks to pass before merge is deliberately out of scope: check contexts
vary per repository, so configure that gate by hand in the ruleset when
wanted — the audit never removes or loosens rules the baseline does not
mention, so a hand-added rule survives every `--fix`.

Where the file is missing or a key is absent, the built-in defaults apply:
`main` and `master`; rebase only; `delete_branch_on_merge: true` and
`allow_auto_merge: false`; a `read` token that cannot approve pull
requests; and the four rule types above.

The script validates the resolved baseline before reading anything from
GitHub, in a report-only run as much as under `--fix`, and exits 2 with a
`baseline_errors` list when the file has an unknown or duplicate key, a
value of the wrong shape, an empty or duplicated pattern, a pattern that is
a selector token or carries a `refs/` prefix, an unsupported or duplicated
rule type, no `pull_request` rule, no enabled merge method, or
`required_linear_history` beside merge commits as the only method. It also
exits 2 when the file is a symlink resolving outside the repository or to
an untracked file. Report those errors verbatim and stop: a misread file is
worse than a missing one, because the audit would otherwise report pass and
drift confidently against the wrong baseline.

## Step 1: Audit

```bash
PLAN="$(mktemp -d)/plan.json"
node "$SCRIPT" audit --plan-out "$PLAN"
```

The script binds the target to the checkout — it drops `GH_REPO`, resolves
the host, owner, name, and whether the owner is an organization through
`gh repo view`, and passes the host to every call — then reads the
repository settings, whether Actions is enabled and the token default when
it is, every branch matching a protected pattern and its effective rules,
and every branch ruleset including those inherited from the organization,
each fetched in full through its own source's endpoint. It compares all of
that to the baseline and writes the plan `--fix` would apply to `$PLAN`.
Nothing is written to GitHub.

The output has `baseline` (its `source` and the `resolved` values),
`repository`, `checks`, and `plan`. Each check carries an `id`, a `group`
(`repository`, `actions`, `branch:<name>`, `pattern:<pattern>`, or
`bypass`), a `label`, a `status`, and where they apply `expected`,
`actual`, `detail`, and `where` — the settings page where the value is read
or changed by hand. The statuses:

- `pass` — the setting matches the baseline.
- `drift` — it does not. `detail` says how.
- `partial` — it could not be read from here. The `detail` quotes the
  endpoint's failure; `where` names the page to read it by hand. Never
  report a partial check as a pass.
- `not_applicable` — the Actions token fields while Actions is disabled:
  no workflow runs and no token is issued, so the fields govern nothing.
  `where` names the repository's Actions settings page and, in an
  organization, the organization's too, since a policy there may be what
  switched Actions off.
- `note` — a pass with a stated remainder: a pattern matching no branch yet
  while `branch_rules` lacks `creation`, or a bypass that another ruleset
  still binds.
- `unprovable` — a merge-method conflict that appears only once a ruleset
  not provably overlapping the pattern joins the group. It is possible
  rather than certain, and the plan treats it as unsafe to write.

The pattern checks audit the rulesets themselves, not the branches: a
pattern matching no branch yet has no effective rules to read, so only the
ruleset can show whether the first branch of that family will be born
protected. Coverage counts only a literal `refs/heads/<pattern>` include or
`~ALL`; a broader glob reports as drift even when it happens to cover, and
`~DEFAULT_BRANCH` proves coverage of a branch, not of a pattern, since the
guarantee would expire on a rename.

## Step 2: Compare and report

Report a checklist, one line per check, grouped as: repository settings,
the Actions token default, each protected branch, each configured pattern,
bypasses, then agent guidance (Step 4 defines that line). For drift show
expected vs actual; for partial and not applicable, name `where`. When the
Actions group is checked, say that it checks the default token only: a
workflow that declares its own `permissions:` block gets what it declares,
and a job-level block can still raise permissions above the default — a
release workflow asking for `contents: write` is normal. Auditing each
workflow's block is a lint concern and out of scope here.

A `bypass` drift is a question for the user, never a fix: an `always`
bypass lets its actor push past every rule in the ruleset and an `exempt`
actor is outside rule evaluation altogether, but a bypass may be
deliberate. Name the ruleset, actor, and mode, and ask.

Then report `plan.held`: each entry lists the drifted checks `--fix`
cannot clear, the `reason`, and `where` to make the change by hand. These
are found-but-not-fixable: a conflicting rule in an organization ruleset or
a broader repository ruleset this command will not loosen, a parent ruleset
that could not be read and so blocks every ruleset write and merge-method
change, or a token field whose endpoint could not be read.

Finish the report with one line stating the baseline source: the guardrails
file, or the built-in defaults.

## Step 3: Fix drift (only with --fix)

Without `--fix`, stop after the report. With it, present `plan.steps` in
order — each step's `description`, and for a ruleset write its full `body`
— alongside the held entries, so the user sees the whole coordinated plan
and what it leaves alone. The plan is already safe to apply as a whole:

- Repository settings and the Actions token default are sent as the fields
  that drifted, taking every value from the resolved baseline.
- A merge-method change runs in two phases. Phase one widens: the settings
  `PATCH` enables the union of today's methods and the baseline's, and
  every qualifying ruleset's `pull_request` rule is rewritten to the union
  of its current and target methods. Phase two narrows, only after every
  widening write succeeded. No intermediate state empties the intersection
  that decides which methods a pull request can use.
- Branch rules are merged into an existing repository ruleset only when it
  is active, targets branches, includes exactly the resolved patterns and
  nothing more, excludes nothing, and carries no bypass other than
  `pull_request` mode. Merging adds the missing rule types and drops from
  its `pull_request` rule any method the baseline disables, keeping a
  stricter list as it is. When no ruleset qualifies, one named
  `Protected branch guardrails` is created with exactly the baseline's
  patterns and rules. Nothing the baseline does not mention is removed or
  loosened, and a bypass list is never edited.
- Before planning any ruleset write, the script computes the merge-method
  intersection of every group of rules a single branch could meet as it
  would stand after the writes. An empty intersection, or merge-only under
  linear history, means the plan would preserve the unmergeable state the
  audit flagged: those writes are held instead, with the rules named.

Rulesets are outward-facing repository configuration. When
`plan.confirm_required` is true, get the user's confirmation of the whole
plan before the first write — the widening `PATCH` included, since
confirming only the ruleset write would let a decline strand the repository
half-transitioned. Confirmation can take arbitrarily long, so after it, and
before applying, re-run the Step 4 discovery and classification over the
plan's local inputs — the baseline file and every instruction source the
classification read — because an import, a nested instruction file, or a
file created during the wait can reclassify a chain. Then apply:

```bash
node "$SCRIPT" apply "$PLAN"
```

The script repeats every read first and compares the result to the state
the plan was built from, leaving out the branches the baseline does not
protect, so a topic branch pushed or deleted during the wait changes
nothing. Exit 3 means something else differs: another administrator was
here, or the baseline file changed. The output carries a fresh audit;
report that, rebuild the plan from a new `audit` run, and confirm again
rather than writing over their change.

Otherwise the output has `steps`, one result per planned step, and
`audit`, the checklist re-read after the writes. Report each step by its
`status`:

- `applied` — the write succeeded and the re-read confirmed it.
- `refused` — 403 or 404: admin access is missing. Report the drift as
  found-but-not-fixable and name the page in `where`. One refused write
  does not abort the rest; the output shows every fix that landed beside
  every one that needs the browser.
- `capped` — a 409 on a loosening Actions write in an organization-owned
  repository: the organization caps that field. Name the organization's
  Actions settings page from `where`, or its enterprise's where the
  organization inherits the value.
- `failed` — any other error, with GitHub's status and message. A 409 on a
  tightening write, or on a user-owned repository, has no documented
  cause: report the message as given and do not explain it.
- `skipped` — not attempted, with the `reason`: the coordinated transition
  was aborted because a widening write failed, or a ruleset write was held
  because the settings `PATCH` was refused and the rule would leave every
  matched branch with no usable merge method.
- `unverified` — the write returned success but the re-read failed; the
  `message` quotes the API.

The Actions endpoint can lag its own write, so the script re-reads a
written field until it matches, up to five reads a second apart, and
reports a failed fix only after the fifth. Finish by reporting the
checklist from the returned `audit`, so the fix is verified, not assumed.

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

### The guidance block

The fix for a **Missing** chain is a marked block of canonical text, and
the script owns its bytes: the opening marker carries a hash of the body,
which is how a later run tells untouched machine output from a user's
edit. Before classifying a file's text, ask the script what it finds:

```bash
node "$SCRIPT" guidance render            # the block the current baseline produces
node "$SCRIPT" guidance inspect <file>    # what a file carries, and where the path really points
```

`inspect` reports the file's resolved path, whether it is inside the
repository and tracked, and a `classification`:

- `absent` — no markers. Classify the text semantically as above.
- `machine-current` — an untouched block matching the current baseline.
  The chain is **Covered** by it.
- `machine-stale` — an untouched block from an earlier baseline. This is
  how a changed baseline propagates: report it as drift, and `--fix`
  rewrites the block, marker and body both.
- `edited` — the block's text no longer matches its hash, so it is the
  user's prose now. Classify it semantically and never rewrite it. A file
  carrying a marker pair is also closed to a new block: when its chain
  still misses the rule, report the file for manual cleanup.
- `malformed` — duplicate, nested, or unmatched markers. Never edit such a
  file; report it for manual cleanup.
- `external` — the path resolves outside the repository. Note it and
  never read it.

With `--fix`, write only the **Missing** chains and the stale blocks, once
per target file. Chains can resolve to the same file — a root `CLAUDE.md`
that defers to `AGENTS.md` makes that one file both the Claude Code target
and the `AGENTS.md` target — so collect every target path first,
deduplicate, and run one write per file:

```bash
node "$SCRIPT" guidance write <file>
```

The targets are the file each chain's conventions point at: for Claude
Code the root `CLAUDE.md` when nothing says otherwise, for the Copilot
chain `.github/copilot-instructions.md` itself, and for the `AGENTS.md`
chain the root `AGENTS.md`, created when the chain lives only in nested
files — a nested file governs only its subtree, so appending to the
topmost nested file would leave every sibling and root scope bare — plus
each tracked `AGENTS.md` or `AGENTS.override.md` whose own text omits the
rule, so the nearest-file reading carries it in every scope. A mechanism
the repository does not carry is no chain at all: a repository with no
tracked `AGENTS.md` anywhere is audited on the Claude Code chain alone,
and no file is created to start one.

`write` appends the block to a file without markers, creating the file
when it does not exist, and rewrites a stale block in place. It exits 4
and writes nothing when the path resolves outside the repository, when a
file already at the path is untracked — that is the user's unfinished
work; report the fix as pending until they track or remove it — or when
the block is edited or the markers malformed. A file the fix creates
starts untracked, and the tracked-only audit would classify its chain as
Missing all over again on the post-fix rerun, so stage the files the
confirmed fix creates.

A deleted block leaves no trace, so a repository without one is simply
classified by the rules above — usually **Missing**, which means `--fix`
appends the block again. To keep the guidance out for good, replace the
block with your own wording instead of deleting it: hand-written text
classifies as **Covered** or **Conflicting** and is never overwritten.
Text outside the markers always belongs to the user and only ever gets the
semantic classification above.
