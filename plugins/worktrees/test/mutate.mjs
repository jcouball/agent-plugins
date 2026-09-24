#!/usr/bin/env node
//
// Mutation testing for the worktrees hooks: break a hook on purpose, one small
// change at a time, and confirm the suites notice. A passing suite says the
// hooks do what the tests check; a caught mutation says the tests check
// something. A mutation nothing catches is a hole in the suites, or a line
// the hooks could lose without anyone being able to tell.
//
//   node plugins/worktrees/test/mutate.mjs            every mutation
//   node plugins/worktrees/test/mutate.mjs remote     labels containing "remote"
//   MUTATE_JOBS=4 node plugins/worktrees/test/mutate.mjs
//
// Each mutation is one or more literal strings, each replaced once in one file
// under bin/. Every one is checked against the files before anything runs, and
// one that no longer matches exactly once fails the whole run: a hook edited
// out from under its mutations would otherwise pass here by testing nothing.

import { readFileSync, writeFileSync, mkdtempSync, rmSync, copyFileSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir, availableParallelism } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const bin = join(here, '..', 'bin')
// Everything in bin/ is copied for each mutation, the shared library included,
// and any of it can be mutated. A mutation in the library is tried against
// both suites, since both hooks source it.
const files = ['worktree-create', 'worktree-remove', 'worktree-lib.sh']
const suiteFor = { 'worktree-create': 'create', 'worktree-remove': 'remove' }
const suites = ['create', 'remove']

// A suite that runs past this is killed and the mutation counted as caught: a
// hook that hangs is broken, and a hang is noticed. The suites take seconds.
const timeoutMs = 180_000

// `survives` marks a mutation the suites are known not to catch, with the
// reason. Such a mutation is expected to survive, and one that stops surviving
// fails the run too, so this list and the suites cannot drift apart silently.
const mutations = [
  // worktree-create: naming
  {
    file: 'worktree-create',
    label: 'slashed names not flattened',
    from: 'flat=${name//\\//+}',
    to: 'flat=$name',
  },
  {
    file: 'worktree-create',
    label: 'branch not named worktree-<name>',
    from: 'branch=worktree-$flat',
    to: 'branch=$flat',
  },

  // worktree-create: finding the repository and the container
  {
    file: 'worktree-create',
    label: 'core.worktree read from the whole config stack',
    from: 'config --get --local core.worktree',
    to: 'config --get core.worktree',
  },
  {
    file: 'worktree-create',
    label: 'every common dir taken for <main worktree>/.git',
    from: 'elif [ "${common##*/}" = .git ]; then',
    to: 'elif true; then',
  },
  {
    file: 'worktree-create',
    label: 'bare and separate git dirs keyed on the common dir\'s parent',
    from: '  key=$common',
    to: '  key=$(dirname -- "$common")',
  },
  {
    file: 'worktree-create',
    label: 'nesting guard ignores check-ignore',
    from: ' &&\n    ! git -C "$parent" check-ignore --quiet -- "$container" 2>/dev/null; }',
    to: '; }',
  },
  {
    file: 'worktree-create',
    label: 'superproject check dropped',
    from: '[ -n "$(git -C "$cwd" rev-parse --show-superproject-working-tree 2>/dev/null)" ] ||',
    to: 'false ||',
  },
  {
    file: 'worktree-create',
    label: 'nesting guard never stands aside',
    from: '  container="$claude_root/.claude/worktrees"',
    to: '  container="$key.worktrees"',
  },
  {
    file: 'worktree-create',
    label: 'container path not resolved',
    from: 'container=$(resolved "$container")',
    to: ':',
  },

  // worktree-create: resume
  {
    file: 'worktree-create',
    label: 'resume by our path never answers',
    from: 'if [ -n "$exact" ]; then',
    to: 'if false; then',
  },
  {
    file: 'worktree-create',
    label: 'resume at Claude Code\'s own path never answers',
    from: 'if [ -n "$legacy_live" ]; then',
    to: 'if false; then',
  },
  {
    file: 'worktree-create',
    label: 'a hand-made worktree holding the branch is resumed',
    from: '  held) held=$path ;;',
    to: '  held) legacy_live=$path ;;',
  },
  {
    file: 'worktree-create',
    label: 'a hand-made worktree holding the branch is left to git',
    from: 'if [ -n "$held" ]; then',
    to: 'if false; then',
  },
  {
    file: 'worktree-create',
    label: 'main worktree not counted as holding the branch',
    edits: [
      ['$1 == "worktree" { flush(); path', '$1 == "worktree" { flush(); n++; path'],
      ['else if (br == ENVIRON["BRANCH"])', 'else if (n > 1 && br == ENVIRON["BRANCH"])'],
    ],
  },
  {
    file: 'worktree-create',
    label: 'registry paths passed through awk -v (create)',
    edits: [
      ['matches=$(WANT="$worktree" LEGACY', 'matches=$(LEGACY'],
      ['BRANCH="refs/heads/$branch" awk \'', 'BRANCH="refs/heads/$branch" awk -v want="$worktree" \''],
      ['if (path == ENVIRON["WANT"])', 'if (path == want)'],
    ],
  },
  {
    file: 'worktree-create',
    label: 'staleness ignores the disk',
    from: 'if [ ! -d "$path" ]; then',
    to: 'if false; then',
  },
  {
    file: 'worktree-create',
    label: 'stale registrations never cleared',
    from: '  clear_registration "$cwd" "$path" || exit 1',
    to: '  :',
  },

  // worktree-create: the base
  {
    file: 'worktree-create',
    label: 'sole non-origin remote not used',
    from: 'if [ -z "$remote" ] && [ "$count" -eq 1 ]; then remote=$only; fi',
    to: ':',
  },
  {
    file: 'worktree-create',
    label: 'several remotes and no origin not refused',
    from: '  elif [ -z "$remote" ]; then\n    printf',
    to: '  elif false; then\n    printf',
  },
  {
    file: 'worktree-create',
    label: 'a remote with no default falls back to HEAD',
    from: '  elif [ -z "$base" ]; then',
    to: '  elif [ -z "$base" ] && ! base=HEAD; then',
  },
  {
    file: 'worktree-create',
    label: 'a default naming a branch that is gone not refused',
    from: 'elif ! git -C "$cwd" show-ref --verify --quiet "$base"; then',
    to: 'elif false; then',
  },
  {
    file: 'worktree-create',
    label: 'no remote does not fall back to HEAD',
    from: '    base=${bare_head:-HEAD}',
    to: '    base=${bare_head:-origin/HEAD}',
  },
  {
    file: 'worktree-create',
    label: 'a bare repository\'s HEAD never used',
    from: '    bare_head=$(git --git-dir="$common" symbolic-ref --quiet HEAD 2>/dev/null) || bare_head=\'\'',
    to: '    :',
  },
  {
    file: 'worktree-create',
    label: 'a bare repository\'s HEAD read from the session\'s worktree',
    from: 'bare_head=$(git --git-dir="$common" symbolic-ref',
    to: 'bare_head=$(git -C "$cwd" symbolic-ref',
  },
  {
    file: 'worktree-create',
    label: 'new branch tracks its base',
    from: 'add=(add --no-track -b',
    to: 'add=(add -b',
  },
  {
    file: 'worktree-create',
    label: 'existing branch branched rather than checked out',
    from: 'add=(add -- "$worktree" "$branch")',
    to: 'add=(add -b "$branch" -- "$worktree")',
  },

  // worktree-create: creating, and what reaches stdout
  {
    file: 'worktree-create',
    label: 'container created before the refusals',
    from: '# How the worktree gets created',
    to: 'mkdir -p -- "$container"\n# How the worktree gets created',
  },
  {
    file: 'worktree-create',
    label: 'git output reaches stdout',
    from: 'git -C "$cwd" worktree "${add[@]}" >&2',
    to: 'git -C "$cwd" worktree "${add[@]}"',
  },
  {
    file: 'worktree-create',
    label: 'a missing name read as the string null',
    from: `jq -re '.name'`,
    to: `jq -r '.name'`,
    survives: 'the name check reads .name from the event itself and refuses null there, ' +
      'so reading it leniently first changes nothing',
  },

  // worktree-create: names Claude Code would not accept
  {
    file: 'worktree-create',
    label: 'names never checked',
    from: 'if ! printf \'%s\' "$event" | jq -e \'',
    to: 'if false && printf \'%s\' "$event" | jq -e \'',
  },
  {
    file: 'worktree-create',
    label: 'an empty name accepted',
    from: 'length > 0 and length <= 64',
    to: 'length <= 64',
  },
  {
    file: 'worktree-create',
    label: 'a name over 64 characters accepted',
    from: 'length > 0 and length <= 64',
    to: 'length > 0',
  },
  {
    file: 'worktree-create',
    label: 'any character accepted in a name',
    from: 'test("^[a-zA-Z0-9._-]+$")',
    to: 'test("^.+$")',
  },
  {
    file: 'worktree-create',
    label: '. and .. segments accepted',
    from: ' and . != "." and . != ".." and',
    to: ' and',
  },
  {
    file: 'worktree-create',
    label: 'a .git segment accepted',
    from: '(ascii_downcase | sub("\\\\.+$"; "")) != ".git"',
    to: 'true',
  },
  {
    file: 'worktree-create',
    label: 'a .git segment with trailing dots accepted',
    from: '(ascii_downcase | sub("\\\\.+$"; "")) != ".git"',
    to: 'ascii_downcase != ".git"',
  },

  // worktree-lib.sh: the registry and locks
  {
    file: 'worktree-lib.sh',
    label: 'registry paths passed through awk -v (library)',
    edits: [
      ['WANT=$2 awk \'', 'awk -v want="$2" \''],
      ['path == ENVIRON["WANT"]', 'path == want'],
    ],
  },
  {
    file: 'worktree-lib.sh',
    label: 'registry read without -z, lock reasons quoted',
    from: 'worktree list --porcelain -z 2>/dev/null',
    to: 'worktree list --porcelain --no-such-option 2>/dev/null',
  },
  {
    file: 'worktree-lib.sh',
    label: 'locks ignored',
    from: 'if [ "$locked" != 1 ]; then return 0; fi',
    to: 'return 0',
  },
  {
    file: 'worktree-lib.sh',
    label: 'a running session\'s lock broken',
    from: 'if ps -p "$pid" >/dev/null 2>&1; then',
    to: 'if false; then',
  },
  {
    file: 'worktree-lib.sh',
    label: 'a stale Claude Code lock not broken',
    from: '    git -C "$repo" worktree unlock "$path" >&2\n    return 0',
    to: '    return 1',
  },
  {
    file: 'worktree-lib.sh',
    label: 'every lock read as Claude Code\'s',
    from: 'if [[ $reason =~ $claude_lock ]]; then',
    to: 'if true; then',
  },
  {
    file: 'worktree-lib.sh',
    label: 'no lock read as Claude Code\'s',
    from: 'if [[ $reason =~ $claude_lock ]]; then',
    to: 'if false; then',
  },
  {
    file: 'worktree-lib.sh',
    label: 'clearing a registration ignores its lock',
    from: '  free_lock "$repo" "$path" "$locked" "$reason" || return 1',
    to: '  :',
  },
  {
    file: 'worktree-lib.sh',
    label: 'an uncleared registration reported as cleared',
    from: '  if registration_of "$repo" "$path" >/dev/null; then',
    to: '  if false; then',
    survives: 'only a registration git will not remove and prune will not clear reaches it, ' +
      'and a lock, the one thing that does that on a current git, is refused before it',
  },
  {
    file: 'worktree-lib.sh',
    label: 'prune fallback dropped',
    from: '    git -C "$repo" worktree prune >&2',
    to: '    true',
    survives: 'the fallback is for a git too old to remove a worktree it cannot find; ' +
      'on a newer git it never changes the outcome',
  },

  // worktree-remove: refusing, and finding the owner
  {
    file: 'worktree-remove',
    label: 'main worktree guard removed',
    from: '  if [ "$git_dir" = "$git_common" ]; then',
    to: '  if false; then',
  },
  {
    file: 'worktree-remove',
    label: 'main worktree guard answers for an enclosing repository',
    from: 'if top=$(git -C "$worktree" rev-parse --show-toplevel 2>/dev/null) &&\n' +
      '  [ "$top" = "$(CDPATH=\'\' cd -- "$worktree" && pwd -P)" ]; then',
    to: 'if git -C "$worktree" rev-parse --git-dir >/dev/null 2>&1; then',
  },
  {
    file: 'worktree-remove',
    label: 'a worktree moved by hand not repaired',
    from: '  git -C "$worktree" worktree repair >/dev/null 2>&1 || true',
    to: '  :',
  },
  {
    file: 'worktree-remove',
    label: 'a live worktree outside both layouts removed',
    from: 'if [ -z "$container" ] && [ -d "$worktree" ]; then',
    to: 'if false; then',
  },
  {
    file: 'worktree-remove',
    label: 'owner search stops at the worktree itself',
    from: 'for repo in "$worktree" "$derived" "$cwd"; do',
    to: 'for repo in "$worktree"; do',
  },
  {
    file: 'worktree-remove',
    label: 'derived owner never asked',
    from: 'for repo in "$worktree" "$derived" "$cwd"; do',
    to: 'for repo in "$worktree" "$cwd"; do',
  },
  {
    file: 'worktree-remove',
    label: 'cwd never asked',
    from: 'for repo in "$worktree" "$derived" "$cwd"; do',
    to: 'for repo in "$worktree" "$derived"; do',
  },
  {
    file: 'worktree-remove',
    label: 'nested layout owner not derived',
    from: '*/.claude/worktrees) derived=${container%/.claude/worktrees} ;;',
    to: '*/.claude/worktrees) derived="" ;;',
  },
  {
    file: 'worktree-remove',
    label: 'sibling layout owner not derived',
    from: '*.worktrees) derived=${container%.worktrees} ;;',
    to: '*.worktrees) derived="" ;;',
  },
  {
    file: 'worktree-remove',
    label: 'a missing worktree_path read as the string null',
    from: `jq -re '.worktree_path'`,
    to: `jq -r '.worktree_path'`,
  },

  // worktree-remove: removing, and what it says
  {
    file: 'worktree-remove',
    label: 'removal never forced',
    from: 'git -C "$owner" worktree remove --force -- "$worktree" >&2',
    to: 'git -C "$owner" worktree remove -- "$worktree" >&2',
  },
  {
    file: 'worktree-remove',
    label: 'a live worktree\'s lock not honored',
    from: '    free_lock "$owner" "$worktree" "$locked" "$reason" || exit 1',
    to: '    :',
  },
  {
    file: 'worktree-remove',
    label: 'a gone directory\'s registration left standing',
    from: '    clear_registration "$owner" "$worktree" || true',
    to: '    true',
  },
  {
    file: 'worktree-remove',
    label: 'stray directory left in place',
    from: '  rm -rf -- "$worktree"',
    to: '  :',
  },
  {
    file: 'worktree-remove',
    label: 'nowhere to look goes unreported',
    from: 'elif [ -z "$looked" ]; then',
    to: 'elif false; then',
  },
  {
    file: 'worktree-remove',
    label: 'looked always set',
    from: 'looked=""\nowner=""',
    to: 'looked=yes\nowner=""',
  },

  // worktree-remove: taking the container away
  {
    file: 'worktree-remove',
    label: 'cleanup climbs past the container',
    from: '  rmdir -- "$container" 2>/dev/null || true',
    to: '  rmdir -p -- "$container" 2>/dev/null || true',
  },
  {
    file: 'worktree-remove',
    label: 'cleanup skipped entirely',
    from: '  rmdir -- "$container" 2>/dev/null || true',
    to: '  :',
  },
]

const filters = process.argv.slice(2)
const selected = filters.length === 0
  ? mutations
  : mutations.filter((m) => filters.some((f) => m.label.includes(f)))

if (selected.length === 0) {
  console.error(`mutate: no mutation label contains ${filters.map((f) => `"${f}"`).join(' or ')}`)
  process.exit(1)
}

// Every anchor is checked first, and a hook edited out from under its
// mutations fails the run before anything runs.
const sources = Object.fromEntries(files.map((f) => [f, readFileSync(join(bin, f), 'utf8')]))
const editsOf = (m) => m.edits ?? [[m.from, m.to]]
const drifted = selected.filter((m) =>
  editsOf(m).some(([from]) => sources[m.file].split(from).length - 1 !== 1))
if (drifted.length > 0) {
  console.error('mutate: these mutations no longer match their hook exactly once; update them:')
  for (const m of drifted) console.error(`  ${m.file}: ${m.label}`)
  process.exit(1)
}

// Runs one suite against the hooks in `binDir`. Resolves to 'passed',
// 'failed', or 'timed out'. The suite gets its own process group so a timeout
// takes every git and bash under it down too.
const runSuite = (binDir, suite, { failFast = true, capture = false } = {}) =>
  new Promise((resolve) => {
    const env = { ...process.env, BIN: binDir }
    if (failFast) env.FAIL_FAST = '1'
    else delete env.FAIL_FAST
    const child = spawn('bash', [join(here, `${suite}.sh`)], {
      env,
      detached: true,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    })
    let output = ''
    if (capture) {
      child.stdout.on('data', (chunk) => { output += chunk })
      child.stderr.on('data', (chunk) => { output += chunk })
    }
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try { process.kill(-child.pid, 'SIGKILL') } catch {}
    }, timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ result: timedOut ? 'timed out' : code === 0 ? 'passed' : 'failed', output })
    })
  })

// The mutated hook's own suite goes first (both, in order, for the library), since it is the likelier to catch
// the mutation; the other suite runs only if the first one passes.
const tryMutation = async (m) => {
  const dir = mkdtempSync(join(tmpdir(), 'worktrees-mutant-'))
  try {
    for (const f of files) {
      copyFileSync(join(bin, f), join(dir, f))
      chmodSync(join(dir, f), 0o755)
    }
    const mutated = editsOf(m).reduce((text, [from, to]) => text.replace(from, () => to), sources[m.file])
    writeFileSync(join(dir, m.file), mutated)

    const own = suiteFor[m.file]
    const order = own ? [own, ...suites.filter((s) => s !== own)] : suites
    for (const suite of order) {
      const { result } = await runSuite(dir, suite)
      if (result !== 'passed') return { m, caughtBy: suite, how: result }
    }
    return { m, caughtBy: null }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// A mutation is only evidence against suites that pass on the real hooks.
for (const suite of suites) {
  const { result, output } = await runSuite(bin, suite, { failFast: false, capture: true })
  if (result !== 'passed') {
    process.stdout.write(output)
    console.error(`mutate: the ${suite} suite does not pass on the unmutated hooks (${result}); ` +
      'fix that first, or every mutation reads as caught')
    process.exit(1)
  }
}

const jobs = Math.max(1, Number(process.env.MUTATE_JOBS) || availableParallelism())
const results = new Array(selected.length)
let next = 0
await Promise.all(Array.from({ length: Math.min(jobs, selected.length) }, async () => {
  while (next < selected.length) {
    const i = next++
    results[i] = await tryMutation(selected[i])
  }
}))

let unexpected = 0
for (const { m, caughtBy, how } of results) {
  const hook = m.file.replace('worktree-', '').replace('.sh', '')
  if (caughtBy && !m.survives) {
    const note = how === 'timed out' ? ', timed out' : ''
    console.log(`  caught    ${hook}: ${m.label} (${caughtBy} suite${note})`)
  } else if (!caughtBy && m.survives) {
    console.log(`  survives  ${hook}: ${m.label} (expected: ${m.survives})`)
  } else if (!caughtBy) {
    unexpected += 1
    console.log(`  MISSED    ${hook}: ${m.label}`)
  } else {
    unexpected += 1
    console.log(`  CAUGHT    ${hook}: ${m.label}, listed as surviving; drop its survives note`)
  }
}

const caught = results.filter((r) => r.caughtBy).length
console.log(`\nmutations: ${results.length} run, ${caught} caught, ` +
  `${results.length - caught} survived, ${unexpected} unexpected`)
process.exit(unexpected === 0 ? 0 : 1)
