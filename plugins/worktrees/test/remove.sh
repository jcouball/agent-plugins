#!/usr/bin/env bash
#
# worktree-remove: removal, recovery from a half-gone worktree, and refusals.
#
# SUITE is read by lib.sh, which shellcheck does not follow without -x, so it
# reads as unused here; the same goes for the source itself.
# shellcheck disable=SC2034,SC1091
set -uo pipefail
SUITE=worktree-remove
. "$(dirname -- "$0")/lib.sh"
mkremote up

listed() { # listed <repo> <path> -- how many times git lists <path>
  git -C "$1" worktree list --porcelain | grep -cxF "worktree $2"
}

sec "event handling"
raw_remove 'not json at all'
fails "malformed JSON fails"
raw_remove '{"cwd":"/tmp"}'
fails "a missing worktree_path fails"
raw_remove '{"worktree_path":"/tmp/x"}'
fails "a missing cwd fails"

sec "the ordinary removal"
git clone -q "$ROOT/up.git" "$ROOT/o1"
create feature "$ROOT/o1"; w=$OUT
remove "$w" "$ROOT/o1"
eq "exits 0" "$RC" "0"
no_dir "the worktree is gone" "$w"
no_dir "the container goes with it" "$ROOT/o1.worktrees"
eq "the registration is cleared" "$(listed "$ROOT/o1" "$w")" "0"
eq "the branch is kept" \
  "$(git -C "$ROOT/o1" rev-parse --verify --quiet worktree-feature >/dev/null && echo kept)" "kept"
is_dir "the repository is untouched" "$ROOT/o1"

create dirty "$ROOT/o1"; w=$OUT
printf 'uncommitted\n' > "$w/scratch.txt"
git -C "$w" add scratch.txt
remove "$w" "$ROOT/o1"
eq "uncommitted work does not block removal" "$RC" "0"
no_dir "and the worktree is gone" "$w"

create keeper "$ROOT/o1"; keep=$OUT
create goer "$ROOT/o1"; go=$OUT
remove "$go" "$ROOT/o1"
no_dir "the worktree removed is gone" "$go"
is_dir "a sibling worktree survives" "$keep"
is_dir "and the container stays while it holds one" "$ROOT/o1.worktrees"
remove "$keep" "$ROOT/o1"
no_dir "the container goes once the last one leaves" "$ROOT/o1.worktrees"

create "feat/deep/name" "$ROOT/o1"; w=$OUT
remove "$w" "$ROOT/o1"
eq "a flattened slashed name is removed like any other" "$RC" "0"
no_dir "container and all" "$ROOT/o1.worktrees"

mkdir -p "$ROOT/back\\tab"
git clone -q "$ROOT/up.git" "$ROOT/back\\tab/repo"
create bs "$ROOT/back\\tab/repo"; w=$OUT
rm -rf "$w"
remove "$w" "$ROOT/back\\tab/repo"
eq "a path holding a backslash still matches its registration" \
  "$(listed "$ROOT/back\\tab/repo" "$w")" "0"

sec "a worktree that is only half there"
git clone -q "$ROOT/up.git" "$ROOT/h1"
create feature "$ROOT/h1"; w=$OUT
rm -rf "$w"                                    # directory gone, registration stands
remove "$w" "$ROOT/h1"
eq "a gone directory still clears its registration" "$RC" "0"
eq "git no longer lists it" "$(listed "$ROOT/h1" "$w")" "0"
eq "and the branch is free to check out again" \
  "$(git -C "$ROOT/h1" worktree add -q "$ROOT/h1-retry" worktree-feature && echo free)" "free"

git clone -q "$ROOT/up.git" "$ROOT/h2"
create feature "$ROOT/h2"; w=$OUT
rm -rf "$ROOT/h2/.git/worktrees"               # registration gone, directory stands
remove "$w" "$ROOT/h2"
eq "a gone registration does not crash the hook" "$RC" "0"
no_dir "the stray directory is removed" "$w"
no_dir "and the container with it" "$ROOT/h2.worktrees"

# A leftover directory holding no .git of its own sends git searching upward, to
# the repository around it: the project itself in the nested layout, and in the
# sibling layout any repository enclosing the container, a dotfiles repository at
# $HOME for one. That repository's answers are not the directory's.
git clone -q "$ROOT/up.git" "$ROOT/h6"
mkdir -p "$ROOT/h6/.claude/worktrees/left"
: > "$ROOT/h6/.claude/worktrees/left/leftover.txt"
remove "$ROOT/h6/.claude/worktrees/left" "$ROOT/h6"
eq "a leftover directory inside the project is not taken for its main worktree" "$RC" "0"
no_dir "and is removed" "$ROOT/h6/.claude/worktrees/left"
is_dir "while the project's .claude stays" "$ROOT/h6/.claude"
is_dir "and so does the project" "$ROOT/h6/.git"

mkdir -p "$ROOT/dot/projects"
git init -q "$ROOT/dot"
printf '*\n' > "$ROOT/dot/.gitignore"
git -C "$ROOT/dot" add -f .gitignore
git -C "$ROOT/dot" commit -q -m dotfiles
git clone -q "$ROOT/up.git" "$ROOT/dot/projects/app"
mkdir -p "$ROOT/dot/projects/app.worktrees/left"
: > "$ROOT/dot/projects/app.worktrees/left/leftover.txt"
remove "$ROOT/dot/projects/app.worktrees/left" "$ROOT/dot/projects/app"
eq "one in a container inside a dotfiles repository is not taken for its main worktree" "$RC" "0"
no_dir "and is removed" "$ROOT/dot/projects/app.worktrees/left"
is_dir "while the dotfiles repository stays" "$ROOT/dot/.git"

# A worktree moved by hand is still a worktree: its .git file still leads to its
# registration, which still names the path it was moved from. Nothing matches
# the path it is at now, so it looks like a leftover, and a leftover is deleted.
git clone -q "$ROOT/up.git" "$ROOT/mv"
create before "$ROOT/mv"; w=$OUT
mv "$w" "$ROOT/mv.worktrees/after"
printf 'moved work\n' > "$ROOT/mv.worktrees/after/work.txt"
remove "$ROOT/mv.worktrees/after" "$ROOT/mv"
eq "a worktree moved by hand is removed as a worktree" "$RC" "0"
no_dir "and is gone" "$ROOT/mv.worktrees/after"
eq "with no registration left behind under the old path" "$(listed "$ROOT/mv" "$w")" "0"
eq "or the new one" "$(listed "$ROOT/mv" "$ROOT/mv.worktrees/after")" "0"

create busy "$ROOT/mv"; w=$OUT
git -C "$ROOT/mv" worktree lock --reason "$(claude_lock_reason busy $$)" "$w"
mv "$w" "$ROOT/mv.worktrees/moved-busy"
printf 'in progress\n' > "$ROOT/mv.worktrees/moved-busy/work.txt"
remove "$ROOT/mv.worktrees/moved-busy" "$ROOT/mv"
eq "a moved worktree a running session has locked is refused" "$RC" "1"
eq "with its work intact" "$(cat "$ROOT/mv.worktrees/moved-busy/work.txt" 2>/dev/null)" "in progress"

git clone -q "$ROOT/up.git" "$ROOT/h3"
create feature "$ROOT/h3"; w=$OUT
rm -rf "$w" "$ROOT/h3/.git/worktrees"          # both gone
remove "$w" "$ROOT/h3"
eq "nothing left to do exits 0" "$RC" "0"
empty_file "and says nothing, having asked a real repository" "$ERR"

git clone -q "$ROOT/up.git" "$ROOT/h4"
create feature "$ROOT/h4"; w=$OUT
rm -rf "$w"
remove "$w" "$ROOT/h4"
remove "$w" "$ROOT/h4"
eq "a second removal of the same path exits 0" "$RC" "0"
empty_file "and stays quiet" "$ERR"

remove "$ROOT/never.worktrees/nothing" "$ROOT/h4"
eq "a path that never existed exits 0" "$RC" "0"
empty_file "and stays quiet, the repository having answered" "$ERR"

remove "$ROOT/orphan.worktrees/x" "$ROOT/gone-too"
eq "with no repository to ask, it still exits 0" "$RC" "0"
has "but says it had nowhere to look" "$ERR" "no repository was found"

# Not covered, deliberately: the `worktree prune` fallback behind each
# `worktree remove --force`. It is there for a git too old to remove a worktree
# whose directory it cannot find, and on a git new enough to do that the
# fallback never changes the outcome -- replacing it with `true` passes this
# whole suite. Covering it needs an old git binary, not another test.
# mutate.mjs lists the fallback as an expected survivor.

sec "locks"
# Claude Code locks the worktrees it makes, with a reason naming the session's
# process, and a pre-plugin worktree resumed through the plugin can still carry
# one. A lock whose process is gone is broken as Claude Code breaks it; any
# other lock is someone's claim on the worktree, and the worktree stays.
git clone -q "$ROOT/up.git" "$ROOT/k1"
create stale "$ROOT/k1"; w=$OUT
git -C "$ROOT/k1" worktree lock --reason "$(claude_lock_reason stale "$(dead_pid)")" "$w"
remove "$w" "$ROOT/k1"
eq "a stale Claude Code lock is broken and the worktree removed" "$RC" "0"
no_dir "the worktree is gone" "$w"

create quoted "$ROOT/k1"; w=$OUT
git -C "$ROOT/k1" worktree lock \
  --reason "claude session quoted (pid $(dead_pid) start mer. 24 févr. 09:00:00 2026)" "$w"
remove "$w" "$ROOT/k1"
eq "a stale Claude Code lock git would quote is still broken" "$RC" "0"
no_dir "and the worktree removed" "$w"

create busy "$ROOT/k1"; w=$OUT
printf 'in progress\n' > "$w/work.txt"
git -C "$ROOT/k1" worktree lock --reason "$(claude_lock_reason busy $$)" "$w"
remove "$w" "$ROOT/k1"
eq "a lock held by a running session stops the removal" "$RC" "1"
has "naming the session" "$ERR" "running Claude Code session (pid $$)"
is_dir "the worktree is still there" "$w"
eq "with its work" "$(cat "$w/work.txt" 2>/dev/null)" "in progress"
eq "and its lock" "$(git -C "$ROOT/k1" worktree list --porcelain | grep -c '^locked claude session busy')" "1"

create theirs "$ROOT/k1"; w=$OUT
git -C "$ROOT/k1" worktree lock --reason 'backing up "nightly" to \\nas' "$w"
remove "$w" "$ROOT/k1"
eq "a lock Claude Code did not write stops the removal" "$RC" "1"
has "quoting its reason as written, not as git escapes it" "$ERR" \
  '(backing up "nightly" to \\nas), and not by Claude Code'
has "and naming unlock" "$ERR" "worktree unlock"
is_dir "and the worktree is still there" "$w"

create bare "$ROOT/k1"; w=$OUT
git -C "$ROOT/k1" worktree lock "$w"
remove "$w" "$ROOT/k1"
eq "a lock with no reason at all stops it too" "$RC" "1"

git clone -q "$ROOT/up.git" "$ROOT/k2"
create gone "$ROOT/k2"; w=$OUT
git -C "$ROOT/k2" worktree lock --reason "backing up" "$w"
rm -rf "$w"
remove "$w" "$ROOT/k2"
eq "a locked registration whose directory is gone still exits 0" "$RC" "0"
has "saying why it stays" "$ERR" "not by Claude Code"
eq "and the registration is left as it was" "$(listed "$ROOT/k2" "$w")" "1"

create stalegone "$ROOT/k2"; w=$OUT
git -C "$ROOT/k2" worktree lock --reason "$(claude_lock_reason stalegone "$(dead_pid)")" "$w"
rm -rf "$w"
remove "$w" "$ROOT/k2"
eq "a stale Claude Code lock on a gone directory is broken too" "$(listed "$ROOT/k2" "$w")" "0"

sec "finding the owner"
git clone -q "$ROOT/up.git" "$ROOT/f1"
create feature "$ROOT/f1"; w=$OUT
rm -rf "$w"
remove "$w" "$ROOT/does-not-exist"
eq "the owner is derived from the path when cwd is useless" "$RC" "0"
eq "and the registration is cleared" "$(listed "$ROOT/f1" "$w")" "0"

git clone -q "$ROOT/up.git" "$ROOT/f3"
mkdir -p "$ROOT/f3/.claude/worktrees"
git -C "$ROOT/f3" worktree add -q -b worktree-nested "$ROOT/f3/.claude/worktrees/nested"
rm -rf "$ROOT/f3/.claude/worktrees/nested"
remove "$ROOT/f3/.claude/worktrees/nested" "$ROOT/does-not-exist"
eq "the nested layout's owner is derived from the path too" "$RC" "0"
eq "and its registration is cleared" "$(listed "$ROOT/f3" "$ROOT/f3/.claude/worktrees/nested")" "0"

mkdir -p "$ROOT/bares"
git clone -q --bare "$ROOT/up.git" "$ROOT/bares/proj.git"
git -C "$ROOT/bares/proj.git" worktree add -q "$ROOT/bares/proj-main" main
create feature "$ROOT/bares/proj-main"; w=$OUT
rm -rf "$w"
remove "$w" "$ROOT/does-not-exist"
eq "a bare repository's owner is derived from the path" "$(listed "$ROOT/bares/proj.git" "$w")" "0"

git clone -q "$ROOT/up.git" "$ROOT/f2"
mkdir -p "$ROOT/elsewhere"
git -C "$ROOT/f2" worktree add -q -b odd "$ROOT/elsewhere/odd"
rm -rf "$ROOT/elsewhere/odd"
remove "$ROOT/elsewhere/odd" "$ROOT/f2"
eq "an unrecognized layout's gone worktree falls back to cwd" "$RC" "0"
eq "and its registration is cleared, which deletes nothing" \
  "$(listed "$ROOT/f2" "$ROOT/elsewhere/odd")" "0"
is_dir "and its parent is left alone" "$ROOT/elsewhere"

sec "refusing what neither Claude Code nor the plugin made"
git clone -q "$ROOT/up.git" "$ROOT/m1"
remove "$ROOT/m1" "$ROOT/m1"
eq "a main worktree is refused" "$RC" "1"
has "and says why" "$ERR" "main worktree"
is_dir "and is left where it is" "$ROOT/m1"
is_dir "with its repository intact" "$ROOT/m1/.git"

mkdir -p "$ROOT/m2.worktrees"
git clone -q "$ROOT/up.git" "$ROOT/m2.worktrees/repo"
git clone -q "$ROOT/up.git" "$ROOT/m2"
remove "$ROOT/m2.worktrees/repo" "$ROOT/m2"
eq "a whole repository sitting in a container is refused" "$RC" "1"
is_dir "and left intact" "$ROOT/m2.worktrees/repo/.git"

git clone -q "$ROOT/up.git" "$ROOT/m3"
mkdir -p "$ROOT/scratch"
git -C "$ROOT/m3" worktree add -q -b worktree-mine "$ROOT/scratch/mine"
printf 'mine\n' > "$ROOT/scratch/mine/edit.txt"
remove "$ROOT/scratch/mine" "$ROOT/m3"
eq "a live worktree outside both layouts is refused" "$RC" "1"
has "and says why" "$ERR" "not in a directory this plugin or Claude Code puts"
eq "its work is untouched" "$(cat "$ROOT/scratch/mine/edit.txt" 2>/dev/null)" "mine"
is_dir "and so is the directory holding it" "$ROOT/scratch"

mkdir -p "$ROOT/scratch/plain"
: > "$ROOT/scratch/plain/notes.txt"
remove "$ROOT/scratch/plain" "$ROOT/m3"
eq "an unregistered directory outside both layouts is refused, not deleted" "$RC" "1"
is_dir "and left where it is" "$ROOT/scratch/plain"

sec "cleanup stops at the container"
git clone -q "$ROOT/up.git" "$ROOT/c1"
mkdir -p "$ROOT/c1/.claude/worktrees"
git -C "$ROOT/c1" worktree add -q -b worktree-legacy "$ROOT/c1/.claude/worktrees/legacy"
remove "$ROOT/c1/.claude/worktrees/legacy" "$ROOT/c1"
no_dir "the nested container is removed" "$ROOT/c1/.claude/worktrees"
is_dir "but .claude survives" "$ROOT/c1/.claude"

git clone -q "$ROOT/up.git" "$ROOT/c2"
create feature "$ROOT/c2"; w=$OUT
remove "$w" "$ROOT/c2"
no_dir "the container goes" "$ROOT/c2.worktrees"
is_dir "the directory holding the repository is untouched" "$ROOT"
is_dir "and so is the repository" "$ROOT/c2"

report
