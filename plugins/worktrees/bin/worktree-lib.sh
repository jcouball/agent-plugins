# shellcheck shell=bash
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

# macOS and Linux only. On Windows, Claude Code runs hooks in Git Bash, and
# nothing here is written for that: the paths Claude Code hands over and takes
# back are not POSIX paths, and Git Bash's ps cannot see the Windows process a
# Claude Code lock names, so a live session's lock would read as stale and be
# broken. Refusing outright is the safe failure, though it blocks worktree
# creation while the plugin is enabled.
case $(uname -s) in
MINGW* | MSYS* | CYGWIN*)
  printf '%s\n' \
    "$hook: the worktrees plugin supports macOS and Linux, not Windows." \
    "Disable it to let Claude Code create and remove worktrees itself:" \
    "  claude plugin disable jcouball-worktrees@jcouball" >&2
  exit 1
  ;;
esac

# find_key <dir>
#
# Which repository <dir> belongs to, and what its container is keyed on. Sets
# common, the repository's common dir; main_tree, its main worktree, or empty
# when it has none to find; and key.
#
# For an ordinary repository the common dir is <main worktree>/.git, from the
# main worktree and from any linked one alike, and the container sits beside
# that main worktree. A submodule's common dir is <super>/.git/modules/<name>,
# a directory of git metadata, and core.worktree is what names its working tree
# instead; --local, because a global or system core.worktree would otherwise
# redirect every repository's worktrees to wherever it points.
#
# Anything else has no main worktree to find. A bare repository has none at
# all, and a repository cloned with --separate-git-dir has one that nothing in
# the git directory points back to, so it can be found only from inside it, and
# from a linked worktree not at all. The container is keyed on the common dir
# itself there, which every worktree of the repository agrees on. Its parent
# would not do: every repository kept in the same folder would share it.
# shellcheck disable=SC2034 # key is read by the hooks that call this
find_key() {
  local inner
  common=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir) || return 1
  common=$(CDPATH='' cd -- "$common" && pwd -P)
  inner=$(git --git-dir="$common" config --get --local core.worktree 2>/dev/null) || true
  if [ -n "$inner" ]; then
    main_tree=$(CDPATH='' cd -- "$common" && CDPATH='' cd -- "$inner" && pwd -P)
    key=$main_tree
  elif [ "${common##*/}" = .git ]; then
    main_tree=$(dirname -- "$common")
    key=$main_tree
  else
    main_tree=''
    key=$common
  fi
}

# resolved <path>
#
# <path> with every symlink in the part of it that exists resolved, and the rest
# kept as written. git records a worktree's path resolved, so a path compared
# against the registry has to be resolved the same way or it matches nothing.
# A directory that does not exist yet cannot be entered to resolve it, so only
# the part that is already there is; git creates the rest as real directories.
resolved() {
  local path=$1 tail=''
  while [ ! -d "$path" ]; do
    tail=/$(basename -- "$path")$tail
    path=$(dirname -- "$path")
  done
  printf '%s' "$(CDPATH='' cd -- "$path" && pwd -P)$tail"
}

# worktree_list <repo>
#
# The registry as `git worktree list --porcelain` prints it, but with every
# field ending in the record separator, octal 036, instead of a newline, so the
# readers below set awk's RS to that.
#
# -z where git has it, which is from 2.36 on. Without -z git quotes a lock
# reason holding a double quote, a backslash, or anything outside ASCII, C
# style, and a Claude Code lock quoted that way no longer reads as one; with it
# every field comes out raw. A git older than 2.36 has no -z, and prints lock
# reasons unquoted, so its plain listing is already raw.
#
# A path or reason holding a newline is not supported. The readers below print
# what they find one line per record, so such a value comes back split. Every
# way that goes wrong is a refusal or a lookup that matches nothing, not a
# removal of the wrong worktree.
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

# is_claude <pid>
#
# Succeeds when <pid> is a Claude Code process: the native binary, named
# claude, or node running the npm package, whose command line names claude or
# @anthropic-ai/claude-code.
is_claude() {
  local comm args
  comm=$(ps -o comm= -p "$1" 2>/dev/null) || return 1
  if [ "${comm##*/}" = claude ]; then return 0; fi
  if [ "${comm##*/}" != node ]; then return 1; fi
  args=$(ps -o args= -p "$1" 2>/dev/null) || return 1
  [[ $args =~ (^|[[:space:]/])claude([[:space:]]|$)|@anthropic-ai/claude-code ]]
}

# is_caller <pid>
#
# Succeeds when <pid> is the Claude Code session that called this hook: the
# nearest Claude Code process above it. Claude Code runs a hook through a
# shell, so that is a grandparent or further up, never only the parent. Only
# the nearest counts. A session started from inside another one, from its Bash
# tool, has the outer session among its ancestors too, and the outer session's
# lock is not the inner one's to break.
is_caller() {
  local want=$1 pid=$PPID
  while [ -n "$pid" ] && [ "$pid" -gt 1 ]; do
    if is_claude "$pid"; then
      [ "$pid" = "$want" ]
      return
    fi
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ') || return 1
  done
  return 1
}

# free_lock <repo> <path> <locked> <reason>
#
# Claude Code locks the worktrees it makes and unlocks them when the session
# ends. A lock whose process is gone was left by a session that did not end
# cleanly, and Claude Code breaks such a lock itself the next time it wants the
# worktree; this does the same, and so it does for a lock held by the session
# that called the hook. A lock held by any other process that is still
# running, or one Claude Code did not write, is someone's claim on the
# worktree. git's `remove -f -f` would override it, and so would deleting a
# worktree another session is working in, so it is refused instead.
#
# The pid alone decides whether the process is running. A pid the system has
# since given to another process makes a stale lock look held; the refusal then
# names `worktree unlock` as the way past it. Claude Code's lock also records
# the process's start time, which would tell the two apart, but its format is
# Claude Code's own and undocumented, and a refusal is the safe way to be
# wrong.
#
# Succeeds when the worktree is unlocked afterwards. Otherwise says why on
# stderr and fails.
free_lock() {
  local repo=$1 path=$2 locked=$3 reason=$4 pid
  if [ "$locked" != 1 ]; then return 0; fi

  if [[ $reason =~ $claude_lock ]]; then
    pid=${BASH_REMATCH[2]}
    # The session holding the lock may be the one that called this hook, asking
    # for its own worktree to go before it has let go of it. That lock is the
    # caller's to break, and the caller is asking.
    if ! is_caller "$pid" && ps -p "$pid" >/dev/null 2>&1; then
      printf '%s\n' \
        "$hook: $path is in use by a running Claude Code session (pid $pid)." \
        "End that session first; its lock is not this hook's to break. If no such" \
        "session is running, the pid now belongs to another process; unlock it:" \
        "  git -C '$repo' worktree unlock '$path'" >&2
      return 1
    fi
    if ! git -C "$repo" worktree unlock "$path" >&2; then
      printf '%s\n' \
        "$hook: $path carries a Claude Code lock this hook may break (pid $pid)," \
        "but unlocking it failed, so it was left where it is." >&2
      return 1
    fi
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
