# agent-plugins

A Claude Code plugin marketplace holding cross-repo agent skills and commands.

Project-specific skills belong in the project, under `.github/skills/`, where
they travel with the repository and are visible to every agent working in it.
This repository is for the skills that follow me between repositories instead.

## Install

```
/plugin marketplace add jcouball/agent-plugins
/plugin install jcouball-writing@jcouball
/plugin install jcouball-github@jcouball
```

Run these once per machine.

## Plugins

### jcouball-writing

| Component | Name | What it does |
| --- | --- | --- |
| Skill | `unslop` | Removes AI writing tells from prose. Voice rules are tiered by surface, so PR descriptions get personality and YARD reference docs stay dry. |
| Command | `/eli5` | Explains a concept, file, or error in plain language without paraphrasing the real technical terms. |

### jcouball-github

| Component | Name | What it does |
| --- | --- | --- |
| Skill | `resolve-feedback` | Works through unresolved PR review threads and the Copilot comments GitHub suppresses for low confidence, folds each fix into the commit that last touched the same file, and asks Copilot to look again. |
| Skill | `rebase` | Rebases the current branch onto the default branch, walks through any conflicts, and force-pushes with lease. Every Git command runs without opening an editor. |

## Using these outside Claude Code

The `.claude-plugin/` manifests are a thin veneer. The content underneath is a
plain `skills/<name>/SKILL.md` tree, which other agents read directly. GitHub
Copilot discovers skills per repository under `.github/skills/`, so reaching it
means vendoring the directory into the consuming repository rather than
installing this one.

## Attribution

`unslop` is derived from poteto's pstack plugin. `resolve-feedback` and
`rebase` are derived from the skills of the same names in ruby-git. All three
are used under the MIT license. See `NOTICE` for the full attribution and the
upstream commit each was taken from.

## License

MIT. See `LICENSE`.
