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
// Each mutation is a literal string replaced once in one hook. Every one is
// checked against the hooks before anything runs, and one that no longer
// matches exactly once fails the whole run: a hook edited out from under its
// mutations would otherwise pass here by testing nothing.

import { readFileSync, writeFileSync, mkdtempSync, rmSync, copyFileSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir, availableParallelism } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const bin = join(here, '..', 'bin')
const hooks = ['worktree-create', 'worktree-remove']
const suiteFor = { 'worktree-create': 'create', 'worktree-remove': 'remove' }

// A suite that runs past this is killed and the mutation counted as caught: a
// hook that hangs is broken, and a hang is noticed. The suites take seconds.
const timeoutMs = 180_000

// `survives` marks a mutation the suites are known not to catch, with the
// reason. Such a mutation is expected to survive, and one that stops surviving
// fails the run too, so this list and the suites cannot drift apart silently.
const mutations = [
  // worktree-create: finding the main worktree and the container
  {
    hook: 'worktree-create',
    label: 'core.worktree read from the whole config stack',
    from: 'config --get --local core.worktree',
    to: 'config --get core.worktree',
  },
  {
    hook: 'worktree-create',
    label: 'nesting guard ignores check-ignore',
    from: ' &&\n    ! git -C "$parent" check-ignore --quiet -- "$container" 2>/dev/null; }',
    to: '; }',
  },
  {
    hook: 'worktree-create',
    label: 'superproject check dropped',
    from: '[ -n "$(git -C "$cwd" rev-parse --show-superproject-working-tree 2>/dev/null)" ] ||',
    to: 'false ||',
  },
  {
    hook: 'worktree-create',
    label: 'nesting guard never stands aside',
    from: '  container="$main_tree/.claude/worktrees"',
    to: '  container="$main_tree.worktrees"',
  },
  {
    hook: 'worktree-create',
    label: 'container path not resolved',
    from: 'container=$(resolved "$container")',
    to: ':',
  },

  // worktree-create: resume
  {
    hook: 'worktree-create',
    label: 'resume by path never answers',
    from: 'if [ -n "$exact" ] && [ -d "$exact" ]; then',
    to: 'if false; then',
  },
  {
    hook: 'worktree-create',
    label: 'resume by branch never answers',
    from: 'else if (n > 1 && br == branch && other == "") other = path',
    to: 'else if (0) other = path',
  },
  {
    hook: 'worktree-create',
    label: 'main worktree counted as a resume target',
    from: 'else if (n > 1 && br == branch',
    to: 'else if (br == branch',
  },
  {
    hook: 'worktree-create',
    label: 'resume by path ignores the disk',
    from: 'if [ -n "$exact" ] && [ -d "$exact" ]; then',
    to: 'if [ -n "$exact" ]; then',
  },
  {
    hook: 'worktree-create',
    label: 'resume by branch ignores the disk',
    from: 'if [ -n "$other" ] && [ -d "$other" ]; then',
    to: 'if [ -n "$other" ]; then',
  },
  {
    hook: 'worktree-create',
    label: 'stale registrations never cleared',
    from: 'for stale in "$exact" "$other"; do',
    to: 'for stale in; do',
  },
  {
    hook: 'worktree-create',
    label: 'stale registration holding the branch not cleared',
    from: 'for stale in "$exact" "$other"; do',
    to: 'for stale in "$exact"; do',
  },
  {
    hook: 'worktree-create',
    label: 'prune fallback dropped (create)',
    from: '    git -C "$cwd" worktree prune >&2',
    to: '    true',
    survives: 'the fallback is for a git too old to remove a worktree it cannot find; ' +
      'on a newer git it never changes the outcome',
  },

  // worktree-create: the base
  {
    hook: 'worktree-create',
    label: 'sole non-origin remote not used',
    from: 'if [ -z "$remote" ] && [ "$count" -eq 1 ]; then remote=$only; fi',
    to: ':',
  },
  {
    hook: 'worktree-create',
    label: 'several remotes and no origin not refused',
    from: 'elif [ -z "$remote" ]; then',
    to: 'elif false; then',
  },
  {
    hook: 'worktree-create',
    label: 'a remote with no default falls back to HEAD',
    from: 'symbolic-ref --quiet --short "refs/remotes/$remote/HEAD")',
    to: 'symbolic-ref --quiet --short "refs/remotes/$remote/HEAD" || echo HEAD)',
  },
  {
    hook: 'worktree-create',
    label: 'no remote does not fall back to HEAD',
    from: '    base=HEAD',
    to: '    base=origin/HEAD',
  },
  {
    hook: 'worktree-create',
    label: 'new branch tracks its base',
    from: 'add=(add --no-track -b',
    to: 'add=(add -b',
  },
  {
    hook: 'worktree-create',
    label: 'existing branch branched rather than checked out',
    from: 'add=(add -- "$worktree" "$name")',
    to: 'add=(add -b "$name" -- "$worktree")',
  },

  // worktree-create: creating, and what reaches stdout
  {
    hook: 'worktree-create',
    label: 'container created before the refusals',
    from: '# How the worktree gets created',
    to: 'mkdir -p -- "$container"\n# How the worktree gets created',
  },
  {
    hook: 'worktree-create',
    label: 'git output reaches stdout',
    from: 'git -C "$cwd" worktree "${add[@]}" >&2',
    to: 'git -C "$cwd" worktree "${add[@]}"',
  },
  {
    hook: 'worktree-create',
    label: 'a missing name read as the string null',
    from: `jq -re '.name'`,
    to: `jq -r '.name'`,
  },

  // worktree-remove: refusing, and finding the owner
  {
    hook: 'worktree-remove',
    label: 'main worktree guard removed',
    from: '  if [ "$git_dir" = "$git_common" ]; then',
    to: '  if false; then',
  },
  {
    hook: 'worktree-remove',
    label: 'owner search stops at the worktree itself',
    from: 'for repo in "$worktree" "$derived" "$cwd"; do',
    to: 'for repo in "$worktree"; do',
  },
  {
    hook: 'worktree-remove',
    label: 'derived owner never asked',
    from: 'for repo in "$worktree" "$derived" "$cwd"; do',
    to: 'for repo in "$worktree" "$cwd"; do',
  },
  {
    hook: 'worktree-remove',
    label: 'cwd never asked',
    from: 'for repo in "$worktree" "$derived" "$cwd"; do',
    to: 'for repo in "$worktree" "$derived"; do',
  },
  {
    hook: 'worktree-remove',
    label: 'nested layout owner not derived',
    from: '    derived=${d%/.claude/worktrees}',
    to: '    derived=""',
  },
  {
    hook: 'worktree-remove',
    label: 'sibling layout owner not derived',
    from: '    derived=${d%.worktrees}',
    to: '    derived=""',
  },
  {
    hook: 'worktree-remove',
    label: 'a missing worktree_path read as the string null',
    from: `jq -re '.worktree_path'`,
    to: `jq -r '.worktree_path'`,
  },

  // worktree-remove: removing, and what it says
  {
    hook: 'worktree-remove',
    label: 'removal never forced',
    from: 'worktree remove --force -- "$worktree"',
    to: 'worktree remove -- "$worktree"',
  },
  {
    hook: 'worktree-remove',
    label: 'prune fallback dropped (remove)',
    from: '    git -C "$owner" worktree prune >&2',
    to: '    true',
    survives: 'the fallback is for a git too old to remove a worktree it cannot find; ' +
      'on a newer git it never changes the outcome',
  },
  {
    hook: 'worktree-remove',
    label: 'an uncleared registration reported as cleared',
    from: 'registered "$owner" || cleared=yes',
    to: 'cleared=yes',
  },
  {
    hook: 'worktree-remove',
    label: 'stray directory left in place',
    from: '  rm -rf -- "$worktree"',
    to: '  :',
  },
  {
    hook: 'worktree-remove',
    label: 'nowhere to look goes unreported',
    from: 'elif [ -z "$looked" ]; then',
    to: 'elif false; then',
  },
  {
    hook: 'worktree-remove',
    label: 'looked always set',
    from: 'looked=""\nowner=""',
    to: 'looked=yes\nowner=""',
  },

  // worktree-remove: taking the container away
  {
    hook: 'worktree-remove',
    label: 'cleanup climbs with rmdir -p again',
    from: '  d=$(dirname -- "$worktree")\n  while :; do\n    rmdir -- "$d" 2>/dev/null || break\n' +
      '    if [ "$d" = "$container" ]; then break; fi\n    d=$(dirname -- "$d")\n  done',
    to: '  rmdir -p -- "$(dirname -- "$worktree")" 2>/dev/null || true',
  },
  {
    hook: 'worktree-remove',
    label: 'cleanup does not stop at the container',
    from: '    if [ "$d" = "$container" ]; then break; fi',
    to: '    :',
  },
  {
    hook: 'worktree-remove',
    label: 'cleanup skipped entirely',
    from: 'if [ -n "$container" ]; then',
    to: 'if false; then',
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
const sources = Object.fromEntries(hooks.map((h) => [h, readFileSync(join(bin, h), 'utf8')]))
const drifted = selected.filter((m) => sources[m.hook].split(m.from).length - 1 !== 1)
if (drifted.length > 0) {
  console.error('mutate: these mutations no longer match their hook exactly once; update them:')
  for (const m of drifted) console.error(`  ${m.hook}: ${m.label}`)
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

// The mutated hook's own suite goes first, since it is the likelier to catch
// the mutation; the other suite runs only if the first one passes.
const tryMutation = async (m) => {
  const dir = mkdtempSync(join(tmpdir(), 'worktrees-mutant-'))
  try {
    for (const h of hooks) {
      copyFileSync(join(bin, h), join(dir, h))
      chmodSync(join(dir, h), 0o755)
    }
    writeFileSync(join(dir, m.hook), sources[m.hook].replace(m.from, () => m.to))

    const own = suiteFor[m.hook]
    const order = [own, ...Object.values(suiteFor).filter((s) => s !== own)]
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
for (const suite of Object.values(suiteFor)) {
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
  const hook = m.hook.replace('worktree-', '')
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
