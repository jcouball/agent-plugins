#!/usr/bin/env bash
#
# worktree-create: placement, base selection, resume, and refusals.
#
# SUITE is read by lib.sh, which shellcheck does not follow without -x, so it
# reads as unused here; the same goes for the source itself.
# shellcheck disable=SC2034,SC1091
set -uo pipefail
SUITE=worktree-create
. "$(dirname -- "$0")/lib.sh"
mkremote up

sec "event handling"
raw_create 'not json at all'
fails "malformed JSON fails"
git clone -q "$ROOT/up.git" "$ROOT/ev"
raw_create "{\"cwd\":\"$ROOT/ev\"}"
fails "a missing name fails, in a real repository"
raw_create "{\"name\":null,\"cwd\":\"$ROOT/ev\"}"
fails "a null name fails, in a real repository"
no_dir "and neither leaves a worktree behind" "$ROOT/ev.worktrees"
raw_create '{"name":"x"}'
fails "a missing cwd fails"
raw_create '{"name":"x","cwd":null}'
fails "a null cwd fails"
raw_create ''
fails "empty stdin fails"
create x "$ROOT/does-not-exist"
fails "a cwd that does not exist fails"
mkdir -p "$ROOT/plain"
create x "$ROOT/plain"
fails "a cwd outside any repository fails"

sec "placement"
git clone -q "$ROOT/up.git" "$ROOT/p1"
create feature "$ROOT/p1"
eq "container sits beside the main worktree" "$OUT" "$ROOT/p1.worktrees/feature"
eq "exits 0" "$RC" "0"
is_dir "the worktree exists" "$OUT"
eq "git agrees it is registered" \
  "$(git -C "$ROOT/p1" worktree list --porcelain | grep -c "^worktree $OUT\$")" "1"

create second "$ROOT/p1.worktrees/feature"
eq "called from inside a linked worktree, keyed to the main worktree" \
  "$OUT" "$ROOT/p1.worktrees/second"

mkdir -p "$ROOT/a" "$ROOT/b"
git clone -q "$ROOT/up.git" "$ROOT/a/api"
git clone -q "$ROOT/up.git" "$ROOT/b/api"
create shared "$ROOT/a/api"; first=$OUT
create shared "$ROOT/b/api"; second=$OUT
eq "two clones sharing a basename get their own containers" \
  "$([ "$first" != "$second" ] && echo distinct)" "distinct"

git clone -q "$ROOT/up.git" "$ROOT/p2"
ln -s "$ROOT/p2" "$ROOT/p2-link"
create viasym "$ROOT/p2-link"
eq "a symlinked cwd resolves to the physical path" "$OUT" "$ROOT/p2.worktrees/viasym"

# Claude Code refuses a worktree path with a symlinked component, so a
# container that is itself a symlink has to come back resolved.
git clone -q "$ROOT/up.git" "$ROOT/p3"
mkdir -p "$ROOT/real-container"
ln -s "$ROOT/real-container" "$ROOT/p3.worktrees"
create viacontainer "$ROOT/p3"
eq "a symlinked container resolves to the physical path" "$OUT" "$ROOT/real-container/viacontainer"
is_dir "and the worktree is there" "$OUT"

# The same, one level up: the nested layout's .claude is the symlink, and only
# the container below it is missing.
git init -q "$ROOT/p4outer"
git -C "$ROOT/p4outer" commit -q --allow-empty -m outer
git clone -q "$ROOT/up.git" "$ROOT/p4outer/inner"
mkdir -p "$ROOT/real-claude"
ln -s "$ROOT/real-claude" "$ROOT/p4outer/inner/.claude"
create viaclaude "$ROOT/p4outer/inner"
eq "a symlinked .claude in the nested layout resolves too" \
  "$OUT" "$ROOT/real-claude/worktrees/viaclaude"
is_dir "and that worktree is there" "$OUT"

create "feat/deep/name" "$ROOT/p1"
eq "a slashed name nests under the container" "$OUT" "$ROOT/p1.worktrees/feat/deep/name"
eq "the branch is the slashed name" \
  "$(git -C "$OUT" rev-parse --abbrev-ref HEAD)" "feat/deep/name"

sec "placement: standing aside"
mkdir -p "$ROOT/outer/vendor"
git init -q "$ROOT/outer"
git -C "$ROOT/outer" commit -q --allow-empty -m outer
git clone -q "$ROOT/up.git" "$ROOT/outer/vendor/inner"
create feature "$ROOT/outer/vendor/inner"
eq "a clone inside a watching clone uses Claude Code's layout" \
  "$OUT" "$ROOT/outer/vendor/inner/.claude/worktrees/feature"

mkdir -p "$ROOT/home/projects"
git init -q "$ROOT/home"
printf '*\n' > "$ROOT/home/.gitignore"
git -C "$ROOT/home" add -f .gitignore
git -C "$ROOT/home" commit -q -m dotfiles
git clone -q "$ROOT/up.git" "$ROOT/home/projects/app"
create feature "$ROOT/home/projects/app"
eq "an enclosing repository that ignores the container is no obstacle" \
  "$OUT" "$ROOT/home/projects/app.worktrees/feature"

git init -q "$ROOT/super"
git -C "$ROOT/super" commit -q --allow-empty -m super
git -C "$ROOT/super" -c protocol.file.allow=always submodule -q add "$ROOT/up.git" sub 2>/dev/null
create feature "$ROOT/super/sub"
eq "a submodule uses Claude Code's layout" \
  "$OUT" "$ROOT/super/sub/.claude/worktrees/feature"

# A superproject that ignores everything would let the container through the
# parent-directory check, so only the superproject check stands a submodule
# aside here.
git init -q "$ROOT/super2"
printf '*\n' > "$ROOT/super2/.gitignore"
git -C "$ROOT/super2" add -f .gitignore
git -C "$ROOT/super2" commit -q -m ignore-all
git -C "$ROOT/super2" -c protocol.file.allow=always submodule -q add -f "$ROOT/up.git" sub 2>/dev/null
create feature "$ROOT/super2/sub"
eq "a submodule stands aside even when the superproject ignores everything" \
  "$OUT" "$ROOT/super2/sub/.claude/worktrees/feature"

git clone -q "$ROOT/up.git" "$ROOT/cw"
mkdir -p "$ROOT/decoy"
printf '[core]\n\tworktree = %s/decoy\n' "$ROOT" >> "$ROOT/gitconfig"
create feature "$ROOT/cw"
eq "a global core.worktree does not redirect the container" "$OUT" "$ROOT/cw.worktrees/feature"
git config --global --unset core.worktree

sec "base selection"
git clone -q "$ROOT/up.git" "$ROOT/b1"
base=$(git -C "$ROOT/b1" rev-parse origin/main)
git -C "$ROOT/b1" checkout -q -b wip
git -C "$ROOT/b1" commit -q --allow-empty -m wip
create fresh "$ROOT/b1"
eq "origin/HEAD is the base, not the checked-out branch" \
  "$(git -C "$OUT" rev-parse HEAD)" "$base"
eq "the new branch tracks nothing" \
  "$(git -C "$ROOT/b1" config --get branch.fresh.remote || echo none)" "none"

git clone -q -o upstream "$ROOT/up.git" "$ROOT/b2"
git -C "$ROOT/b2" checkout -q -b wip
git -C "$ROOT/b2" commit -q --allow-empty -m wip
create fresh "$ROOT/b2"
eq "a sole non-origin remote supplies the base" "$(git -C "$OUT" rev-parse HEAD)" "$base"

git init -q "$ROOT/b3"
git -C "$ROOT/b3" commit -q --allow-empty -m only
create fresh "$ROOT/b3"
eq "with no remote the base is local HEAD" \
  "$(git -C "$OUT" rev-parse HEAD)" "$(git -C "$ROOT/b3" rev-parse HEAD)"

git clone -q "$ROOT/up.git" "$ROOT/b4"
git -C "$ROOT/b4" symbolic-ref -d refs/remotes/origin/HEAD
create fresh "$ROOT/b4"
eq "origin without a recorded default is refused" "$RC" "1"
has "the refusal names set-head" "$ERR" "remote set-head origin --auto"
no_dir "the refusal leaves no container" "$ROOT/b4.worktrees"

git clone -q -o upstream "$ROOT/up.git" "$ROOT/b5"
git -C "$ROOT/b5" symbolic-ref -d refs/remotes/upstream/HEAD
create fresh "$ROOT/b5"
eq "a sole non-origin remote without a default is refused" "$RC" "1"
has "the refusal names that remote" "$ERR" "remote set-head upstream --auto"

git clone -q -o upstream "$ROOT/up.git" "$ROOT/b6"
git -C "$ROOT/b6" remote add fork "$ROOT/up.git"
create fresh "$ROOT/b6"
eq "several remotes and no origin is refused" "$RC" "1"
has "the refusal names the ambiguity" "$ERR" "none named origin"
no_dir "that refusal leaves no container either" "$ROOT/b6.worktrees"

git clone -q "$ROOT/up.git" "$ROOT/b7"
git -C "$ROOT/b7" remote add fork "$ROOT/up.git"
create fresh "$ROOT/b7"
eq "origin wins when there are several remotes" "$(git -C "$OUT" rev-parse HEAD)" "$base"

git clone -q "$ROOT/up.git" "$ROOT/b8"
git -C "$ROOT/b8" branch existing
git -C "$ROOT/b8" commit -q --allow-empty -m ahead
create existing "$ROOT/b8"
eq "an existing branch is checked out rather than branched" \
  "$(git -C "$OUT" rev-parse HEAD)" "$base"

sec "resume"
git clone -q "$ROOT/up.git" "$ROOT/r1"
create again "$ROOT/r1"; firstpath=$OUT
create again "$ROOT/r1"
eq "asking twice returns the same path" "$OUT" "$firstpath"
eq "and exits 0" "$RC" "0"
empty_file "and says nothing" "$ERR"

git clone -q "$ROOT/up.git" "$ROOT/r2"
mkdir -p "$ROOT/r2/.claude/worktrees"
git -C "$ROOT/r2" worktree add -q -b legacy "$ROOT/r2/.claude/worktrees/legacy"
create legacy "$ROOT/r2"
eq "a pre-plugin worktree resumes where it is" "$OUT" "$ROOT/r2/.claude/worktrees/legacy"
no_dir "resuming leaves no empty container" "$ROOT/r2.worktrees"

git clone -q "$ROOT/up.git" "$ROOT/r3"
create gone "$ROOT/r3"; stalepath=$OUT
rm -rf "$stalepath"
create gone "$ROOT/r3"
eq "a registration whose directory is gone is cleared, not resumed" "$RC" "0"
eq "and the worktree comes back at the same path" "$OUT" "$stalepath"
is_dir "and the path handed back exists" "$OUT"

git clone -q "$ROOT/up.git" "$ROOT/r4"
mkdir -p "$ROOT/r4/.claude/worktrees"
git -C "$ROOT/r4" worktree add -q -b held "$ROOT/r4/.claude/worktrees/held"
rm -rf "$ROOT/r4/.claude/worktrees/held"
create held "$ROOT/r4"
eq "a stale registration holding the branch elsewhere is cleared" "$RC" "0"
eq "and the worktree is placed by the plugin's rule" "$OUT" "$ROOT/r4.worktrees/held"

git clone -q "$ROOT/up.git" "$ROOT/r5"
create "$(git -C "$ROOT/r5" rev-parse --abbrev-ref HEAD)" "$ROOT/r5"
fails "the branch checked out in the main worktree is git's error to give"

git clone -q "$ROOT/up.git" "$ROOT/r6"
create locked "$ROOT/r6"; lockedpath=$OUT
git -C "$ROOT/r6" worktree lock "$lockedpath"
rm -rf "$lockedpath"
create locked "$ROOT/r6"
fails "a locked stale registration is git's error to give, not a silent wrong path"
not_empty_file "and git says why" "$ERR"

sec "refusals leave nothing behind"
git clone -q "$ROOT/up.git" "$ROOT/x1"
: > "$ROOT/x1.worktrees"
create feature "$ROOT/x1"
fails "a file where the container belongs fails"
rm -f "$ROOT/x1.worktrees"

git clone -q "$ROOT/up.git" "$ROOT/x2"
mkdir -p "$ROOT/x2.worktrees/taken"
: > "$ROOT/x2.worktrees/taken/occupied"
create taken "$ROOT/x2"
fails "an occupied worktree path fails"
not_empty_file "and git says why" "$ERR"

report
