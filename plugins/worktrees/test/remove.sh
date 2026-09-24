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
eq "the registration is cleared" \
  "$(git -C "$ROOT/o1" worktree list --porcelain | grep -c "^worktree $w\$")" "0"
eq "the branch is kept" "$(git -C "$ROOT/o1" rev-parse --verify --quiet feature >/dev/null && echo kept)" "kept"
is_dir "the repository is untouched" "$ROOT/o1"

create dirty "$ROOT/o1"; w=$OUT
printf 'uncommitted\n' > "$w/scratch.txt"
git -C "$w" add scratch.txt
remove "$w" "$ROOT/o1"
eq "uncommitted work does not block removal" "$RC" "0"
no_dir "and the worktree is gone" "$w"

create keeper "$ROOT/o1" >/dev/null; keep=$OUT
create goer "$ROOT/o1" >/dev/null; go=$OUT
remove "$go" "$ROOT/o1"
no_dir "the worktree removed is gone" "$go"
is_dir "a sibling worktree survives" "$keep"
is_dir "and the container stays while it holds one" "$ROOT/o1.worktrees"
remove "$keep" "$ROOT/o1"
no_dir "the container goes once the last one leaves" "$ROOT/o1.worktrees"

sec "a worktree that is only half there"
git clone -q "$ROOT/up.git" "$ROOT/h1"
create feature "$ROOT/h1"; w=$OUT
rm -rf "$w"                                    # directory gone, registration stands
remove "$w" "$ROOT/h1"
eq "a gone directory still clears its registration" "$RC" "0"
eq "git no longer lists it" \
  "$(git -C "$ROOT/h1" worktree list --porcelain | grep -c "^worktree $w\$")" "0"
eq "and the branch is free to check out again" \
  "$(git -C "$ROOT/h1" worktree add -q "$ROOT/h1-retry" feature && echo free)" "free"

git clone -q "$ROOT/up.git" "$ROOT/h2"
create feature "$ROOT/h2"; w=$OUT
rm -rf "$ROOT/h2/.git/worktrees"               # registration gone, directory stands
remove "$w" "$ROOT/h2"
eq "a gone registration does not crash the hook" "$RC" "0"
no_dir "the stray directory is removed" "$w"
no_dir "and the container with it" "$ROOT/h2.worktrees"

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
#
# A locked worktree whose directory is gone is the one case both calls miss:
# git refuses `remove --force` on a lock and `prune` passes over it. That is
# the only way to reach the prune fallback and the warning that follows it.
git clone -q "$ROOT/up.git" "$ROOT/h5"
create feature "$ROOT/h5"; w=$OUT
git -C "$ROOT/h5" worktree lock "$w"
rm -rf "$w"
remove "$w" "$ROOT/h5"
eq "a locked registration that cannot be cleared still exits 0" "$RC" "0"
has "and says the branch is still held" "$ERR" "still holds its branch"
has "and names unlock as the way out" "$ERR" "worktree unlock"
eq "the registration is indeed still there" \
  "$(git -C "$ROOT/h5" worktree list --porcelain | grep -c "^worktree $w\$")" "1"

sec "finding the owner"
git clone -q "$ROOT/up.git" "$ROOT/f1"
create feature "$ROOT/f1"; w=$OUT
rm -rf "$w"
remove "$w" "$ROOT/does-not-exist"
eq "the owner is derived from the path when cwd is useless" "$RC" "0"
eq "and the registration is cleared" \
  "$(git -C "$ROOT/f1" worktree list --porcelain | grep -c "^worktree $w\$")" "0"

git clone -q "$ROOT/up.git" "$ROOT/f2"
mkdir -p "$ROOT/elsewhere"
git -C "$ROOT/f2" worktree add -q -b odd "$ROOT/elsewhere/odd"
rm -rf "$ROOT/elsewhere/odd"
remove "$ROOT/elsewhere/odd" "$ROOT/f2"
eq "an unrecognized layout falls back to cwd" "$RC" "0"
eq "and its registration is cleared too" \
  "$(git -C "$ROOT/f2" worktree list --porcelain | grep -c "^worktree $ROOT/elsewhere/odd\$")" "0"
is_dir "an unrecognized layout's parent is left alone" "$ROOT/elsewhere"

sec "refusing a main worktree"
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

sec "container cleanup stops at the container"
git clone -q "$ROOT/up.git" "$ROOT/c1"
mkdir -p "$ROOT/c1/.claude/worktrees"
git -C "$ROOT/c1" worktree add -q -b legacy "$ROOT/c1/.claude/worktrees/legacy"
remove "$ROOT/c1/.claude/worktrees/legacy" "$ROOT/c1"
no_dir "the nested container is removed" "$ROOT/c1/.claude/worktrees"
is_dir "but .claude survives" "$ROOT/c1/.claude"

git clone -q "$ROOT/up.git" "$ROOT/c2"
create "feat/deep/name" "$ROOT/c2"; w=$OUT
remove "$w" "$ROOT/c2"
no_dir "the name directories go" "$ROOT/c2.worktrees/feat"
no_dir "and the container goes" "$ROOT/c2.worktrees"
is_dir "the directory holding the repository is untouched" "$ROOT"
is_dir "and so is the repository" "$ROOT/c2"

git clone -q "$ROOT/up.git" "$ROOT/c3"
create "feat/a" "$ROOT/c3" >/dev/null
create "feat/b" "$ROOT/c3" >/dev/null; w=$OUT
remove "$w" "$ROOT/c3"
is_dir "a shared name directory stays while a sibling uses it" "$ROOT/c3.worktrees/feat"
is_dir "and so does the container" "$ROOT/c3.worktrees"

report
