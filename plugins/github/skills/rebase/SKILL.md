---
name: rebase
description: 'Rebases the current branch onto the default branch on origin, resolves rebase conflicts, and force-pushes with lease using non-interactive Git commands that never open an editor. Use when updating a feature branch from the default branch, handling rebase conflicts, or rewriting branch history before updating a pull request. If the current project has its own rebase skill, use the project''s version instead of this one.'
---

# Rebase

Rebase the current branch on the default branch, resolve conflicts, and
force-push the rewritten history without opening an editor.

## Contents

- [Contents](#contents)
- [How to use this skill](#how-to-use-this-skill)
- [Prerequisites](#prerequisites)
- [Terms](#terms)
- [Safety rules](#safety-rules)
- [Workflow](#workflow)
- [Step 1: Preflight checks and fetch](#step-1-preflight-checks-and-fetch)
- [Step 2: Start the rebase](#step-2-start-the-rebase)
- [Step 3: Resolve conflicts and continue](#step-3-resolve-conflicts-and-continue)
- [Step 4: Verify the rebased branch](#step-4-verify-the-rebased-branch)
- [Step 5: Force-push with lease](#step-5-force-push-with-lease)
- [Troubleshooting](#troubleshooting)

## How to use this skill

Invoke this skill when the current branch needs to be rebased onto the default
branch and pushed. Work top to bottom, and stop and ask the user whenever the
preflight checks or a conflict need a decision.

## Prerequisites

- `git` is installed and authenticated for the remote.
- The branch is a topic branch with an upstream on `origin`.
- The working tree is clean before rebasing.

## Terms

- **Base** — the default branch on `origin`, read from `origin/HEAD` in Step 1.
  It is written `<base>` below and looks like `origin/main`.

## Safety rules

These rules are mandatory:

- Never run this workflow on the default branch or on a release or maintenance
  branch.
- Always fetch `origin` immediately before rebasing.
- Always run rebase commands with `GIT_EDITOR=:` and `GIT_SEQUENCE_EDITOR=:` so
  no editor opens.
- Force-push only with `--force-with-lease`.

## Workflow

1. [Preflight checks and fetch](#step-1-preflight-checks-and-fetch)
2. [Start the rebase](#step-2-start-the-rebase)
3. [Resolve conflicts and continue](#step-3-resolve-conflicts-and-continue)
4. [Verify the rebased branch](#step-4-verify-the-rebased-branch)
5. [Force-push with lease](#step-5-force-push-with-lease)

## Step 1: Preflight checks and fetch

```bash
git branch --show-current
git status --short --branch
git fetch --prune origin
git symbolic-ref --short refs/remotes/origin/HEAD
```

The last command prints `<base>`. If it fails because `origin/HEAD` is not set,
set it and read it again:

```bash
git remote set-head origin --auto
git symbolic-ref --short refs/remotes/origin/HEAD
```

If the current branch is the default branch or a release or maintenance branch,
stop and ask the user to switch to a topic branch first.

If `git status --short --branch` shows uncommitted changes, stop and ask the
user whether to commit or stash before continuing.

## Step 2: Start the rebase

```bash
GIT_EDITOR=: GIT_SEQUENCE_EDITOR=: git rebase <base>
```

If the command succeeds, continue to Step 4. If it stops with conflicts, go to
Step 3.

## Step 3: Resolve conflicts and continue

Repeat until the rebase completes:

1. Inspect conflicted files:

   ```bash
   git status --short
   ```

2. Edit conflicted files, remove conflict markers, and keep the intended final
   content.

3. Stage resolved files:

   ```bash
   git add <resolved-path> [<resolved-path>...]
   ```

4. Continue the rebase without opening an editor:

   ```bash
   GIT_EDITOR=: GIT_SEQUENCE_EDITOR=: git rebase --continue
   ```

5. If Git reports an empty patch after conflict resolution, skip that commit:

   ```bash
   GIT_EDITOR=: GIT_SEQUENCE_EDITOR=: git rebase --skip
   ```

If the rebase cannot be completed safely, abort and report back:

```bash
git rebase --abort
```

## Step 4: Verify the rebased branch

```bash
git status --short --branch
git merge-base --is-ancestor <base> HEAD
git --no-pager log --oneline --decorate --max-count=15
```

`git merge-base --is-ancestor <base> HEAD` must exit successfully.

## Step 5: Force-push with lease

```bash
git push --force-with-lease
```

If push is rejected, fetch and reconcile remote updates before retrying. Never
replace this with plain `--force`.

## Troubleshooting

| Issue | Solution |
| ----- | -------- |
| Rebase stops with conflicts | Resolve files, `git add`, then run `GIT_EDITOR=: GIT_SEQUENCE_EDITOR=: git rebase --continue`. |
| Rebase continue opens an editor | Re-run with both `GIT_EDITOR=:` and `GIT_SEQUENCE_EDITOR=:` prefixes. |
| `git symbolic-ref refs/remotes/origin/HEAD` fails | Run `git remote set-head origin --auto`, then read it again. |
| `--force-with-lease` push rejected | Run `git fetch origin`, inspect divergence, reconcile, and retry `--force-with-lease`. |
| Need to abandon rebasing attempt | Run `git rebase --abort` and report the reason to the user. |
