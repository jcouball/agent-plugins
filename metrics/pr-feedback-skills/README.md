# PR feedback skills

Measurements of the `address-pr-feedback` and
`address-pr-feedback-iteratively` skills before and after the rework tracked
in [issue 32](https://github.com/jcouball/agent-plugins/issues/32). The
reports come from [measure-runs.mjs](measure-runs.mjs), which reads Claude
Code transcripts under `~/.claude/projects/`. Those transcripts exist only on
the machine where the sessions ran, so the files here are the durable record.
The script lives here rather than under `metrics/` because rounds, setup,
and threads resolved are how these two skills work and mean nothing for
another skill. Each report opens with a Terms section defining every column.

Every run measured here comes from ruby-git, so before and after compare the
same project. The regex `address-pr-feedback` matches both skills and leaves
out the runs under the old `resolve-feedback` name, which did less work per
run and would skew the baseline.

## Files

- `before.md` and `before.json`: every run of the released skills from their
  first use on 2026-08-30 through 2026-09-06, generated on 2026-09-07. The
  report is script output and is overwritten when regenerated; the goals
  below live here for that reason.
- `after.md`, `after.json`, `comparison.md`, and `report.md`: added by the last
  pull request of the rework, once enough runs on the released skills exist.

## Regenerating

From the repository root:

```bash
node metrics/pr-feedback-skills/measure-runs.mjs --project ruby-git --markdown --until 2026-09-07 'address-pr-feedback' \
  > metrics/pr-feedback-skills/before.md
node metrics/pr-feedback-skills/measure-runs.mjs --project ruby-git --json --until 2026-09-07 'address-pr-feedback' \
  > metrics/pr-feedback-skills/before.json
```

The before report needs no `--since`: the renamed skills first ran on
2026-08-29. It does need the `--until` cutoff, which keeps the runs that
started before 2026-09-07 and so reproduces the same baseline once later
runs exist. The after report needs `--since` set to the day the release
with the rework was installed with `npm run sync`, since runs use the
installed version, not the merged one:

```bash
SINCE=YYYY-MM-DD   # the day the reworked release was installed
node metrics/pr-feedback-skills/measure-runs.mjs --project ruby-git --markdown --since "$SINCE" 'address-pr-feedback' \
  > metrics/pr-feedback-skills/after.md
node metrics/pr-feedback-skills/measure-runs.mjs --project ruby-git --json --since "$SINCE" 'address-pr-feedback' \
  > metrics/pr-feedback-skills/after.json
node metrics/pr-feedback-skills/measure-runs.mjs --compare metrics/pr-feedback-skills/before.json \
  metrics/pr-feedback-skills/after.json > metrics/pr-feedback-skills/comparison.md
```

## Goals

The after report is judged against these targets. The "now" columns are the
medians from `before.md`.

| Metric (median) | Base skill now | Iterative now | Goal |
| --------------- | -------------- | ------------- | ---- |
| Tool calls per run | 14 | 49 | at most half |
| Turns per run | 14 | 32 | at most half |
| Setup tool calls | 0.5 | 4 | at most 1 and 2 |
| Turns per round | 12 | 13 | at most half |
| Turns per thread | 7 | 9 | at most half |
| User prompts per run | 0.5 | 1 | at most 1 |
| Wall minutes per run | 5.5 | 35 | at most 3 and 18 |
| Total tokens per run | 2.5M | 3.6M | at most half |
| Context per turn | 224k | 118k | down at least 25% |
| Skill chars | 23.7k | 15.2k | under 10k and 7k |
| Injected chars per run | 23.7k | 38.9k | under 10k and 17k |
| Sidechain turns per run | 0 | 0 | above 0 |

Half is the bar for tool calls, turns, and tokens because the rework replaces
sequences of five to twelve commands with one script in three places and
removes a fetch, a per-round skill injection, and a per-round confirmation.
Rounds themselves are not a target: how many a run needs depends on what
Copilot finds. Turns per round is, since that is the cost the scripts and
batching remove; an iterative round costs about as much as a base-skill run
today. Setup, everything before the first fetch of feedback, is what the
preflight script replaces: one call for the base skill, and for the
iterative skill that call plus loading the base skill. Turns per thread is
the headline number, since it survives differences in how much feedback
the runs on each side happened to get.
Tool calls include the calls subagents make, so work moved into a subagent
does not read as work removed. Wall time gets the same bar for the base
skill, which never waits on anything but the user. The iterative skill gets a
smaller one because two to seven minutes of every round is Copilot's review,
which nothing here shortens.

User prompts get a bar of one because the rework asks every triage question
in one prompt and, in the iterative skill, asks once per invocation whether
the force-push is approved. Issue 32 proposed one and two, against counts
that included the injected skill text as a prompt. Counted correctly, both
medians already sit at one or below, so the target is to hold them there
while the questions are batched and the rounds run unattended.

Skill chars is the text of the invoked skill as injected into the context.
Injected chars adds every skill loaded during the run; the iterative skill
loads the base skill, so its target is the sum of the two skill targets.

Sidechain turns are subagent responses. None of the runs measured so far used
a subagent, so any positive median shows that delegation is happening.

## Reading the numbers

- The Terms section of each report defines the columns. In short: a turn is
  one model response, not a review round; a round ends in a review request;
  setup is everything before the first fetch of feedback.
- Compare runs on the same model. The comparison report lists the models on
  each side; a newer model that batches tool calls differently would show as
  skill improvement otherwise.
- Medians, not means: single runs vary with the difficulty of the pull
  request, so compare medians over as many runs as the before report has,
  6 for the base skill and 29 for the iterative, and never one run against
  another. A median over an even number of runs can end in .5.
- Suppressed comments are counted as seen, not as addressed, because
  handling one leaves no trace a script can read. Turns per thread divides
  by resolved threads alone, so a run that saw many suppressed comments
  reads worse per thread than it was; the column beside it shows when that
  is the case. Verified on ruby-git: the runs on PRs 1753 and 1759 saw 24
  and 30, matching the sections in those pull requests' Copilot reviews.
- The before report leaves out two invocations with no pull request, both
  made on `main` on 2026-08-29, where the skill stopped at Step 1. Several
  runs share a pull request because the skill was invoked on it more than
  once.
- Rounds and threads resolved are read from the commands the run issued and
  their output. The scripts the rework adds have to keep printing
  `review submitted` from the poll and the resolved thread ids from the
  resolve step, or the after report undercounts both.
- A run ends at the next slash command or top-level skill call, so work the
  user asked for afterwards in the same session, such as a rebase, is not
  counted against the skill.
- Total tokens are about 97% cache reads, so the token metric is close to
  turns times context size. Cutting turns and keeping fetched output out of
  the main context matter more than cutting prose.
- Wall minutes run from the invocation to the last main-thread response, so a
  session left open after the run inflates them. The outliers above 700
  minutes in `before.md` are that.
- A user prompt is a message typed after the invocation or a question asked
  through the AskUserQuestion tool. The invocation itself is not counted.
