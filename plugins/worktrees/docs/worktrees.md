# Worktree placement

Claude Code creates the worktrees it makes for `--worktree`, `EnterWorktree`,
and agent isolation at `<repo>/.claude/worktrees/<name>`, inside the project.
It excludes them from git, so they never reach a commit, but nothing else in
the repository knows they are there. A linter with a `**/*.md` glob, a test
runner walking the tree, a script recursing from the root: each one descends
into the worktree and checks another branch's files as if they were yours.
When that fails your run, the fix is on a branch you are not working on, and
nothing in the output says so. Every such tool needs its own ignore rule, and
a new tool arrives without one.

This plugin moves them out. It is two hooks and two scripts, no skills and no
commands, so installing it changes exactly one thing: where worktrees land.

## What the plugin does

`WorktreeCreate` runs [`bin/worktree-create`](../bin/worktree-create), which
puts the linked worktree in a container directory beside the repository's
main worktree. A main worktree at `<path>` gets a container at `<path>.worktrees`:

```text
~/github/jcouball/
  agent-plugins/
  agent-plugins.worktrees/
    feat-hooks/
```

The container is keyed on the whole `<path>` rather than on its last
component, so two clones that happen to share a name, a personal `api` and a
work `api`, never share a container. The container is created on demand and
removed again when its last worktree goes, so it exists only while it holds
something.

### The exception: submodules and nested clones

The rule has one exception, a repository nested inside another repository,
which in practice means a submodule or a clone made inside another clone.
Beside the inner repository is then still inside the outer one:

```text
outer/                      the outer repository
  vendor/inner/             the repository being worked in
  vendor/inner.worktrees/   where the rule would put worktrees, inside outer again
```

That would recreate the problem this plugin exists to fix, in the outer
repository instead of the inner one. So the hook still creates the worktree,
just where Claude Code would have put it, at
`vendor/inner/.claude/worktrees/<name>`.

Only when the outer repository would actually see the container, though. One
that ignores it never notices it is there, and the repository that most often
encloses a project is a dotfiles repository at `$HOME`, which ignores
everything it does not track. Standing aside for that one would turn the plugin
off for every project in the home directory. So the hook asks `git
check-ignore` and keeps the `<path>.worktrees` layout when the answer is yes; a
`check-ignore` that cannot answer counts as a no, which is the safe way to be
wrong. A submodule is always the exception, whatever the superproject ignores,
because a submodule is content the superproject tracks.

Placing the container beside the outermost repository would fix that, at the
cost of keying a repository's worktrees to a repository above it, colliding
with that repository's own worktree names, and walking an arbitrary depth of
nesting. This implementation does not take those costs on.

### Where the branch starts

The branch is named after the worktree and starts from the remote's default
branch, which is what Claude Code's own default (`worktree.baseRef: fresh`)
does. Nothing is fetched first, so it starts from whatever your last fetch
brought in, and a worktree still happens offline.

The remote is `origin` when there is one. A repository cloned with `git clone
-o <name>` has no `origin` and a single remote under another name, and that one
is read instead: counting it as no remote at all would fall through to local
`HEAD`, which is the outcome the last case below exists to refuse.

`<remote>/HEAD` is a local record of that default. `git clone` writes it; a
remote added by hand does not, and reading it back needs the network. So there
are four cases, not two:

- `<remote>/HEAD` is set. The branch starts there.
- There are no remotes at all. The branch starts from local `HEAD`, which is
  the only base such a repository has.
- There are several remotes and none is named `origin`. Nothing says which of
  them the default should come from, so the hook fails rather than pick one.
- The remote is there but `<remote>/HEAD` is not set. The hook fails and names
  the fix, `git remote set-head <remote> --auto`. Starting from local `HEAD`
  here would root a supposedly fresh worktree in whatever the main worktree
  happens to have checked out, and nothing in the output would say so.

The new branch does not track its base. Tracking `origin/main` would make `git
push` refuse for want of a matching upstream branch, make `git pull` merge the
default branch into the feature branch, and make `git status` count commits
ahead and behind against the wrong branch.

### Resuming a name already in use

Claude Code resumes a worktree by asking for its name again, so a name already
in use has to come back as a path rather than an error. Two things count as in
use:

- A worktree registered at the path this hook would have picked.
- A worktree somewhere else with that branch checked out. This is what a
  worktree created before the plugin was installed looks like, still sitting
  at `<repo>/.claude/worktrees/<name>`. git would refuse it as `already used
  by worktree at`, so the hook returns where it actually is instead. The main
  worktree never counts, so asking for a worktree named after the branch
  checked out there is still git's error to give.

Both come from git's registry, checked against the disk. A directory alone is
not a worktree, and a registration whose directory has been deleted is not one
either. git calls the second prunable and goes on refusing to check that branch
out anywhere else until it is cleared, so the hook clears it and then creates
the worktree.

The disk is what tells those apart, rather than the `prunable` annotation in
`git worktree list --porcelain`, which git did not print until 2.36 — newer
than the version this plugin asks for. Reading it below 2.36 would make a
deleted worktree look live and hand back a path that does not exist.

### Removing

`WorktreeRemove` runs [`bin/worktree-remove`](../bin/worktree-remove) when a
session leaves a worktree it was told to remove. The worktree goes, forced, so
uncommitted changes in it do not block the removal. Claude Code asks before
choosing removal, and this hook runs after that answer. The branch stays,
because an unmerged branch is cheap to keep and expensive to lose.

A directory that is already gone is not the no-op it looks like. Its
registration outlives it, and git keeps refusing to check that branch out
anywhere else while the registration stands, so the hook clears the registration
too. The hook finds the repository that holds it by reading the worktree's own
path, which this plugin built from the main worktree and can read back, and
falls back to the session's directory for a worktree laid out some other way.
When neither of those turns out to be a repository, the hook says so instead of
exiting quietly: the registration it could not reach is the thing still holding
the branch.

## Requirements

- `jq`, to read the hook event from stdin.
- git 2.31 or newer, for `rev-parse --path-format`.

Neither is checked for, and nothing else is guarded that git already refuses.
A missing tool, an occupied directory, a main worktree passed for removal:
each fails the hook, reported in git's or jq's own words. A failed
`WorktreeCreate` hook blocks worktree creation entirely. See [Turning the
plugin off](#turning-the-plugin-off).

Both hooks declare a 600 second timeout rather than inheriting one. Creating a
worktree is a full checkout and a large repository can take minutes, and a
hook killed partway through leaves a branch and a half-written directory
behind. The number is Claude Code's own default today. Declaring it keeps the
plugin on the value it was tested against if that default moves.

## What the plugin does not do

If you work in a submodule, this plugin does nothing for you. Why, and why
reaching further up is not the answer, is in
[the exception above](#the-exception-submodules-and-nested-clones).

Beyond that, Claude Code does more than `git worktree add` when it creates a
worktree itself. A hook replaces that whole step, so these do not happen:

- `worktree.baseRef`, `worktree.sparsePaths`, and
  `worktree.symlinkDirectories` are not read. The base ref behavior above is
  reimplemented; the other two are not.
- `.worktreeinclude` is not copied, and neither is
  `.claude/settings.local.json`. A worktree starts with the permissions of a
  fresh clone.
- `core.hooksPath` is not pointed back at the main worktree. In a repository
  whose git hooks are installed by a package manager, husky for one, the hooks
  stay quiet in a new worktree until its install runs there too.

One thing the hook cannot reach is `EnterWorktree`'s other job, switching a
session that is already in a worktree into a different existing one. That check
is on the path rather than on the worktree, and it is spelled
`.claude/worktrees/` in Claude Code itself:

```text
Cannot enter worktree: <path> is not under <repo>/.claude/worktrees.
Switching from this session is limited to worktrees managed by Claude Code
(created under .claude/worktrees/ of this repository).
```

It applies whenever the calling session is itself in a worktree, so with this
plugin installed, switching between sibling worktrees is refused; entering one
from an ordinary session is not affected, and neither is creating one. Open the
worktree as its own session instead. Verified against Claude Code 2.1.267.

## Turning the plugin off

Disable or uninstall the plugin and Claude Code goes back to creating
worktrees under `.claude/worktrees/` on its own. There is no partial mode: a
`WorktreeCreate` hook that runs and prints no path is an error, not a
fallback, so the hook places every worktree or none.

```bash
claude plugin uninstall jcouball-worktrees@jcouball
```

Worktrees already created keep working. They are ordinary git worktrees,
registered in the repository that owns them, and `git worktree list` and `git
worktree remove` treat them like any other.
