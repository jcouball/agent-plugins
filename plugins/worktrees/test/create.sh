#!/usr/bin/env bash
#
# worktree-create: naming, placement, base selection, resume, and refusals.
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

sec "names Claude Code would not accept"
# The name becomes a path and a branch, so it is held to Claude Code's own rule.
# Each of these is refused before anything is created.
git clone -q "$ROOT/up.git" "$ROOT/nm"
long=$(printf 'x%.0s' $(seq 65))
for bad in "" "." ".." "a/../b" ".git" ".GIT.." "a b" "a/" "/a" "a//b" "$long" "caf\303\251"; do
  bad=$(printf '%b' "$bad")
  create "$bad" "$ROOT/nm"
  eq "the name '${bad:0:16}' is refused" "$RC" "1"
done
has "and the refusal says what a name may hold" "$ERR" "letters, digits, dots, underscores and dashes"
no_dir "and none of them leaves a container" "$ROOT/nm.worktrees"
raw_create "{\"name\":5,\"cwd\":\"$ROOT/nm\"}"
fails "a name that is not a string is refused"

create "$(printf 'y%.0s' $(seq 64))" "$ROOT/nm"
eq "a name of exactly 64 characters is accepted" "$RC" "0"
create ".github/x.y_z-1" "$ROOT/nm"
eq "and so is one using every character allowed" "$OUT" "$ROOT/nm.worktrees/.github+x.y_z-1"

sec "naming, as Claude Code names its own"
git clone -q "$ROOT/up.git" "$ROOT/n1"
create feature "$ROOT/n1"
eq "the directory is the name" "$OUT" "$ROOT/n1.worktrees/feature"
eq "the branch is worktree-<name>" "$(git -C "$OUT" rev-parse --abbrev-ref HEAD)" "worktree-feature"

create "feat/deep/name" "$ROOT/n1"
eq "a slashed name is flattened with +" "$OUT" "$ROOT/n1.worktrees/feat+deep+name"
eq "and so is its branch" \
  "$(git -C "$OUT" rev-parse --abbrev-ref HEAD)" "worktree-feat+deep+name"

create main "$ROOT/n1"
eq "a name matching an existing branch gets its own branch" \
  "$(git -C "$OUT" rev-parse --abbrev-ref HEAD)" "worktree-main"
eq "and the existing branch stays where it was" \
  "$(git -C "$ROOT/n1" rev-parse --abbrev-ref HEAD)" "main"

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

# awk -v would read a backslash in a path as an escape -- \t here, a tab -- and
# the path would stop matching the one git lists: resume and stale clearing
# would both miss it.
mkdir -p "$ROOT/back\\tab"
git clone -q "$ROOT/up.git" "$ROOT/back\\tab/repo"
create bs "$ROOT/back\\tab/repo"; bspath=$OUT
eq "a path holding a backslash is placed as usual" "$bspath" "$ROOT/back\\tab/repo.worktrees/bs"
create bs "$ROOT/back\\tab/repo"
eq "and resumes, matching the path git lists" "$OUT" "$bspath"
rm -rf "$bspath"
create bs "$ROOT/back\\tab/repo"
eq "and its stale registration is cleared" "$RC" "0"

sec "placement: repositories without a main worktree to find"
# A bare repository has no main worktree, and one cloned with
# --separate-git-dir has one nothing in its git directory points back to. The
# container is keyed on the git directory in both, which every worktree of the
# repository agrees on, and never on its parent, which neighbours share.
mkdir -p "$ROOT/bares"
git clone -q --bare "$ROOT/up.git" "$ROOT/bares/one.git"
git clone -q --bare "$ROOT/up.git" "$ROOT/bares/two.git"
git -C "$ROOT/bares/one.git" worktree add -q "$ROOT/bares/one-main" main
git -C "$ROOT/bares/two.git" worktree add -q "$ROOT/bares/two-main" main
create feature "$ROOT/bares/one-main"; one=$OUT
create feature "$ROOT/bares/two-main"; two=$OUT
eq "a bare repository's container is keyed on the repository" \
  "$one" "$ROOT/bares/one.git.worktrees/feature"
eq "so two bare repositories in one folder do not share it" "$two" "$ROOT/bares/two.git.worktrees/feature"

# A bare clone keeps no remote-tracking branches, so origin/HEAD is never
# recorded; the repository's own HEAD is the remote's default instead. The
# session's worktree has something else checked out, and must not be the base.
git -C "$ROOT/bares/one.git" worktree add -q -b wip "$ROOT/bares/one-wip" main
git -C "$ROOT/bares/one-wip" commit -q --allow-empty -m wip
create fromwip "$ROOT/bares/one-wip"
eq "a bare repository's base is its own HEAD, not the session's checkout" \
  "$(git -C "$OUT" rev-parse HEAD)" "$(git -C "$ROOT/bares/one.git" rev-parse main)"

mkdir -p "$ROOT/gitdirs"
git clone -q --separate-git-dir="$ROOT/gitdirs/sep.git" "$ROOT/up.git" "$ROOT/sep"
create fromMain "$ROOT/sep"
eq "a separate git dir keys the container on the git dir" \
  "$OUT" "$ROOT/gitdirs/sep.git.worktrees/fromMain"
create fromLinked "$OUT"
eq "and a session in a linked worktree finds the same container" \
  "$OUT" "$ROOT/gitdirs/sep.git.worktrees/fromLinked"

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
  "$(git -C "$ROOT/b1" config --get branch.worktree-fresh.remote || echo none)" "none"

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
git -C "$ROOT/b8" branch worktree-existing
git -C "$ROOT/b8" commit -q --allow-empty -m ahead
create existing "$ROOT/b8"
eq "an existing worktree- branch is checked out rather than branched" \
  "$(git -C "$OUT" rev-parse HEAD)" "$base"

# The default renamed upstream and pruned locally leaves origin/HEAD naming a
# branch that is gone. symbolic-ref still answers, so the check has to be on
# the branch it names.
git clone -q "$ROOT/up.git" "$ROOT/b9"
git -C "$ROOT/b9" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/master
create fresh "$ROOT/b9"
eq "a default naming a branch that is gone is refused" "$RC" "1"
has "the refusal names the missing branch" "$ERR" "origin/master, which no longer exists"
has "and the fix" "$ERR" "remote set-head origin --auto"
no_dir "and leaves no container" "$ROOT/b9.worktrees"

sec "resume"
git clone -q "$ROOT/up.git" "$ROOT/r1"
create again "$ROOT/r1"; firstpath=$OUT
create again "$ROOT/r1"
eq "asking twice returns the same path" "$OUT" "$firstpath"
eq "and exits 0" "$RC" "0"
empty_file "and says nothing" "$ERR"

# A worktree Claude Code made before the plugin was installed, made the way
# Claude Code makes them: flattened name, worktree- branch.
git clone -q "$ROOT/up.git" "$ROOT/r2"
mkdir -p "$ROOT/r2/.claude/worktrees"
git -C "$ROOT/r2" worktree add -q -b worktree-legacy "$ROOT/r2/.claude/worktrees/legacy"
create legacy "$ROOT/r2"
eq "a pre-plugin worktree resumes where it is" "$OUT" "$ROOT/r2/.claude/worktrees/legacy"
no_dir "resuming leaves no empty container" "$ROOT/r2.worktrees"
git -C "$ROOT/r2" worktree add -q -b worktree-feat+x "$ROOT/r2/.claude/worktrees/feat+x"
create feat/x "$ROOT/r2"
eq "so does one with a slashed name" "$OUT" "$ROOT/r2/.claude/worktrees/feat+x"

git clone -q "$ROOT/up.git" "$ROOT/r3"
create gone "$ROOT/r3"; stalepath=$OUT
rm -rf "$stalepath"
create gone "$ROOT/r3"
eq "a registration whose directory is gone is cleared, not resumed" "$RC" "0"
eq "and the worktree comes back at the same path" "$OUT" "$stalepath"
is_dir "and the path handed back exists" "$OUT"

git clone -q "$ROOT/up.git" "$ROOT/r4"
mkdir -p "$ROOT/r4-elsewhere"
git -C "$ROOT/r4" worktree add -q -b worktree-held "$ROOT/r4-elsewhere/held"
rm -rf "$ROOT/r4-elsewhere/held"
create held "$ROOT/r4"
eq "a stale registration holding the branch anywhere is cleared" "$RC" "0"
eq "and the worktree is placed by the plugin's rule" "$OUT" "$ROOT/r4.worktrees/held"

# A worktree made by hand is never handed back, even on a worktree- branch:
# the session would work in it, and removal would be offered for it at the end.
git clone -q "$ROOT/up.git" "$ROOT/r5"
mkdir -p "$ROOT/r5-mine"
git -C "$ROOT/r5" worktree add -q -b worktree-mine "$ROOT/r5-mine/mine"
create mine "$ROOT/r5"
eq "a hand-made worktree holding the branch is refused" "$RC" "1"
has "by name" "$ERR" "$ROOT/r5-mine/mine"
no_dir "and the refusal leaves no container" "$ROOT/r5.worktrees"

git -C "$ROOT/r5" worktree add -q -b plain "$ROOT/r5-mine/plain"
create plain "$ROOT/r5"
eq "a hand-made worktree on the bare name is not touched" "$OUT" "$ROOT/r5.worktrees/plain"
eq "and the new one has a branch of its own" \
  "$(git -C "$OUT" rev-parse --abbrev-ref HEAD)" "worktree-plain"

git clone -q "$ROOT/up.git" "$ROOT/r6"
create "$(git -C "$ROOT/r6" rev-parse --abbrev-ref HEAD)" "$ROOT/r6"
eq "the main worktree's branch name is a new worktree, not the main worktree" \
  "$OUT" "$ROOT/r6.worktrees/main"

git clone -q "$ROOT/up.git" "$ROOT/r7"
git -C "$ROOT/r7" checkout -q -b worktree-home
create home "$ROOT/r7"
eq "the main worktree holding the branch is refused like any other" "$RC" "1"
has "by name" "$ERR" "checked out in $ROOT/r7,"
no_dir "and the refusal leaves no container" "$ROOT/r7.worktrees"

sec "locks on a stale registration"
# Claude Code locks the worktrees it makes, with a reason naming the session's
# process. A lock whose process is gone is broken as Claude Code breaks it; any
# other lock is someone's claim and is refused.
git clone -q "$ROOT/up.git" "$ROOT/l1"
create gone "$ROOT/l1"; w=$OUT
git -C "$ROOT/l1" worktree lock --reason "$(claude_lock_reason gone "$(dead_pid)")" "$w"
rm -rf "$w"
create gone "$ROOT/l1"
eq "a stale Claude Code lock is broken and the worktree made" "$RC" "0"
is_dir "at the same path" "$w"

# git quotes a lock reason holding anything outside ASCII, C style, unless the
# listing is read with -z, and a quoted reason no longer reads as Claude Code's.
git clone -q "$ROOT/up.git" "$ROOT/l1q"
create gone "$ROOT/l1q"; w=$OUT
git -C "$ROOT/l1q" worktree lock \
  --reason "claude session gone (pid $(dead_pid) start mer. 24 févr. 09:00:00 2026)" "$w"
rm -rf "$w"
create gone "$ROOT/l1q"
eq "a stale Claude Code lock git would quote is still read as one" "$RC" "0"

git clone -q "$ROOT/up.git" "$ROOT/l2"
create busy "$ROOT/l2"; w=$OUT
git -C "$ROOT/l2" worktree lock --reason "$(claude_lock_reason busy $$)" "$w"
rm -rf "$w"
rmdir "$ROOT/l2.worktrees"
create busy "$ROOT/l2"
eq "a lock held by a running session is refused" "$RC" "1"
has "naming the session" "$ERR" "running Claude Code session (pid $$)"
no_dir "and leaves no container" "$ROOT/l2.worktrees"

git clone -q "$ROOT/up.git" "$ROOT/l3"
create theirs "$ROOT/l3"; w=$OUT
git -C "$ROOT/l3" worktree lock --reason "backing up" "$w"
rm -rf "$w"
create theirs "$ROOT/l3"
eq "a lock Claude Code did not write is refused" "$RC" "1"
has "quoting its reason" "$ERR" "(backing up), and not by Claude Code"
has "and naming unlock" "$ERR" "worktree unlock"

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
