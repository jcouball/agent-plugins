# Skill runs matching `address-pr-feedback`

Generated 2026-09-07 from 7 transcript directories.
35 runs, 2026-08-30 to 2026-09-06. 2 invocations with no pull request left out.

## Terms

- **Run**: one invocation of a skill, from the invocation to the next slash
  command or top-level skill call, or to the end of the transcript.
- **Turn**: one model response, ending when the model runs a tool or waits
  on the user. Not a review round.
- **Setup**: the turns before the first fetch of review feedback: override
  checks, branch and pull request lookup, loading the base skill.
- **Round**: one pass over the feedback, ending in a Copilot review request,
  counted from the requests the run issued and the reviews it received. A
  run that requested none is one round that stopped early. Turns per round
  divides the turns after setup by the rounds.
- **Threads resolved**: review threads the run resolved, each once.
  Suppressed comments have no thread and are not counted. Turns per thread
  divides the turns after setup by them, over the runs that resolved any.
- **Suppressed seen**: distinct suppressed comments in the review bodies the
  run fetched. What the run did with each leaves no trace, so this is what
  it looked at, and a run that saw many reads worse per thread than it was.
- **Tool calls**: calls the model made, subagent calls included. Setup tool
  calls are those before the first fetch of feedback.
- **User prompts**: times the run waited on the user: a message typed after
  the invocation, or an AskUserQuestion call.
- **Wall minutes**: from the invocation to the last model response of the
  run. A session left open after the run inflates it.
- **Total tokens**: input, cache, and output tokens of every response,
  subagent responses included. Context per turn is the main thread input
  per response.
- **Sidechain turns**: subagent responses that fell inside the run.
- **Skill chars**: the text the invoked skill injected into the context.
  Injected chars adds every skill loaded during the run.
- **PR**: the pull request the session linked during the run, or the one
  named in the invocation. An invocation with neither did no pull request
  work and is left out.
- **Model, Version**: the model that answered most of the turns, and the
  Claude Code version that recorded the run.

## Medians per skill

| Skill | Runs | Turns | Setup turns | Rounds | Turns per round | Threads resolved | Suppressed seen | Turns per thread | Tool calls | Setup tool calls | User prompts | Wall minutes | Total tokens | Context per turn | Sidechain turns | Skill chars | Injected chars |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jcouball-github:address-pr-feedback | 6 | 14 | 1 | 1 | 12 | 1 | 0.5 | 7 | 14 | 0.5 | 0.5 | 5.5 | 2,482,033 | 223,511.5 | 0 | 23,728 | 23,728 |
| jcouball-github:address-pr-feedback-iteratively | 29 | 32 | 3 | 2 | 13 | 3 | 1 | 9 | 49 | 4 | 1 | 35 | 3,604,995 | 117,631 | 0 | 15,191 | 38,919 |

## Runs

| Start (UTC) | Skill | PR | Model | Version | Turns | Setup turns | Rounds | Turns per round | Threads resolved | Suppressed seen | Turns per thread | Tool calls | Setup tool calls | User prompts | Wall minutes | Total tokens | Context per turn | Sidechain turns | Skill chars | Injected chars |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-30T21:04 | jcouball-github:address-pr-feedback | [1743](https://github.com/ruby-git/ruby-git/pull/1743) | claude-fable-5 | 2.1.251 | 18 | 4 | 1 | 14 | 1 | 0 | 14 | 19 | 3 | 1 | 6 | 1,200,237 | 66,202 | 0 | 23,752 | 23,752 |
| 2026-09-01T00:40 | jcouball-github:address-pr-feedback | [1744](https://github.com/ruby-git/ruby-git/pull/1744) | claude-fable-5 | 2.1.251 | 17 | 3 | 1 | 14 | 2 | 0 | 7 | 16 | 3 | 0 | 5 | 2,947,636 | 172,883 | 0 | 23,728 | 23,728 |
| 2026-09-01T00:53 | jcouball-github:address-pr-feedback | [1744](https://github.com/ruby-git/ruby-git/pull/1744) | claude-fable-5 | 2.1.251 | 50 | 1 | 1 | 49 | 3 | 1 | 16.3 | 44 | 1 | 10 | 31 | 10,726,685 | 213,887 | 0 | 23,728 | 23,728 |
| 2026-09-01T01:24 | jcouball-github:address-pr-feedback | [1744](https://github.com/ruby-git/ruby-git/pull/1744) | claude-fable-5 | 2.1.251 | 8 | 1 | 1 | 7 | 1 | 1 | 7 | 9 | 0 | 0 | 3 | 2,016,430 | 251,596 | 0 | 23,728 | 23,728 |
| 2026-09-02T00:28 | jcouball-github:address-pr-feedback-iteratively | [1744](https://github.com/ruby-git/ruby-git/pull/1744) | claude-fable-5 | 2.1.251 | 15 | 2 | 1 | 13 | 1 | 0 | 13 | 12 | 1 | 1 | 933 | 3,967,961 | 264,062 | 0 | 15,191 | 15,191 |
| 2026-09-02T19:23 | jcouball-github:address-pr-feedback-iteratively | [1747](https://github.com/ruby-git/ruby-git/pull/1747) | claude-fable-5-1 | 2.1.258 | 58 | 3 | 5 | 11 | 8 | 2 | 6.9 | 68 | 2 | 5 | 78 | 15,877,883 | 273,016 | 0 | 15,191 | 38,919 |
| 2026-09-02T20:43 | jcouball-github:address-pr-feedback | [1747](https://github.com/ruby-git/ruby-git/pull/1747) | claude-fable-5-1 | 2.1.258 | 11 | 1 | 1 | 10 | 0 | 1 | n/a | 12 | 0 | 2 | 12 | 3,511,102 | 318,400 | 0 | 23,728 | 23,728 |
| 2026-09-02T21:27 | jcouball-github:address-pr-feedback-iteratively | [1748](https://github.com/ruby-git/ruby-git/pull/1748) | claude-fable-5-1 | 2.1.258 | 93 | 2 | 6 | 15.2 | 13 | 2 | 7 | 137 | 3 | 15 | 112 | 26,241,165 | 281,054 | 0 | 15,191 | 38,919 |
| 2026-09-03T14:13 | jcouball-github:address-pr-feedback-iteratively | [1749](https://github.com/ruby-git/ruby-git/pull/1749) | claude-fable-5-1 | 2.1.258 | 31 | 6 | 4 | 6.3 | 4 | 2 | 6.3 | 30 | 5 | 2 | 38 | 2,480,875 | 79,166 | 0 | 15,215 | 38,943 |
| 2026-09-03T14:15 | jcouball-github:address-pr-feedback-iteratively | 1750 | claude-fable-5-1 | 2.1.258 | 6 | 4 | 1 | 2 | 0 | 0 | n/a | 8 | 4 | 0 | 1 | 318,975 | 52,411 | 0 | 15,215 | 38,943 |
| 2026-09-03T14:54 | jcouball-github:address-pr-feedback-iteratively | [1750](https://github.com/ruby-git/ruby-git/pull/1750) | claude-fable-5-1 | 2.1.258 | 73 | 5 | 5 | 13.6 | 12 | 1 | 5.7 | 72 | 4 | 4 | 75 | 8,774,640 | 119,216 | 0 | 15,215 | 38,943 |
| 2026-09-03T16:57 | jcouball-github:address-pr-feedback-iteratively | [1751](https://github.com/ruby-git/ruby-git/pull/1751) | claude-fable-5-1 | 2.1.259 | 34 | 4 | 2 | 15 | 6 | 2 | 5 | 43 | 4 | 1 | 28 | 3,392,938 | 98,729 | 0 | 15,191 | 38,919 |
| 2026-09-03T17:30 | jcouball-github:address-pr-feedback-iteratively | [1752](https://github.com/ruby-git/ruby-git/pull/1752) | claude-fable-5-1 | 2.1.259 | 31 | 4 | 1 | 27 | 2 | 0 | 13.5 | 47 | 4 | 3 | 35 | 3,416,077 | 108,877 | 0 | 15,215 | 38,943 |
| 2026-09-03T17:57 | jcouball-github:address-pr-feedback-iteratively | [1753](https://github.com/ruby-git/ruby-git/pull/1753) | claude-fable-5-1 | 2.1.259 | 39 | 3 | 3 | 12 | 7 | 24 | 5.1 | 53 | 3 | 2 | 48 | 10,580,635 | 269,818 | 0 | 15,191 | 38,919 |
| 2026-09-03T22:31 | jcouball-github:address-pr-feedback-iteratively | [1754](https://github.com/ruby-git/ruby-git/pull/1754) | claude-fable-5-1 | 2.1.259 | 21 | 4 | 1 | 17 | 4 | 0 | 4.3 | 19 | 3 | 1 | 13 | 4,082,025 | 193,667 | 0 | 15,191 | 38,919 |
| 2026-09-03T23:53 | jcouball-github:address-pr-feedback-iteratively | [1755](https://github.com/ruby-git/ruby-git/pull/1755) | claude-fable-5-1 | 2.1.259 | 23 | 4 | 2 | 9.5 | 2 | 0 | 9.5 | 24 | 3 | 2 | 21 | 1,486,955 | 64,065 | 0 | 15,191 | 38,919 |
| 2026-09-04T05:13 | jcouball-github:address-pr-feedback-iteratively | [1759](https://github.com/ruby-git/ruby-git/pull/1759) | claude-fable-5-1 | 2.1.259 | 88 | 3 | 10 | 8.5 | 10 | 30 | 8.5 | 137 | 3 | 4 | 701 | 18,112,652 | 204,524 | 0 | 15,215 | 38,943 |
| 2026-09-04T05:13 | jcouball-github:address-pr-feedback-iteratively | [1760](https://github.com/ruby-git/ruby-git/pull/1760) | claude-fable-5-1 | 2.1.259 | 38 | 3 | 3 | 11.7 | 5 | 6 | 7 | 69 | 5 | 1 | 593 | 3,146,984 | 82,160 | 0 | 15,215 | 15,215 |
| 2026-09-04T05:14 | jcouball-github:address-pr-feedback-iteratively | [1757](https://github.com/ruby-git/ruby-git/pull/1757) | claude-fable-5-1 | 2.1.259 | 59 | 3 | 5 | 11.2 | 12 | 4 | 4.7 | 108 | 5 | 3 | 714 | 7,412,000 | 124,542 | 0 | 15,215 | 38,943 |
| 2026-09-04T05:14 | jcouball-github:address-pr-feedback-iteratively | [1758](https://github.com/ruby-git/ruby-git/pull/1758) | claude-fable-5-1 | 2.1.259 | 56 | 7 | 3 | 16.3 | 13 | 1 | 3.8 | 68 | 6 | 0 | 39 | 6,815,727 | 120,878 | 0 | 15,208 | 15,208 |
| 2026-09-04T19:12 | jcouball-github:address-pr-feedback-iteratively | [1779](https://github.com/ruby-git/ruby-git/pull/1779) | claude-fable-5-1 | 2.1.259 | 21 | 3 | 1 | 18 | 0 | 0 | n/a | 34 | 4 | 1 | 4 | 2,777,480 | 131,756 | 0 | 15,191 | 38,919 |
| 2026-09-04T19:16 | jcouball-github:address-pr-feedback-iteratively | [1781](https://github.com/ruby-git/ruby-git/pull/1781) | claude-fable-5-1 | 2.1.259 | 31 | 1 | 2 | 15 | 3 | 2 | 10 | 49 | 2 | 0 | 14 | 3,900,669 | 125,116 | 0 | 15,191 | 15,191 |
| 2026-09-04T19:16 | jcouball-github:address-pr-feedback-iteratively | [1782](https://github.com/ruby-git/ruby-git/pull/1782) | claude-fable-5-1 | 2.1.259 | 27 | 2 | 1 | 25 | 1 | 1 | 25 | 49 | 4 | 1 | 10 | 2,912,239 | 107,273 | 0 | 15,191 | 15,191 |
| 2026-09-04T19:17 | jcouball-github:address-pr-feedback-iteratively | [1783](https://github.com/ruby-git/ruby-git/pull/1783) | claude-fable-5-1 | 2.1.259 | 38 | 2 | 2 | 18 | 1 | 2 | 36 | 64 | 4 | 1 | 24 | 4,490,798 | 117,631 | 0 | 15,191 | 15,191 |
| 2026-09-04T19:17 | jcouball-github:address-pr-feedback-iteratively | [1784](https://github.com/ruby-git/ruby-git/pull/1784) | claude-fable-5-1 | 2.1.259 | 30 | 5 | 1 | 25 | 1 | 0 | 25 | 40 | 6 | 4 | 15 | 3,135,906 | 104,086 | 0 | 15,191 | 38,919 |
| 2026-09-04T20:25 | jcouball-github:address-pr-feedback-iteratively | [1785](https://github.com/ruby-git/ruby-git/pull/1785) | claude-fable-5-1 | 2.1.259 | 32 | 3 | 2 | 14.5 | 1 | 0 | 29 | 35 | 3 | 5 | 17 | 4,478,005 | 139,340 | 0 | 15,191 | 38,919 |
| 2026-09-04T23:12 | jcouball-github:address-pr-feedback-iteratively | [1785](https://github.com/ruby-git/ruby-git/pull/1785) | claude-fable-5-1 | 2.1.260 | 41 | 3 | 5 | 7.6 | 3 | 10 | 12.7 | 52 | 5 | 0 | 42 | 3,604,995 | 87,099 | 0 | 15,215 | 15,215 |
| 2026-09-04T23:13 | jcouball-github:address-pr-feedback-iteratively | [1790](https://github.com/ruby-git/ruby-git/pull/1790) | claude-fable-5-1 | 2.1.260 | 38 | 3 | 4 | 8.8 | 7 | 1 | 5 | 64 | 4 | 0 | 35 | 3,408,018 | 88,739 | 0 | 15,215 | 38,943 |
| 2026-09-04T23:56 | jcouball-github:address-pr-feedback-iteratively | [1785](https://github.com/ruby-git/ruby-git/pull/1785) | claude-fable-5-1 | 2.1.260 | 50 | 1 | 5 | 9.8 | 2 | 0 | 24.5 | 62 | 0 | 9 | 66 | 8,841,103 | 175,535 | 0 | 15,226 | 15,226 |
| 2026-09-05T01:12 | jcouball-github:address-pr-feedback | [1792](https://github.com/ruby-git/ruby-git/pull/1792) | claude-fable-5-1 | 2.1.260 | 4 | 1 | 1 | 3 | 1 | 0 | 3 | 4 | 0 | 0 | 3 | 936,383 | 233,136 | 0 | 23,752 | 23,752 |
| 2026-09-06T16:10 | jcouball-github:address-pr-feedback-iteratively | [1793](https://github.com/ruby-git/ruby-git/pull/1793) | claude-fable-5-1 | 2.1.260 | 28 | 4 | 1 | 24 | 2 | 1 | 12 | 49 | 6 | 1 | 22 | 2,034,171 | 72,114 | 0 | 15,215 | 15,215 |
| 2026-09-06T17:10 | jcouball-github:address-pr-feedback-iteratively | [1794](https://github.com/ruby-git/ruby-git/pull/1794) | claude-fable-5-1 | 2.1.260 | 15 | 4 | 1 | 11 | 1 | 0 | 11 | 21 | 4 | 0 | 6 | 1,699,841 | 112,851 | 0 | 15,191 | 38,919 |
| 2026-09-06T20:21 | jcouball-github:address-pr-feedback-iteratively | [1795](https://github.com/ruby-git/ruby-git/pull/1795) | claude-fable-5-1 | 2.1.263 | 16 | 3 | 1 | 13 | 2 | 1 | 6.5 | 30 | 5 | 0 | 8 | 1,102,401 | 68,140 | 0 | 15,215 | 15,215 |
| 2026-09-06T21:13 | jcouball-github:address-pr-feedback-iteratively | [1798](https://github.com/ruby-git/ruby-git/pull/1798) | claude-fable-5-1 | 2.1.263 | 16 | 2 | 2 | 7 | 1 | 1 | 14 | 23 | 3 | 0 | 7 | 2,527,758 | 157,522 | 0 | 15,191 | 15,191 |
| 2026-09-06T23:04 | jcouball-github:address-pr-feedback-iteratively | [1802](https://github.com/ruby-git/ruby-git/pull/1802) | claude-fable-5-1 | 2.1.263 | 49 | 4 | 1 | 45 | 5 | 2 | 9 | 51 | 4 | 2 | 38 | 4,271,327 | 86,576 | 0 | 15,191 | 15,191 |
