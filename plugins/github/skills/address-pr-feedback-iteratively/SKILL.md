---
name: address-pr-feedback-iteratively
description: 'Repeats address-pr-feedback rounds on the current branch until a fresh Copilot review leaves no feedback to address or an iteration cap is reached, waiting for each review to be submitted before starting the next round. Use when iterating on PR feedback until the review is clean, running repeated Copilot review rounds, addressing review comments until none remain, or looping address-pr-feedback. If the current project has its own address-pr-feedback-iteratively skill, that file holds project-specific changes and additions: still run this skill, and apply those changes on top (Step 0).'
---

# Address PR Feedback Iteratively

Run the [address-pr-feedback](../address-pr-feedback/SKILL.md) workflow in a
loop: address the current feedback, request a fresh Copilot review, wait for it
to be submitted, and repeat until a review arrives with nothing left to address
or the iteration cap is reached.

This skill owns only the loop. Everything inside one round — fetching threads
and suppressed comments, triage, implementation, folding fixes into commits,
force-pushing, replying, resolving, and requesting the next review — is the
address-pr-feedback skill's job, including its safety rules and stop points.

## Contents

- [Contents](#contents)
- [How to use this skill](#how-to-use-this-skill)
- [Prerequisites](#prerequisites)
- [Workflow](#workflow)
- [Step 0: Apply project overrides](#step-0-apply-project-overrides)
- [Step 1: Establish the loop parameters](#step-1-establish-the-loop-parameters)
- [Step 2: Run one address-pr-feedback round](#step-2-run-one-address-pr-feedback-round)
- [Step 3: Wait for the new review](#step-3-wait-for-the-new-review)
- [Step 4: Decide whether to loop](#step-4-decide-whether-to-loop)
- [Final report](#final-report)
- [Troubleshooting](#troubleshooting)

## How to use this skill

Invoke this skill when a PR should be driven to a clean review rather than
through a single feedback pass. An optional argument sets the maximum number of
rounds; the default is 5. The address-pr-feedback skill's stop points apply
inside every round — ambiguous feedback and force-pushes still go to the user.

## Prerequisites

The same as address-pr-feedback: `gh` authenticated, `jq` installed, an open PR
for the current topic branch, and a working tree with no unrelated changes.

## Workflow

0. [Apply project overrides](#step-0-apply-project-overrides)
1. [Establish the loop parameters](#step-1-establish-the-loop-parameters)
2. [Run one address-pr-feedback round](#step-2-run-one-address-pr-feedback-round)
3. [Wait for the new review](#step-3-wait-for-the-new-review)
4. [Decide whether to loop](#step-4-decide-whether-to-loop) — back to Step 2,
   or finish

## Step 0: Apply project overrides

A project may carry its own thin copy of this workflow holding only its local
changes and additions — a different iteration cap, extra exit conditions, links
to related project skills. Check for one at each of these paths and use the
first that exists:

- `.claude/skills/address-pr-feedback-iteratively/SKILL.md`
- `.github/skills/address-pr-feedback-iteratively/SKILL.md`

If one exists, read it and apply its changes and additions throughout the
workflow. Where it conflicts with this skill, the project file wins. If that
file is what invoked this skill, its changes are already in context — do not
re-read it, and do not re-invoke anything it names.

If neither path exists, fall back to searching the project for a `SKILL.md`
whose frontmatter `name` is `address-pr-feedback-iteratively` wherever the
project keeps agent skills, and treat it the same way. Never treat a vendored
or installed copy of this skill itself as the override — a full copy of the
workflow holds no project deltas.

If no override exists, run this skill as written.

## Step 1: Establish the loop parameters

Set the iteration cap from the invocation argument, defaulting to 5, and
record the PR once. The cap must be a whole number of at least 1 — it is a
maximum number of rounds, and Step 2 runs before the first cap check, so a
zero or negative cap would still execute a round it claims to forbid, and
a non-numeric one leaves Step 4's comparison undefined. Reject anything
that is not a positive integer before starting the loop: stop and tell the
user instead of coercing the value. The PR number feeds the Step 3 poll
and the URL goes in the final report; the cap plays no part until Step 4,
where it decides whether leftover feedback buys another round. Anything
else a round needs, the address-pr-feedback skill captures for itself:

```bash
PR_NUMBER=$(gh pr view --json number --jq '.number')
PR_URL=$(gh pr view --json url --jq '.url')
```

If no PR is associated with the current branch, stop and tell the user.

## Step 2: Run one address-pr-feedback round

Run the address-pr-feedback skill from its Step 0 through its final step. Two
additions apply while it runs:

- Once the round's history rewriting is done, but before anything that
  can trigger the next review — after the autosquash rebase and before
  the force-push, or for a round with no push, before the review
  request — record the commit the next review must cover and the set of
  Copilot review IDs that already exist. "Done" can move: when the
  force-push is rejected and reconciling with the remote (the base
  skill's rejection path) changes `HEAD`, a token captured before the
  rejection names a commit that will never be pushed, and Step 3 would
  wait on it forever — repeat this capture after reconciling, before
  retrying the push:

  ```bash
  HEAD_SHA=$(git rev-parse HEAD)
  unset SEEN_REVIEW_IDS
  if response=$(gh api "repos/{owner}/{repo}/pulls/$PR_NUMBER/reviews" \
      --paginate) &&
    baseline=$(printf '%s' "$response" | jq -sc '[add[]
      | select((.user.login // "")
          | startswith("copilot-pull-request-reviewer"))
      | .id]'); then
    SEEN_REVIEW_IDS=$baseline
  else
    echo 'baseline capture failed; fix and recapture before triggering a review'
  fi
  ```

  These are the round's completion token. A submitted review names the
  commit it evaluated, and a review that did not exist at capture time
  is one whose ID is absent from `SEEN_REVIEW_IDS`. Step 3 requires both
  conditions because either alone
  accepts a stale review. The commit alone fails on a round that changed
  nothing: the head is the same commit the previous review evaluated, so
  that already-submitted review passes the SHA test instantly and its
  feedback replays as fresh. The ID alone fails on a round that pushed:
  a review Copilot was already running against the previous head is
  invisible while pending, so it is missing from the snapshot and passes
  the membership test while describing code the push replaced. The
  freshness token is set membership rather than a timestamp or a
  greater-than on IDs: `date` and `submitted_at` both carry one-second
  precision, so a timestamp cannot separate an old review from a capture
  made within the same second, and GitHub documents nothing about how
  the opaque `id` is allocated, so comparing against the highest seen ID
  would lean on an ordering no contract provides. Membership needs
  neither — whatever the allocation scheme, an ID in the snapshot is an
  old review and an ID absent from it is a new one. Both the listing and
  the parse sit in the `if`
  condition, and `SEEN_REVIEW_IDS` is assigned only after both succeed:
  a failed `gh` or a failed `jq` takes the else branch, prints the
  message, and leaves the token unset. Assigning straight from the
  pipeline instead would let a failed parse store an empty baseline with
  no message, and the round would trigger a review before Step 3's guard
  noticed anything wrong. The
  `unset` before the call is not decoration: on any round after the
  first, the previous round's baseline is still in the shell, and
  without the `unset` a failed listing would leave it there, Step 3's
  guard would pass on the stale value, and on an unchanged head the
  prior round's review would be accepted as fresh. Cleared first, a
  failed listing leaves `SEEN_REVIEW_IDS` genuinely unset, and the guard
  refuses to poll on a baseline that would re-admit old reviews.

- Keep a running note of what this round addressed, for the final report.

A round can end with no review triggered at all, and then the review must
be requested explicitly before continuing to Step 3. This is any round
without a force-push — nothing to address, or only replies and pushback
that change no code — run where the base skill's last step does not
request a review, either because a quiet round never reached it or
because the repository's "Review new pushes" ruleset replaces it and only
ever reviews a push. It is not a first-round special case: every no-push
round of the invocation needs the explicit request, or Step 3 waits on a
review nothing asked for.

## Step 3: Wait for the new review

A Copilot review of `HEAD_SHA` whose ID is not in `SEEN_REVIEW_IDS` is the
completion signal. It fires even when the review produces zero threads,
which is what a clean exit looks like. Poll for it:

```bash
(
  if [ -z "${PR_NUMBER-}" ] || [ -z "${HEAD_SHA-}" ] ||
      [ -z "${SEEN_REVIEW_IDS-}" ]; then
    echo 'missing PR_NUMBER, HEAD_SHA, or SEEN_REVIEW_IDS; recapture first'
    exit 0
  fi
  outcome='no new review after 30 polls'
  for ((i = 1; i <= 30; i++)); do
    if ! response=$(gh api "repos/{owner}/{repo}/pulls/$PR_NUMBER/reviews" \
        --paginate); then
      outcome='review lookup failed'
      break
    fi
    submitted=$(printf '%s' "$response" |
      jq -s --argjson seen "$SEEN_REVIEW_IDS" "[add[]
        | select((.user.login // \"\")
            | startswith(\"copilot-pull-request-reviewer\"))
        | select(.submitted_at != null)
        | select(.id | IN(\$seen[]) | not)
        | select(.commit_id == \"$HEAD_SHA\")] | length") ||
      { outcome='review lookup failed'; break; }
    if [ "${submitted:-0}" -gt 0 ]; then
      outcome='review submitted'
      break
    fi
    echo "waiting for Copilot review... (poll $i of 30)"
    sleep 15
  done
  echo "$outcome"
)
```

The block is written so that no failure inside it can take down whatever
runs it. Missing tokens are reported by an explicit check that leaves
the subshell with status zero, not by `${var:?}` guards: a guard aborts
the shell it runs in, and even wrapped in the parentheses its non-zero
exit would end a driver running the block under `set -e` the moment the
subshell returned. The parentheses still earn their place — they scope
that `exit 0` to the poll, so it cannot end an interactive shell the
block was pasted into. Deeper in, no other `exit` appears: pasted into
an interactive shell, an `exit` past the parentheses' protection would
close it. The loop records its outcome and breaks, and the
one `echo` after it is the result — `review submitted`, `review lookup
failed`, or the timeout message. Both failure branches share the
`review lookup failed` outcome: the `gh` listing failing (network, auth,
wrong repository) and the `jq` parse of its response failing land on the
same message, so check the listing and the parse before polling again
rather than assuming the network is at fault.

The poll requires both conditions for the reason Step 2 gives: the SHA
proves the review covers this round's head, the ID proves the review did
not yet exist when the round captured its baseline. The `gh` call runs
on its own and is checked before its output reaches `jq`. Piped
together, the pipeline's status would be `jq`'s alone, and `jq -s` turns
the empty input of a failed `gh` into a clean count of zero — a broken
lookup would read as "no review yet" and wait through every timeout
instead of reporting `review lookup failed`. The REST endpoint
is used because
`gh pr view --json reviews` does not expose the reviewed commit;
`{owner}/{repo}` in the path is filled in by `gh` from the current
repository, so no extra variables are needed. `(.user.login // "")` keeps
the filter from erroring on a review whose author account was deleted,
which nulls the login, and the `-s`/`add` fold collapses `--paginate`
pages into one list before counting, for the reason the base skill's
Step 3 gives.

One run of the script waits about seven and a half minutes. Before running
it again after `no new review after 30 polls`, check whether the pending
request was consumed by a review the filter rightly rejected: list the
Copilot reviews whose IDs are not in `SEEN_REVIEW_IDS` and look at their
`commit_id`. One with the wrong SHA is a review Copilot was already
running against the previous head when this round's request landed as a
no-op — its submission satisfied the request, nothing is pending any
longer, and re-running the poll without re-requesting can never produce a
review of `HEAD_SHA`. Re-request the review, then poll again. If no
post-baseline review exists, the request is still pending: run the poll
again without re-requesting. After three runs with no review of
`HEAD_SHA`, stop and ask the user whether to keep waiting, re-request, or
abort.

## Step 4: Decide whether to loop

When the review arrives, count what is left to address: every unresolved
review thread, outdated or not — outdated means a later push moved the
thread's diff position, not that its feedback was handled, and the base
skill triages every unresolved thread, so a loop that skipped outdated
ones would declare itself clean while actionable feedback remains — plus
any still-applicable suppressed comments in the fresh reviews — the
Copilot reviews passing the Step 3 filter: `commit_id` equal to this
round's `HEAD_SHA`, ID not in `SEEN_REVIEW_IDS`. Read the
suppressed section out of those review bodies directly; the base skill's
suppressed-comment query is not the tool for this decision. It prints the
newest review *carrying* a suppressed section, so on a fresh review that
suppressed nothing it falls back to an older review, and feedback the fresh
review superseded would count as newly remaining and buy a round that
addresses nothing. Exclude items this invocation has already
dispositioned: threads the user chose to leave open, and feedback the
user decided not to act on. Those are reported, not re-litigated.

- **Nothing left** → the loop is done. Produce the final report.
- **Items remain and the cap is not reached** → report what the new review
  raised, then return to Step 2 for the next round.
- **Items remain and the cap is reached** → stop. Produce the final report and
  tell the user the cap ended the loop, not a clean review.

## Final report

Report to the user:

- rounds completed, and whether the loop ended clean or at the cap
- every thread and suppressed comment addressed, by round
- items left open and why (user decision pending, deliberate pushback)
- the PR URL

## Troubleshooting

| Issue | Solution |
| ----- | -------- |
| The poll never sees a review | Requests on a closed or merged PR are silently discarded; address-pr-feedback's review-request step checks the state first. Confirm the PR is open, then ask the user before re-requesting. |
| The same feedback comes back every round | Copilot re-raises a finding the fix did not actually address, or the fix was pushed back on without a reply. Stop and show the user the repeating thread instead of burning rounds on it. |
| The loop keeps finding threads the user already declined | Track dispositions across rounds (Step 4) and exclude them from the loop condition; they belong in the final report only. |
| A round's force-push is declined by the user | The loop cannot continue without the push. Report what is staged and stop. |
