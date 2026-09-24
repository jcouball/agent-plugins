# Shared by worktree-create and worktree-remove, which source it. Not a hook.
#
# Both hooks read git's worktree registry, and both have to decide what to do
# about a locked registration. One copy of each keeps the two hooks from
# answering the same question two ways.
#
# Paths reach awk through ENVIRON rather than `awk -v`, which processes
# backslash escapes in the value: a path holding a backslash would stop
# matching the literal path git prints, and every lookup of it would miss.

# The name the calling hook reports itself by, unless it already said.
hook=${hook:-${0##*/}}

# worktree_list <repo>
#
# The registry as `git worktree list --porcelain` prints it, but with every
# field ending in the record separator, octal 036, instead of a newline, so the
# readers below set awk's RS to that.
#
# -z where git has it, which is from 2.36 on. Without -z git quotes a lock
# reason holding a double quote, a backslash, or anything outside ASCII, C
# style, and a Claude Code lock quoted that way no longer reads as one; with it
# every field comes out raw, and a path holding a newline stays one field. A
# git older than 2.36 has no -z, and prints lock reasons unquoted, so its plain
# listing is already raw.
worktree_list() {
  local listing
  if listing=$(git -C "$1" worktree list --porcelain -z 2>/dev/null | tr '\0' '\036'); then
    printf '%s' "$listing"
    return 0
  fi
  listing=$(git -C "$1" worktree list --porcelain) || return 1
  printf '%s\n' "$listing" | tr '\n' '\036'
}

# registration_of <repo> <path>
#
# Succeeds when <repo>'s registry lists <path>, printing its lock state as
# "<locked><US><reason>": locked is 1 or 0, reason the text git recorded, and
# US the unit separator, which no path or reason contains. Fails when <path>
# is not listed or <repo> is not a repository.
#
# The registry is read into a variable and handed to awk rather than piped. A
# listing of a few hundred worktrees outruns the pipe buffer, and an early exit
# on the reading side would turn git's SIGPIPE into a pipefail failure.
registration_of() {
  local registry
  registry=$(worktree_list "$1" 2>/dev/null) || return 1
  WANT=$2 awk '
    BEGIN { RS = "\036" }
    function flush() {
      if (path != "" && path == ENVIRON["WANT"]) {
        printf "%d\037%s\n", locked, reason
        found = 1
      }
      path = ""; locked = 0; reason = ""
    }
    $1 == "worktree" { flush(); path = substr($0, 10); next }
    $1 == "locked"   { locked = 1; reason = substr($0, 8); next }
    $0 == ""         { flush(); next }
    END { flush(); exit !found }
  ' <<<"$registry"
}

# The reason Claude Code gives when it locks a worktree it made, naming the
# process of the session that holds it. The pattern is Claude Code's own.
claude_lock='^claude (agent|session) .{1,255} \(pid ([0-9]{1,10})( start .{1,255})?\)$'

# free_lock <repo> <path> <locked> <reason>
#
# Claude Code locks the worktrees it makes and unlocks them when the session
# ends. A lock whose process is gone was left by a session that did not end
# cleanly, and Claude Code breaks such a lock itself the next time it wants the
# worktree; this does the same. A lock held by a process that is still running,
# or one Claude Code did not write, is someone's claim on the worktree. git's
# `remove -f -f` would override it, and so would deleting a worktree another
# session is working in, so it is refused instead.
#
# Succeeds when the worktree is unlocked afterwards. Otherwise says why on
# stderr and fails.
free_lock() {
  local repo=$1 path=$2 locked=$3 reason=$4 pid
  if [ "$locked" != 1 ]; then return 0; fi

  if [[ $reason =~ $claude_lock ]]; then
    pid=${BASH_REMATCH[2]}
    if ps -p "$pid" >/dev/null 2>&1; then
      printf '%s\n' \
        "$hook: $path is in use by a running Claude Code session (pid $pid)." \
        "End that session first; its lock is not this hook's to break." >&2
      return 1
    fi
    git -C "$repo" worktree unlock "$path" >&2
    return 0
  fi

  printf '%s\n' \
    "$hook: $path is locked${reason:+ ($reason)}, and not by Claude Code." \
    "If it should go, unlock it first:" \
    "  git -C '$repo' worktree unlock '$path'" >&2
  return 1
}

# clear_registration <repo> <path>
#
# Clears the registration of a worktree whose directory is already gone, which
# git goes on counting as holding its branch until it is cleared. Removing it
# by name takes only that one; prune is the fallback for a git too old to
# remove a worktree whose directory it cannot find, and it clears every stale
# registration in the repository rather than only this one.
#
# Succeeds when the registration is gone afterwards, including when there was
# none to begin with. Fails, having said why, when a lock stands in the way or
# git would not let go.
clear_registration() {
  local repo=$1 path=$2 state locked reason
  state=$(registration_of "$repo" "$path") || return 0
  IFS=$'\037' read -r locked reason <<<"$state"
  free_lock "$repo" "$path" "$locked" "$reason" || return 1

  git -C "$repo" worktree remove --force -- "$path" >/dev/null 2>&1 ||
    git -C "$repo" worktree prune >&2
  if registration_of "$repo" "$path" >/dev/null; then
    printf '%s\n' \
      "$hook: the registration of $path, whose directory is gone, could not be cleared," \
      "so git still counts it as holding its branch. Try:" \
      "  git -C '$repo' worktree prune" >&2
    return 1
  fi
}
