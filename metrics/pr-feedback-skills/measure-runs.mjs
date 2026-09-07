#!/usr/bin/env node
//
// Measure runs of the PR feedback skills recorded in Claude Code transcripts.
//
// A run starts where a transcript invokes a skill whose name matches the
// pattern, either as a slash command (a `<command-name>` tag in a user
// message) or as a `Skill` tool call, and ends at the next invocation or at
// the end of the transcript. For each run the script reports turns, tool
// calls, user prompts, wall minutes, tokens, context per turn, subagent
// turns, and the size of the skill text injected into the context, which
// would hold for any skill, and then rounds, setup, and threads resolved,
// which are how the address-pr-feedback skills work and hold for nothing
// else. That is why the script lives beside the reports it produces.
//
// Usage:
//   node metrics/pr-feedback-skills/measure-runs.mjs [options] <skill-regex> [<dir>...]
//   node metrics/pr-feedback-skills/measure-runs.mjs --compare <before.json> <after.json>
//
// Options:
//   --project <name>  read every ~/.claude/projects/*<name>* directory, which
//                     picks up the worktree sessions of the project too
//   --since <date>    keep only runs that started on or after the date (UTC)
//   --until <date>    keep only runs that started before the date (UTC)
//   --markdown        print the report tables (the default)
//   --json            print the per-run data
//   --compare         print a before-and-after table from two --json files
//
// Transcripts exist only on the machine where the sessions ran, so the
// committed reports are the durable record.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, basename, resolve } from 'node:path'
import { homedir } from 'node:os'

const usage = () => {
  const lines = readFileSync(new URL(import.meta.url), 'utf8').split('\n')
  const from = lines.findIndex((line) => line.startsWith('// Usage:'))
  const to = lines.findIndex((line, index) => index > from && !line.startsWith('//'))
  console.error(lines.slice(from, to).map((line) => line.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Arguments

const options = { mode: 'markdown', projects: [], since: null, until: null, positional: [] }
const argv = process.argv.slice(2)
for (let index = 0; index < argv.length; index++) {
  const arg = argv[index]
  if (arg === '--markdown' || arg === '--json' || arg === '--compare') options.mode = arg.slice(2)
  else if (arg === '--project') options.projects.push(argv[++index])
  else if (arg === '--since') options.since = argv[++index]
  else if (arg === '--until') options.until = argv[++index]
  else if (arg === '--help' || arg === '-h') usage()
  else if (arg.startsWith('--')) {
    console.error(`unknown option: ${arg}`)
    usage()
  } else options.positional.push(arg)
}
if (options.projects.includes(undefined) || options.since === undefined || options.until === undefined) usage()

const dateOption = (name, value, fallback) => {
  const ms = value === null ? fallback : Date.parse(value)
  if (Number.isNaN(ms)) {
    console.error(`${name} needs a date such as 2026-09-01, not ${value}`)
    process.exit(2)
  }
  return ms
}
const sinceMs = dateOption('--since', options.since, -Infinity)
const untilMs = dateOption('--until', options.until, Infinity)

// ---------------------------------------------------------------------------
// Transcript records

// Text of a user or assistant message, with tool results left out. Tool
// results are the tool's output, not something the model or the user wrote.
const textOf = (record) => {
  const content = record.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

const blocksOf = (record) => {
  const content = record.message?.content
  return Array.isArray(content) ? content : []
}

const isToolResult = (record) => blocksOf(record).some((block) => block.type === 'tool_result')

// The text Claude Code injects when a skill is loaded, whether by slash
// command or by the Skill tool.
const SKILL_INJECTION = 'Base directory for this skill:'
const isSkillInjection = (record) => record.type === 'user' && textOf(record).startsWith(SKILL_INJECTION)

// A user record the user actually produced. Claude Code also writes user
// records for injected skill text, local command output, background task
// notifications, meta input, and compaction summaries, none of which are a
// prompt.
const isUserPrompt = (record) => {
  if (record.type !== 'user' || record.isSidechain || isToolResult(record)) return false
  if (record.isMeta || record.isCompactSummary) return false
  const content = record.message?.content
  if (typeof content !== 'string' && !Array.isArray(content)) return false
  const text = textOf(record)
  return !(
    text.startsWith(SKILL_INJECTION) ||
    text.startsWith('<local-command-') ||
    text.startsWith('<task-notification>')
  )
}

// The slash command a user record invokes, or the skill an assistant record
// loads with the Skill tool. The name comes back without its leading slash.
const invokedSkill = (record) => {
  if (record.type === 'user' && !isToolResult(record)) {
    const match = textOf(record).match(/<command-name>\/?([^<]*)<\/command-name>/)
    return match ? match[1] : null
  }
  if (record.type === 'assistant') {
    const call = blocksOf(record).find((block) => block.type === 'tool_use' && block.name === 'Skill')
    return call?.input?.skill || null
  }
  return null
}

// A slash command Claude Code answers itself, such as /model, never reaches
// the model and does not end a run. Its output is the next user record.
const isLocalCommand = (records, index) => {
  const next = records.slice(index + 1, index + 3).find((record) => record.type === 'user')
  return next !== undefined && textOf(next).startsWith('<local-command-')
}

// The index of the typed message an assistant record answers, or -1 when the
// nearest user record before it is not one. A Skill tool call the model makes
// as its first action after a typed message is a top-level invocation. One it
// makes after a tool result or an injected skill is a skill loading another
// skill, as the iterative skill loads the base skill, and stays inside the
// open run.
const triggeringPrompt = (records, index) => {
  for (let i = index - 1; i >= 0; i--) {
    if (records[i].type === 'user') return isUserPrompt(records[i]) ? i : -1
  }
  return -1
}

// A line that is not JSON means a truncated or corrupt transcript. Dropping
// it would understate the report with nothing to show that data was lost.
const parseRecords = (path) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .map((line, index) => {
      if (!line.trim()) return null
      try {
        return JSON.parse(line)
      } catch (error) {
        console.error(`${path}:${index + 1}: not valid JSON: ${error.message}`)
        process.exit(1)
      }
    })
    .filter((record) => record && record.timestamp)

const isMessage = (record) => record.type === 'user' || record.type === 'assistant'

const parseTranscript = (path) => parseRecords(path).filter(isMessage)

// Claude Code writes a `pr-link` record when it learns which pull request the
// session is working on, so the runs can be tied back to their pull requests.
const isPullRequestLink = (record) => record.type === 'pr-link' && record.prNumber

// Subagent transcripts live beside the session file, under
// <dir>/<session>/subagents/, and are attributed to a run by time.
const subagentRecords = (dir, session) => {
  const path = join(dir, session, 'subagents')
  if (!existsSync(path)) return []
  return readdirSync(path)
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) => parseTranscript(join(path, name)))
    .filter((record) => record.type === 'assistant')
}

// ---------------------------------------------------------------------------
// Runs

// Where each run begins, whatever skill it belongs to. Every slash command
// sent to the model is a boundary, matching the pattern or not, so a run ends
// where the user moves on to another command. A run opened by a Skill tool
// call begins at the typed message that triggered it, so that message counts
// as the run's invocation and not as a prompt inside the previous run. Runs
// are filtered by the pattern only after the boundaries are known.
const runStarts = (records) => {
  const starts = []
  records.forEach((record, index) => {
    const skill = invokedSkill(record)
    if (!skill) return
    if (record.type === 'user') {
      if (!isLocalCommand(records, index)) starts.push({ index, skill })
      return
    }
    const prompt = triggeringPrompt(records, index)
    if (prompt !== -1) starts.push({ index: prompt, skill })
  })
  return starts
}

// Usage totals over a set of assistant records, counted once per API
// response. One response spans several transcript lines, one per content
// block, and every line repeats the same usage.
const usageOf = (records, seen) => {
  const totals = { turns: 0, input: 0, cacheCreation: 0, cacheRead: 0, output: 0 }
  for (const record of records) {
    const id = record.message?.id || record.uuid
    if (seen.has(id)) continue
    seen.add(id)
    const usage = record.message?.usage || {}
    totals.turns++
    totals.input += usage.input_tokens || 0
    totals.cacheCreation += usage.cache_creation_input_tokens || 0
    totals.cacheRead += usage.cache_read_input_tokens || 0
    totals.output += usage.output_tokens || 0
  }
  return totals
}

// Tool calls counted once each. A response with several calls spans several
// lines, so the ids rather than the lines are counted.
const toolCallsIn = (records, name = null) => {
  const ids = new Set()
  for (const record of records) {
    blocksOf(record).forEach((block, index) => {
      if (block.type === 'tool_use' && (name === null || block.name === name)) {
        ids.add(block.id || `${record.uuid}:${index}`)
      }
    })
  }
  return ids.size
}

// The pull request a run worked on. Best is a `pr-link` written during the
// run, then the last one written before it, since a session that already
// knew its pull request does not link it again. A session without one falls
// back to the invocation's arguments, such as "for PR 1750". Nothing looser:
// a URL found in the run's text once tied two invocations made on `main`,
// which stopped because there was no pull request, to a release pull
// request the skill had merely listed.
const pullRequestOf = ({ links, window, startMs, endMs }) => {
  const during = links.find((link) => Date.parse(link.timestamp) >= startMs && Date.parse(link.timestamp) < endMs)
  const before = links.filter((link) => Date.parse(link.timestamp) < startMs).pop()
  const link = during || before
  if (link) return { pullRequest: link.prNumber, pullRequestUrl: link.prUrl, pullRequestSource: 'link' }
  const args = textOf(window[0]).match(/<command-args>([^<]*)<\/command-args>/)
  const argument = args && args[1].match(/(?:PR|#)\s*#?(\d+)/i)
  if (argument) return { pullRequest: Number(argument[1]), pullRequestUrl: null, pullRequestSource: 'args' }
  return { pullRequest: null, pullRequestUrl: null, pullRequestSource: null }
}

// Every round of the skill ends by requesting a Copilot review, and the
// iterative skill then waits for it, so a run's rounds are counted two ways
// and the larger is taken. Requests are seen in the commands the run issued,
// in either form the skill uses: `gh pr edit --add-reviewer @copilot` or the
// REST fallback that posts to `requested_reviewers`. A request made from a
// helper script the run wrote is invisible there, so reviews received are
// counted too: the wait ends with a `review submitted` line in a tool
// result, wherever the poll ran.
const REVIEW_REQUEST = /--add-reviewer\s+@copilot\b|requested_reviewers.*copilot-pull-request-reviewer/s
const REVIEW_RECEIVED = /\breview submitted\b/
const reviewRequestsIn = (records) => {
  const ids = new Set()
  for (const record of records) {
    blocksOf(record).forEach((block, index) => {
      if (block.type === 'tool_use' && block.name === 'Bash' && REVIEW_REQUEST.test(block.input?.command || '')) {
        ids.add(block.id || `${record.uuid}:${index}`)
      }
    })
  }
  return ids.size
}
const resultTextOf = (block) =>
  typeof block.content === 'string'
    ? block.content
    : (block.content || []).map((part) => (typeof part.text === 'string' ? part.text : '')).join('\n')
const reviewsReceivedIn = (records) =>
  records.reduce(
    (count, record) =>
      count + blocksOf(record).filter((block) => block.type === 'tool_result' && REVIEW_RECEIVED.test(resultTextOf(block))).length,
    0,
  )

// Threads the run resolved, each counted once by its id. The id is taken
// from a command that resolves, where it is the mutation's argument, and
// from a tool result that reports a thread as resolved, which is where a
// resolution made from a helper script shows up. Neither alone is enough:
// a `--jq` on the mutation can print a bare `true`, and a script hides the
// mutation from the command. Suppressed comments have no thread and are
// not counted.
const RESOLVING = /resolve/i
const RESOLVED = /"isResolved"\s*:\s*true|isResolved=true|resolved=true/
const THREAD_ID = /PRRT_[A-Za-z0-9_-]+/g
const threadsResolvedIn = (records) => {
  const ids = new Set()
  for (const record of records) {
    for (const block of blocksOf(record)) {
      const text =
        block.type === 'tool_use' && block.name === 'Bash' && RESOLVING.test(block.input?.command || '')
          ? block.input.command
          : block.type === 'tool_result' && RESOLVED.test(resultTextOf(block))
            ? resultTextOf(block)
            : ''
      for (const match of text.matchAll(THREAD_ID)) ids.add(match[0])
    }
  }
  return ids.size
}

// Suppressed comments the run saw: the items in the "Suppressed comments"
// sections of the review bodies it fetched, keyed by file, line, and finding
// so a body fetched twice counts once. Whether each was fixed, dropped as
// stale, or pushed back on leaves no trace a script can read, so this is
// what the run looked at, not what it did. A body can arrive as raw text or
// as a JSON string with escaped newlines; both are read.
const SUPPRESSED_SECTION = /Suppressed comments[^\n]*\n([\s\S]*?)(?:<\/details>|$)/gi
const SUPPRESSED_ITEM = /\*\*([^*\n]+)\*\*\s*\n\s*\* ([^\n]*)/g
const suppressedSeenIn = (records) => {
  const keys = new Set()
  for (const record of records) {
    for (const block of blocksOf(record)) {
      if (block.type !== 'tool_result') continue
      const text = resultTextOf(block).replace(/\\n/g, '\n')
      for (const section of text.matchAll(SUPPRESSED_SECTION)) {
        for (const item of section[1].matchAll(SUPPRESSED_ITEM)) keys.add(`${item[1]}|${item[2].slice(0, 80)}`)
      }
    }
  }
  return keys.size
}

// The model that answered most of the run's turns, and the Claude Code
// version that recorded it. A comparison across models measures the model
// as much as the skill.
const mostCommon = (values) => {
  const counts = new Map()
  for (const value of values) if (value) counts.set(value, (counts.get(value) || 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null
}

// A round begins by fetching the feedback: the unresolved review threads or
// the reviews carrying suppressed comments. Everything before the first
// fetch is setup: override checks, branch and pull request lookup, and
// loading the base skill. The rework's preflight script targets setup and
// its other scripts target the rounds, so the two are reported apart.
const FEEDBACK_FETCH = /reviewThreads|\/reviews\b|fetch-feedback/
const firstFetchIndex = (records) =>
  records.findIndex((record) =>
    blocksOf(record).some(
      (block) => block.type === 'tool_use' && block.name === 'Bash' && FEEDBACK_FETCH.test(block.input?.command || ''),
    ),
  )

const measureRun = ({ records, from, to, skill, subagents, session, links }) => {
  const window = records.slice(from, to)
  const startMs = Date.parse(records[from].timestamp)
  const endMs = to < records.length ? Date.parse(records[to].timestamp) : Infinity
  const main = window.filter((record) => record.type === 'assistant' && !record.isSidechain)
  const side = subagents.filter((record) => {
    const ms = Date.parse(record.timestamp)
    return ms >= startMs && ms < endMs
  })

  const mainUsage = usageOf(main, new Set())
  const sideUsage = usageOf(side, new Set())
  const mainInput = mainUsage.input + mainUsage.cacheCreation + mainUsage.cacheRead
  const mainTotal = mainInput + mainUsage.output
  const sideTotal = sideUsage.input + sideUsage.cacheCreation + sideUsage.cacheRead + sideUsage.output
  const sideToolCalls = toolCallsIn(side)
  const rounds = Math.max(reviewRequestsIn(main) + reviewRequestsIn(side), reviewsReceivedIn(window), 1)
  const fetchAt = firstFetchIndex(main)
  const setup = fetchAt === -1 ? main : main.slice(0, fetchAt)
  const setupUsage = usageOf(setup, new Set())
  const roundTurns = mainUsage.turns - setupUsage.turns
  const threadsResolved = threadsResolvedIn(window)

  // Wall time runs to the last main-thread response. A session left open
  // after the run inflates this, and nothing in the transcript says when the
  // user walked away.
  const lastMs = main.length ? Date.parse(main[main.length - 1].timestamp) : startMs

  // The first skill text injected in the run is the invoked skill's own,
  // since the run starts at its invocation.
  const injections = window.filter(isSkillInjection)
  const first = injections[0]

  return {
    skill,
    session,
    ...pullRequestOf({ links, window, startMs, endMs }),
    start: records[from].timestamp,
    turns: mainUsage.turns,
    setupTurns: setupUsage.turns,
    setupToolCalls: toolCallsIn(setup),
    rounds,
    roundTurns,
    turnsPerRound: Math.round((roundTurns / rounds) * 10) / 10,
    threadsResolved,
    suppressedSeen: suppressedSeenIn(window),
    // Null rather than zero when nothing was resolved: a run with nothing to
    // address has no cost per thread, and a zero would drag the median down.
    turnsPerThread: threadsResolved ? Math.round((roundTurns / threadsResolved) * 10) / 10 : null,
    model: mostCommon(main.map((record) => record.message?.model)),
    version: records[from].version || null,
    // Subagent calls count too, so work moved into a subagent does not read
    // as work removed.
    toolCalls: toolCallsIn(main) + sideToolCalls,
    // Times the run waited on the user: a message typed after the invocation,
    // or a question asked through the AskUserQuestion tool, whose answer
    // comes back as a tool result rather than a message.
    userPrompts: window.slice(1).filter(isUserPrompt).length + toolCallsIn(main, 'AskUserQuestion'),
    wallMinutes: Math.round((lastMs - startMs) / 60000),
    inputTokens: mainUsage.input,
    cacheCreationTokens: mainUsage.cacheCreation,
    cacheReadTokens: mainUsage.cacheRead,
    outputTokens: mainUsage.output,
    totalTokens: mainTotal + sideTotal,
    contextPerTurn: mainUsage.turns ? Math.round(mainInput / mainUsage.turns) : 0,
    sidechainTurns: sideUsage.turns,
    sidechainTokens: sideTotal,
    sidechainToolCalls: sideToolCalls,
    skillChars: first ? textOf(first).length : 0,
    injectedChars: injections.reduce((sum, record) => sum + textOf(record).length, 0),
  }
}

// Runs, plus the count of invocations left out because no pull request could
// be tied to them. Those are invocations made on a branch with no pull
// request, where the skill stops at once; the window that follows is
// whatever the session did next, not a run of the skill.
const measureDirectory = (dir, pattern) => {
  const runs = []
  let withoutPullRequest = 0
  for (const name of readdirSync(dir).filter((name) => name.endsWith('.jsonl'))) {
    const session = name.slice(0, -'.jsonl'.length)
    const all = parseRecords(join(dir, name))
    const records = all.filter(isMessage)
    const starts = runStarts(records)
    if (!starts.some(({ skill }) => pattern.test(skill))) continue
    const subagents = subagentRecords(dir, session)
    const links = all.filter(isPullRequestLink).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    starts.forEach(({ index, skill }, position) => {
      if (!pattern.test(skill)) return
      const to = position + 1 < starts.length ? starts[position + 1].index : records.length
      const run = measureRun({ records, from: index, to, skill, subagents, session, links })
      // An invocation with no response is not a run: the user invoked the
      // skill again, or stopped the session, before the model answered.
      if (run.turns === 0) return
      if (run.pullRequest === null) withoutPullRequest++
      else runs.push(run)
    })
  }
  return { runs, withoutPullRequest }
}

// ---------------------------------------------------------------------------
// Statistics and formatting

// Null values are left out, so a per-thread metric is the median over the
// runs that resolved something.
const median = (values) => {
  const sorted = values.filter((value) => value !== null && value !== undefined).sort((a, b) => a - b)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const number = (value) => (value === null ? 'n/a' : value.toLocaleString('en-US', { maximumFractionDigits: 1 }))
const pullRequestCell = (run) =>
  run.pullRequestUrl ? `[${run.pullRequest}](${run.pullRequestUrl})` : String(run.pullRequest)
const day = (iso) => iso.slice(0, 10)

// Metrics reported per skill, in table order. Each names the field of a run
// it is the median of.
const METRICS = [
  ['Turns', 'turns'],
  ['Setup turns', 'setupTurns'],
  ['Rounds', 'rounds'],
  ['Turns per round', 'turnsPerRound'],
  ['Threads resolved', 'threadsResolved'],
  ['Suppressed seen', 'suppressedSeen'],
  ['Turns per thread', 'turnsPerThread'],
  ['Tool calls', 'toolCalls'],
  ['Setup tool calls', 'setupToolCalls'],
  ['User prompts', 'userPrompts'],
  ['Wall minutes', 'wallMinutes'],
  ['Total tokens', 'totalTokens'],
  ['Context per turn', 'contextPerTurn'],
  ['Sidechain turns', 'sidechainTurns'],
  ['Skill chars', 'skillChars'],
  ['Injected chars', 'injectedChars'],
]

const bySkill = (runs) => {
  const groups = new Map()
  for (const run of runs) {
    if (!groups.has(run.skill)) groups.set(run.skill, [])
    groups.get(run.skill).push(run)
  }
  return groups
}

const medians = (runs) => Object.fromEntries(METRICS.map(([, field]) => [field, median(runs.map((run) => run[field]))]))

const table = (header, rows) => [
  `| ${header.join(' | ')} |`,
  `| ${header.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.join(' | ')} |`),
]

const span = (runs) => {
  if (!runs.length) return 'no runs'
  const days = runs.map((run) => day(run.start)).sort()
  return `${runs.length} runs, ${days[0]} to ${days[days.length - 1]}`
}

const leftOut = (count) =>
  count ? ` ${count} ${count === 1 ? 'invocation' : 'invocations'} with no pull request left out.` : ''

const markdownReport = (runs, withoutPullRequest, pattern, directories) => {
  const lines = [`# Skill runs matching \`${pattern.source}\``, '']
  const count = `${directories.length} transcript ${directories.length === 1 ? 'directory' : 'directories'}`
  lines.push(`Generated ${day(new Date().toISOString())} from ${count}.`)
  if (!runs.length) {
    lines.push('', `No runs found.${leftOut(withoutPullRequest)}`)
    return lines.join('\n')
  }
  lines.push(`${span(runs)}.${leftOut(withoutPullRequest)}`, '')
  lines.push(
    '## Terms',
    '',
    '- **Run**: one invocation of a skill, from the invocation to the next slash',
    '  command or top-level skill call, or to the end of the transcript.',
    '- **Turn**: one model response, ending when the model runs a tool or waits',
    '  on the user. Not a review round.',
    '- **Setup**: the turns before the first fetch of review feedback: override',
    '  checks, branch and pull request lookup, loading the base skill.',
    '- **Round**: one pass over the feedback, ending in a Copilot review request,',
    '  counted from the requests the run issued and the reviews it received. A',
    '  run that requested none is one round that stopped early. Turns per round',
    '  divides the turns after setup by the rounds.',
    '- **Threads resolved**: review threads the run resolved, each once.',
    '  Suppressed comments have no thread and are not counted. Turns per thread',
    '  divides the turns after setup by them, over the runs that resolved any.',
    '- **Suppressed seen**: distinct suppressed comments in the review bodies the',
    '  run fetched. What the run did with each leaves no trace, so this is what',
    '  it looked at, and a run that saw many reads worse per thread than it was.',
    '- **Tool calls**: calls the model made, subagent calls included. Setup tool',
    '  calls are those before the first fetch of feedback.',
    '- **User prompts**: times the run waited on the user: a message typed after',
    '  the invocation, or an AskUserQuestion call.',
    '- **Wall minutes**: from the invocation to the last model response of the',
    '  run. A session left open after the run inflates it.',
    '- **Total tokens**: input, cache, and output tokens of every response,',
    '  subagent responses included. Context per turn is the main thread input',
    '  per response.',
    '- **Sidechain turns**: subagent responses that fell inside the run.',
    '- **Skill chars**: the text the invoked skill injected into the context.',
    '  Injected chars adds every skill loaded during the run.',
    '- **PR**: the pull request the session linked during the run, or the one',
    '  named in the invocation. An invocation with neither did no pull request',
    '  work and is left out.',
    '- **Model, Version**: the model that answered most of the turns, and the',
    '  Claude Code version that recorded the run.',
    '',
    '## Medians per skill',
    '',
    ...table(
      ['Skill', 'Runs', ...METRICS.map(([label]) => label)],
      [...bySkill(runs)].map(([skill, group]) => {
        const values = medians(group)
        return [skill, group.length, ...METRICS.map(([, field]) => number(values[field]))]
      }),
    ),
    '',
    '## Runs',
    '',
    ...table(
      ['Start (UTC)', 'Skill', 'PR', 'Model', 'Version', ...METRICS.map(([label]) => label)],
      runs.map((run) => [
        run.start.slice(0, 16),
        run.skill,
        pullRequestCell(run),
        run.model || 'unknown',
        run.version || 'unknown',
        ...METRICS.map(([, field]) => number(run[field])),
      ]),
    ),
  )
  return lines.join('\n')
}

const change = (before, after) => {
  if (before === null || after === null) return 'n/a'
  if (before === after) return '0'
  if (before === 0) return `+${number(after)}`
  const percent = Math.round(((after - before) / before) * 100)
  return `${percent > 0 ? '+' : ''}${percent}%`
}

const comparisonReport = (before, after, files) => {
  const lines = ['# Before and after', '']
  lines.push(`Before: ${span(before.runs)}, from \`${basename(files[0])}\`.`)
  lines.push(`After: ${span(after.runs)}, from \`${basename(files[1])}\`.`)
  const models = (runs) =>
    [...bySkill(runs.map((run) => ({ ...run, skill: run.model || 'unknown' })))]
      .map(([model, group]) => `${model} (${group.length})`)
      .join(', ') || 'none'
  lines.push('', `Models before: ${models(before.runs)}. Models after: ${models(after.runs)}.`)
  lines.push('', 'Each value is the median over the runs of that skill.')
  const beforeGroups = bySkill(before.runs)
  const afterGroups = bySkill(after.runs)
  for (const skill of new Set([...beforeGroups.keys(), ...afterGroups.keys()])) {
    const beforeRuns = beforeGroups.get(skill) || []
    const afterRuns = afterGroups.get(skill) || []
    const beforeValues = medians(beforeRuns)
    const afterValues = medians(afterRuns)
    // A skill with runs on one side only has no median on the other, and no
    // change to report. Zeros would read as a 100% improvement.
    const both = beforeRuns.length > 0 && afterRuns.length > 0
    lines.push('', `## ${skill} (${beforeRuns.length} runs before, ${afterRuns.length} after)`, '')
    lines.push(
      ...table(
        ['Metric', 'Before', 'After', 'Change'],
        METRICS.map(([label, field]) => [
          label,
          beforeRuns.length ? number(beforeValues[field]) : 'n/a',
          afterRuns.length ? number(afterValues[field]) : 'n/a',
          both ? change(beforeValues[field], afterValues[field]) : 'n/a',
        ]),
      ),
    )
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    console.error(`cannot read ${path}: ${error.message}`)
    process.exit(1)
  }
}

if (options.mode === 'compare') {
  if (options.positional.length !== 2) usage()
  const [before, after] = options.positional.map(readJson)
  console.log(comparisonReport(before, after, options.positional))
  process.exit(0)
}

const [patternSource, ...explicit] = options.positional
if (!patternSource) usage()
const pattern = new RegExp(patternSource)

// Overlapping filters, such as `--project ruby --project ruby-git`, or a
// directory given twice, must not measure the same transcripts twice.
const projectsRoot = join(homedir(), '.claude', 'projects')
const candidates = explicit.map((dir) => resolve(dir))
for (const project of options.projects) {
  if (!existsSync(projectsRoot)) break
  for (const name of readdirSync(projectsRoot)) {
    const path = join(projectsRoot, name)
    if (name.includes(project) && statSync(path).isDirectory()) candidates.push(path)
  }
}
const directories = [...new Set(candidates)]
if (!directories.length) {
  console.error('no transcript directories: pass them as arguments or use --project')
  process.exit(1)
}
for (const dir of directories) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`not a directory: ${dir}`)
    process.exit(1)
  }
  console.error(`reading ${dir}`)
}

const measured = directories.map((dir) => measureDirectory(dir, pattern))
const withoutPullRequest = measured.reduce((sum, result) => sum + result.withoutPullRequest, 0)
const runs = measured
  .flatMap((result) => result.runs)
  .filter((run) => Date.parse(run.start) >= sinceMs && Date.parse(run.start) < untilMs)
  .sort((a, b) => a.start.localeCompare(b.start))

if (options.mode === 'json') {
  const data = {
    generated: new Date().toISOString(),
    pattern: pattern.source,
    since: options.since,
    until: options.until,
    projects: options.projects,
    transcriptDirectories: directories.length,
    invocationsWithoutPullRequest: withoutPullRequest,
    runs,
  }
  console.log(JSON.stringify(data, null, 2))
} else {
  console.log(markdownReport(runs, withoutPullRequest, pattern, directories))
}
