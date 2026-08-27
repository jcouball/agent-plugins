---
name: resolve-pr-feedback
description: 'Resolves unresolved pull request review threads and suppressed (low-confidence) Copilot review comments on the current branch, folds each fix into the existing commit that last touched the same file, force-pushes with lease, and requests a fresh Copilot review. Use when addressing PR feedback, resolving review comments or threads, handling comments suppressed due to low confidence, amending fixes into prior commits, or asking Copilot to re-review after changes. If the current project has its own resolve-feedback or resolve-pr-feedback skill, that file holds project-specific changes and additions: still run this skill, and apply those changes on top (Step 0).'
---

# Resolve PR Feedback

Address the unresolved review threads and suppressed comments on the pull
request for the current branch, folding each fix into the existing commit that
last touched the affected file, then force-push and request another Copilot
review.

## Contents

- [Contents](#contents)
- [How to use this skill](#how-to-use-this-skill)
- [Prerequisites](#prerequisites)
- [Terms](#terms)
- [Safety and stop points](#safety-and-stop-points)
- [Workflow](#workflow)
- [Step 0: Apply project overrides](#step-0-apply-project-overrides)
- [Step 1: Identify the PR and branch](#step-1-identify-the-pr-and-branch)
- [Step 2: Fetch unresolved review threads](#step-2-fetch-unresolved-review-threads)
- [Step 3: Fetch suppressed comments](#step-3-fetch-suppressed-comments)
- [Step 4: Triage each item](#step-4-triage-each-item)
- [Step 5: Implement the changes](#step-5-implement-the-changes)
- [Step 6: Fold each change into the matching commit](#step-6-fold-each-change-into-the-matching-commit)
- [Step 7: Force-push the branch](#step-7-force-push-the-branch)
- [Step 8: Reply to and resolve threads](#step-8-reply-to-and-resolve-threads)
- [Step 9: Request another Copilot review](#step-9-request-another-copilot-review)
- [Troubleshooting](#troubleshooting)

## How to use this skill

Invoke this skill when a PR has review feedback to address on the current
branch. Work top to bottom. Stop and ask the user whenever a thread or
suppressed comment needs a clarification or decision (Step 4) and before the
history-rewriting force-push (Step 7).

## Prerequisites

- The `gh` CLI is installed and authenticated (`gh auth status`).
- The `jq` CLI is installed (Step 3 pipes `gh api` output through it).
- The current branch has an open PR and is a topic branch (not the default
  branch or a release/maintenance branch).
- The working tree has no unrelated uncommitted changes before starting.

## Terms

- **Unresolved review thread** — a PR review thread whose `isResolved` is
  `false` in the GitHub GraphQL API.
- **Suppressed comment** — a comment Copilot withheld from the thread list,
  embedded in a review body in a `<details>` block headed "Suppressed comments
  (N)", either as the block's `<summary>` or as a markdown heading inside it.
  It has no thread ID or comment ID, so it can be neither replied to nor
  resolved — its disposition is reported in the final summary instead (Step 9).
- **Base** — the merge-base between the PR base branch and `HEAD`, computed with
  `git merge-base origin/<base-branch> HEAD`. All commit lookups are scoped to
  `<base>..HEAD` so only this branch's commits are considered.
- **Target commit** — the newest commit in `<base>..HEAD` that last touched the
  file a fix applies to. Each fix is folded into its target commit.

## Safety and stop points

These rules are mandatory:

- Never rewrite history on the default branch or a release/maintenance branch.
  Confirm the branch first with `git branch --show-current`.
- Stop and ask the user whenever a thread or suppressed comment requests a
  clarification or decision (Step 4). Do not guess on ambiguous feedback.
- Force-push only with `--force-with-lease`, and only after the user confirms
  (Step 7).
- Do not resolve a thread until its fix is committed and pushed (Step 8).

## Workflow

0. [Apply project overrides](#step-0-apply-project-overrides)
1. [Identify the PR and branch](#step-1-identify-the-pr-and-branch)
2. [Fetch unresolved review threads](#step-2-fetch-unresolved-review-threads)
3. [Fetch suppressed comments](#step-3-fetch-suppressed-comments)
4. [Triage each item](#step-4-triage-each-item) — ask for clarifications or
   decisions as needed
5. [Implement the changes](#step-5-implement-the-changes)
6. [Fold each change into the matching commit](#step-6-fold-each-change-into-the-matching-commit)
7. [Force-push the branch](#step-7-force-push-the-branch)
8. [Reply to and resolve threads](#step-8-reply-to-and-resolve-threads)
9. [Request another Copilot review](#step-9-request-another-copilot-review)

## Step 0: Apply project overrides

A project may carry its own thin copy of this workflow holding only its local
changes and additions — extra protected branches, the project's test command,
links to related project skills. Check for one at each of these paths and use
the first that exists:

- `.claude/skills/resolve-pr-feedback/SKILL.md`
- `.github/skills/resolve-pr-feedback/SKILL.md`
- `.github/skills/resolve-feedback/SKILL.md`

If one exists, read it and apply its changes and additions throughout the
workflow. Where it conflicts with this skill, the project file wins. If that
file is what invoked this skill, its changes are already in context — do not
re-read it, and do not re-invoke anything it names.

If none exists, run this skill as written.

## Step 1: Identify the PR and branch

Confirm the branch and locate the PR for it:

```bash
git branch --show-current
gh pr view --json number,title,headRefName,baseRefName,url,state
```

Record the PR number, `baseRefName` (the base branch), and URL. If no PR is
associated with the branch, stop and tell the user.

## Step 2: Fetch unresolved review threads

List every review thread and keep the ones where `isResolved` is `false`.
`--paginate` walks the pages, so a PR with more than 100 review threads needs
no second command. gh supplies the `$endCursor` variable on each request, and
the query has to declare it and expose `pageInfo` for that to work.

```bash
OWNER=$(gh repo view --json owner --jq '.owner.login')
REPO=$(gh repo view --json name --jq '.name')
PR_NUMBER=$(gh pr view --json number --jq '.number')

gh api graphql --paginate -f query='
  query($owner:String!, $repo:String!, $pr:Int!, $endCursor:String) {
    repository(owner:$owner, name:$repo) {
      pullRequest(number:$pr) {
        reviewThreads(first:100, after:$endCursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isResolved
            isOutdated
            path
            line
            comments(first:30) {
              nodes { databaseId author { login } body }
            }
          }
        }
      }
    }
  }' -F owner="$OWNER" -F repo="$REPO" -F pr="$PR_NUMBER" \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)'
```

For each unresolved thread, note its `id` (thread ID, needed to resolve it), the
first comment `databaseId` (needed to reply), the `path`, and the `line`.

## Step 3: Fetch suppressed comments

Copilot omits low-confidence findings from the thread list and instead embeds
them in its review body, in a `<details>` block headed "Suppressed comments
(N)". It has two templates for that block and uses both:

```text
<details>                                    <details>
<summary>Suppressed comments (1)</summary>   <summary>Review details</summary>

**path/to/file.rb:731**                      ### Suppressed comments (1)
* the finding...
                                             **path/to/file.md:336**
                                             * the finding...
```

On the left the `<summary>` is the marker and there is no heading at all. On
the right the `<details>` is a general "Review details" wrapper and a markdown
heading marks the section inside it. Which one appears tracks the shape of the
body around it — a review opening `## Pull request overview` uses the left
form, one opening with a verdict line such as `### 🔵 Needs a closer look` uses
the right — so both are current and the filter has to accept either. Print the
newest review whose body carries the section, then read it out of the printed
body:

```bash
gh api "repos/$OWNER/$REPO/pulls/$PR_NUMBER/reviews" --paginate |
  jq -sr 'add
    | (map(select((.user.login // "")
        | startswith("copilot-pull-request-reviewer")))) as $copilot
    | ($copilot | map(select((.body // "")
        | test("(^|\n)(#{1,6} *|<summary> *)Suppressed comments"; "i")))) as $hits
    | "scanned \($copilot|length) Copilot review(s); \($hits|length) carry a suppressed section",
      ($hits | sort_by(.submitted_at) | last // empty
        | "\nreview \(.id) by \(.user.login) at \(.submitted_at)\n\n\(.body)")'
```

Restrict the scan to Copilot before matching anything. Only Copilot writes a
suppressed section, but `/pulls/.../reviews` returns every review on the pull
request, and a reply posted through this skill's own Step 8 creates a review
record too — this pull request has ten of them. Counting those inflates the
denominator with reviews that could never match, and worse, a human review that
quotes either marker, which is what happens the moment someone pastes a
suppressed section into a review to discuss it, sorts to `last` and prints in
place of Copilot's. `startswith` covers the login with and without its `[bot]`
suffix.

Read the count line before the body. It is there because the failure this
filter is prone to is silent: a filter that matches nothing and a pull request
with nothing suppressed produce the same empty output. Counting only Copilot's
reviews is what makes the number worth reading — `0 of 11` says something,
`0 of 21` where ten are your own replies does not.

The count does not tell those two apart, and must not be read as if it did.
Copilot suppresses nothing on plenty of reviews, so `scanned 17 review(s); 0
carry a suppressed section` is a perfectly ordinary result and is not evidence
of drift. What the count does is make the ambiguity visible where the bare
empty output hid it. Treat a zero as a reason to open one review body and look
for the section yourself, and do that before reporting no suppressed comments
on a pull request Copilot has reviewed several times. This step has been wrong
twice in exactly that way. It first searched for "Comments suppressed due to
low confidence", a string Copilot does not emit anywhere; then it anchored on
the markdown heading alone, which matched every sample in this repository and
none of the eighteen sections across eight pull requests in ruby-git, every one
of which uses the `<summary>` form. Both versions reported "no suppressed
comments" and neither looked broken. Sample a second repository before
believing a pattern generalizes.

Match the marker, not the word. Two loosenings are tempting and both are wrong:

- Matching the word "suppressed" anywhere in the body. Copilot quotes the lines
  it is commenting on, so reviewing a file that discusses suppressed comments —
  this one has two dozen such lines — puts the word in a body that has no
  section. That is not merely a wasted match: the pipeline takes `last` of what
  survives the filter, so a false positive on a *newer* review hides the real
  section on an older one. Loosening the pattern turns into a miss.
- Requiring the exact heading including its `(N)` count. The count is not
  evidence of anything, and pinning the format of a number and its parentheses
  adds a way to break for no gain.

`#{1,6}` accepts any heading level, and the `"i"` flag any capitalization, which
is as much slack as can be given without matching prose.

The pipeline sorts the matching reviews by `submitted_at` and keeps only the
last one — the listing order of `/pulls/.../reviews` is not guaranteed, and
suppressed sections in earlier reviews describe superseded revisions of the
code. The `-r` flag prints the body as raw text (real newlines instead of a
JSON-escaped string) under a one-line header identifying the review.

Note the pipe into `jq -s`, rather than `gh --jq`. With `--paginate`, `gh`
applies `--jq` to each page separately, so anything that aggregates — a
`length`, a `sort_by`, a `last` — runs per page and emits one result per page
instead of one overall. Slurping with `-s` collects the pages into one array,
and `add` concatenates them into a single list so the aggregation runs once
across every item.

The `add` step depends on each page being an array, which is what the list
endpoints used here return — reviews, comments, the timeline. Use this form
whenever a `--paginate` response is a list per page and is reduced to a single
value; an endpoint that pages an object needs a different fold.

For each suppressed comment, record the file path, the line reference, and the
comment text from the section body.

Before triaging, check each suppressed comment against the current working
tree: line numbers in an older review body may have drifted, and a later push
may already have addressed the finding. Drop the ones that no longer apply and
note them for the final summary (Step 9).

## Step 4: Triage each item

For each unresolved thread and each still-applicable suppressed comment,
classify it and act:

- **Actionable and unambiguous** → plan the concrete code or doc change.
- **Needs a clarification or decision** → stop and ask the user. Present the
  item's file, line, and comment text, and the specific question or the
  options you see. Wait for the answer before implementing.
- **Not applicable / disagree** → do not change code. For a thread, draft a
  short, respectful reply explaining why (used in Step 8). For a suppressed
  comment, note the reasoning for the final summary. Ask the user if you are
  unsure whether to push back.

Triage suppressed comments with the same rigor as threads — low confidence
means Copilot was unsure, not that the finding is wrong.

Do not proceed to Step 5 for an item until its resolution is clear.

## Step 5: Implement the changes

Apply the agreed changes in the workspace. Keep edits for each item minimal and
scoped to what the feedback asks. Before folding changes into commits, run the
project's local CI equivalent — whatever task the project uses to run its tests
and linters locally (a default rake task, `make check`, an npm `test` script,
or similar). Fix any failures before continuing.

## Step 6: Fold each change into the matching commit

Amend each change into its target commit — the existing commit on this branch
that last touched the file — instead of adding new follow-up commits.

1. Compute the base once:

   ```bash
   BASE=$(git merge-base origin/<base-branch> HEAD)
   ```

2. For each changed file, find its target commit (the topmost line is newest):

   ```bash
   git log --oneline "$BASE"..HEAD -- <path>
   ```

3. Stage that file and create a fixup commit aimed at its target SHA:

   ```bash
   git add <path>
   git commit --fixup=<target-sha>
   ```

   Repeat for each changed file. When several files share the same target
   commit, stage them together for one fixup.

4. Autosquash the fixups into their targets non-interactively:

   ```bash
   GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash "$BASE"
   ```

5. Verify the result — the fixup commits should be gone and history should be
   clean:

   ```bash
   git --no-pager log --oneline "$BASE"..HEAD
   git status --short --branch
   ```

If a change does not correspond to any existing commit (e.g. a brand-new file
requested in review), ask the user whether to fold it into a related commit or
add a new, conventionally formatted commit.

## Step 7: Force-push the branch

History was rewritten, so the branch must be force-pushed. This is a
history-rewriting operation — confirm with the user first, then use a lease to
avoid clobbering unseen remote commits:

```bash
git push --force-with-lease
```

If the push is rejected, someone updated the remote branch. Fetch and reconcile
before retrying; do not use `--force` to override the lease.

## Step 8: Reply to and resolve threads

For each thread that is now addressed, first reply to the thread, referencing
what changed. Keep reply bodies shell-safe: use single quotes for simple
one-line replies, or assign a quoted heredoc to a variable for arbitrary text.
Do not put human-written reply text directly in a double-quoted shell argument;
review comments can contain characters such as `!`, `$`, backticks, or quotes
that the shell may expand before `gh` runs.

```bash
COMMENT_DATABASE_ID=COMMENT_DATABASE_ID_FROM_THREAD
reply_body='Addressed in the latest push: <short summary>.'

gh api \
  "repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments/$COMMENT_DATABASE_ID/replies" \
  -f body="$reply_body"
```

For multi-line replies or text that may contain shell metacharacters, use a
single-quoted heredoc delimiter:

```bash
COMMENT_DATABASE_ID=COMMENT_DATABASE_ID_FROM_THREAD
reply_body=$(cat <<'EOF'
Addressed in the latest push: the guidance now covers `@!method` declarations.
EOF
)

gh api \
  "repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments/$COMMENT_DATABASE_ID/replies" \
  -f body="$reply_body"
```

Then resolve the thread:

```bash
gh api graphql -f query='
  mutation($threadId:ID!) {
    resolveReviewThread(input:{threadId:$threadId}) {
      thread { id isResolved }
    }
  }' -F threadId=THREAD_ID
```

Only resolve threads whose feedback was actually addressed (or that the user
agreed to close after a reply). Leave threads open when the user still owes a
decision.

Suppressed comments have no thread, so there is nothing to reply to or
resolve — their disposition (fixed, already addressed, no longer applicable, or
disagreed) goes into the final summary instead.

## Step 9: Request another Copilot review

By default GitHub does not re-review on its own. Pushing, force-pushing, or
resolving a thread does not trigger Copilot, so the review has to be requested
every round, and a Copilot review appearing after a push means someone asked
for it. The exception is a repository carrying the ruleset described at the end
of this step, which reviews every push without being asked.

Check that the pull request is open, then request the review. A closed or
merged pull request accepts the request and silently discards it, so a zero
exit status on its own proves nothing:

```bash
if ! state=$(gh pr view "$PR_NUMBER" --json state --jq .state) || [ -z "$state" ]; then
  echo "could not read the pull request state; no review requested" >&2
  exit 1
fi

if [ "$state" = "OPEN" ]; then
  gh pr edit "$PR_NUMBER" --add-reviewer @copilot
else
  echo "pull request is $state; the request would be discarded" >&2
fi
```

Check the lookup itself, not just its answer. `state=$(gh pr view ...)` leaves
`state` empty when the call fails — no network, expired auth, wrong repository
— and an empty string is not `OPEN`, so a plain `if/else` takes the branch that
reports a closed pull request and exits zero. That is the same silent no-op
this step exists to remove, reintroduced one line above the fix. Failing the
lookup and finding the pull request closed are different outcomes and get
different exits: the first is an error, the second a deliberate skip.

Do not try to confirm afterwards that the request registered. GitHub treats a
second request for an already-pending reviewer as a no-op, so no API response
distinguishes "my request landed" from "one was already outstanding". Two
attempts that look like they work and do not, recorded so they are not
rediscovered:

- `pulls/<pr>/requested_reviewers` does not list Copilot even while its request
  is pending. It answers `{"users":[],"teams":[]}` immediately after a request
  the timeline does record, so reading it as confirmation reports failure on a
  request that succeeded. Do not generalize this to bots at large: GitHub does
  represent bots as users, and the timeline returns
  `{"login":"Copilot","type":"Bot"}` in a user-shaped `requested_reviewer`
  field. This is the observed behavior of one endpoint for one reviewer, not a
  rule about the API.
- Counting `review_requested` timeline events and requiring the count to rise
  reports a false negative whenever a request is already outstanding, because
  the duplicate records no new event.

A review that never arrives is self-evident on the next run of this skill —
there is no new feedback to resolve.

The timeline names this bot `Copilot`, while the REST call below takes
`copilot-pull-request-reviewer[bot]`. Both are correct — they are different API
surfaces for the same bot, so do not "fix" one to match the other.

If `gh` is too old to know `@copilot`, the REST call it makes is:

```bash
gh api "repos/$OWNER/$REPO/pulls/$PR_NUMBER/requested_reviewers" \
  -X POST -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
```

The `[bot]` suffix is required. Without it GitHub answers `422 Reviews may only
be requested from collaborators`, which reads like a permissions problem and is
not one.

Two dead ends, recorded so they are not rediscovered:

- The GraphQL `requestReviews` mutation cannot do this. Its `userIds` field
  rejects a `Bot` node ID with `Could not resolve to User node`, and the input
  has no field that takes one.
- `suggestedActors(capabilities: [CAN_BE_ASSIGNED])` returns `copilot-swe-agent`,
  the coding agent, not `copilot-pull-request-reviewer`. They are different
  bots with different node IDs.

Do **not** create a new Copilot PR task for a re-review; that opens separate
work instead of re-reviewing this PR.

To remove this step altogether, enable a repository ruleset on the base branch
with Copilot code review and its "Review new pushes" option. Copilot then
reviews every push without being asked.

Finish by reporting to the user: the threads resolved, any threads left open and
why, the disposition of each suppressed comment, the new commit list, and the
PR URL.

## Troubleshooting

| Issue | Solution |
| ----- | -------- |
| `git log "$BASE"..HEAD -- <path>` is empty | The file is new on this branch; ask the user whether to fold into a related commit or add a new commit. |
| Rebase stops with conflicts | Resolve the conflict, `git add` the files, then `git rebase --continue`. |
| Force-push rejected despite `--force-with-lease` | The remote branch moved; run `git fetch`, review the remote changes, reconcile, and retry. |
| A thread has no obvious file/line (`path` is null) | It is a PR-level comment; reply at the PR level and resolve only if addressed. |
| No review body contains a suppressed section | Most often correct: Copilot suppresses nothing on many reviews. The count line cannot tell that apart from a pattern that has drifted, so open one review body and look for the heading before reporting none. |
| A suppressed comment's line reference does not match the current code | Locate the referenced code in the current tree, or drop the comment as no longer applicable and note it in the summary. |
| Unsure whether to push back on feedback | Stop and ask the user before replying or resolving. |
| `--add-reviewer @copilot` reports success but no review arrives | The request is dropped on a closed or merged PR. Check the state before requesting, as Step 9 does. |
| `requested_reviewers` is empty after requesting Copilot | Expected. Copilot does not appear there even while the request is pending, so it is not a confirmation route. See Step 9. |
| `422 Reviews may only be requested from collaborators` | The `[bot]` suffix is missing from `copilot-pull-request-reviewer[bot]`. It is not a permissions problem. |
| Copilot has not re-reviewed after a push | It does not by default. Request it every round, or enable the "Review new pushes" ruleset. |
