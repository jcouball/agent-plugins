# Shared harness for the worktrees hook tests.
#
# Every test runs against a throwaway repository under one temporary root, with
# git's global and system configuration replaced so the suite cannot be swayed
# by the machine it runs on.

# The hooks under test. Overridable, so the same suite can be pointed at
# another copy of them -- an older revision, or one broken on purpose to check
# that these tests would notice.
# SUITE, OUT, ERR and RC are this file's interface to the suites that source
# it: written here, read there. shellcheck sees only the writes.
# shellcheck disable=SC2034

BIN=${BIN:-$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../bin" && pwd -P)}

ROOT=$(cd "$(mktemp -d)" && pwd -P)
trap 'chmod -R u+rwX "$ROOT" 2>/dev/null; rm -rf "$ROOT"' EXIT

export GIT_CONFIG_SYSTEM=/dev/null
export GIT_CONFIG_GLOBAL="$ROOT/gitconfig"
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid
cat > "$ROOT/gitconfig" <<'CFG'
[init]
	defaultBranch = main
[advice]
	detachedHead = false
CFG

pass=0
fail=0
section=""

sec() {
  section=$1
  printf '\n%s\n' "$section"
}
ok() {
  pass=$((pass + 1))
  printf '  ok   %s\n' "$1"
}
bad() {
  fail=$((fail + 1))
  printf '  FAIL %s\n' "$1"
  [ $# -gt 1 ] && printf '        %s\n' "$2"
  # FAIL_FAST stops the suite at its first failure. The mutation battery needs
  # nothing more than that, and it saves running the rest of the suite for
  # every mutation it catches.
  if [ -n "${FAIL_FAST:-}" ]; then exit 1; fi
  return 0
}
eq() { # eq <label> <got> <want>
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "want: $3
        got:  $2"; fi
}
is_dir() { if [ -d "$2" ]; then ok "$1"; else bad "$1" "missing: $2"; fi; }
no_dir() { if [ ! -d "$2" ]; then ok "$1"; else bad "$1" "still there: $2"; fi; }
has() { # has <label> <file> <substring>
  if grep -qF -- "$3" "$2"; then ok "$1"; else bad "$1" "no '$3' in: $(tr '\n' ' ' <"$2")"; fi
}
fails() { # fails <label> -- the hook under test must have exited non-zero
  if [ "$RC" -ne 0 ]; then ok "$1"; else bad "$1" "expected a non-zero exit, got 0"; fi
}
not_empty_file() {
  if [ -s "$2" ]; then ok "$1"; else bad "$1" "expected output, got nothing"; fi
}
empty_file() {
  if [ ! -s "$2" ]; then ok "$1"; else bad "$1" "expected nothing, got: $(tr '\n' ' ' <"$2")"; fi
}

# The hooks, invoked as Claude Code invokes them: a JSON event on stdin, the
# path on stdout, everything else on stderr. OUT, ERR and RC are how the suites
# read the result back, so they are written here and never read.
OUT="" ERR="" RC=0
create() {
  # shellcheck disable=SC2034 # create <name> <cwd>
  ERR=$(mktemp "$ROOT/err.XXXXXX")
  set +e
  OUT=$(printf '{"name":%s,"cwd":%s}' \
    "$(jq -Rn --arg v "$1" '$v')" "$(jq -Rn --arg v "$2" '$v')" |
    bash "$BIN/worktree-create" 2>"$ERR")
  RC=$?
  set -e
}
remove() {
  # shellcheck disable=SC2034 # remove <worktree_path> <cwd>
  ERR=$(mktemp "$ROOT/err.XXXXXX")
  set +e
  OUT=$(printf '{"worktree_path":%s,"cwd":%s}' \
    "$(jq -Rn --arg v "$1" '$v')" "$(jq -Rn --arg v "$2" '$v')" |
    bash "$BIN/worktree-remove" 2>"$ERR")
  RC=$?
  set -e
}
raw_create() {
  # shellcheck disable=SC2034 # raw_create <literal stdin>
  ERR=$(mktemp "$ROOT/err.XXXXXX")
  set +e
  OUT=$(printf '%s' "$1" | bash "$BIN/worktree-create" 2>"$ERR")
  RC=$?
  set -e
}
raw_remove() {
  ERR=$(mktemp "$ROOT/err.XXXXXX")
  set +e
  OUT=$(printf '%s' "$1" | bash "$BIN/worktree-remove" 2>"$ERR")
  RC=$?
  set -e
}

# A bare repository standing in for a remote, with main as its default branch.
mkremote() { # mkremote <name>
  git init -q --bare "$ROOT/$1.git"
  git init -q "$ROOT/$1.seed"
  git -C "$ROOT/$1.seed" commit -q --allow-empty -m base
  git -C "$ROOT/$1.seed" branch -M main
  git -C "$ROOT/$1.seed" remote add o "$ROOT/$1.git"
  git -C "$ROOT/$1.seed" push -q o main
  git -C "$ROOT/$1.git" symbolic-ref HEAD refs/heads/main
}

# The id of a process that has already exited, for a lock left by a session
# that is gone. A pid is reused eventually, but not in the moment between here
# and the hook reading it.
dead_pid() {
  bash -c 'exit 0' &
  local pid=$!
  wait "$pid"
  printf '%s' "$pid"
}

# A lock reason in the form Claude Code writes when it locks a worktree it made.
claude_lock_reason() { # claude_lock_reason <name> <pid>
  printf 'claude session %s (pid %s start Thu Sep 24 09:00:00 2026)' "$1" "$2"
}

report() {
  printf '\n%s: passed %d, failed %d\n' "${SUITE:-suite}" "$pass" "$fail"
  [ "$fail" -eq 0 ]
}
