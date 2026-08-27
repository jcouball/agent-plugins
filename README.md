# agent-plugins

A Claude Code plugin marketplace holding cross-repo agent skills and commands.

Project-specific skills belong in the project — under `.github/skills/`,
where they travel with the repository and are visible to every agent working
in it, or under `.claude/skills/`, which Claude Code alone reads. This
repository is for the skills that follow me between repositories instead.

What makes these skills different is that every one honors project-local
overrides without being forked. A skill's first step checks the consuming
project for a thin file of the same name — `.claude/skills/<name>/SKILL.md`,
then `.github/skills/<name>/SKILL.md`, then a same-named `SKILL.md` anywhere
else the project keeps agent skills, using the first that exists — holding
only that project's changes and additions, and applies them on top, with the
project file winning where they conflict. A vendored copy of the skill
itself never counts as an override. A project adapts a skill by
dropping in a delta file, never by maintaining a forked full copy.
The `jcouball-marketplace` plugin ships commands for setting that up.

## Install

```text
/plugin marketplace add jcouball/agent-plugins
/plugin install jcouball-writing@jcouball
/plugin install jcouball-github@jcouball
/plugin install jcouball-marketplace@jcouball
```

Run these once per machine. They are Claude Code slash commands. The VS Code
extension has no `/plugin`; it has `/plugins`, which opens the graphical
manager. The same steps also run from a terminal:

```bash
claude plugin marketplace add jcouball/agent-plugins
claude plugin install jcouball-writing@jcouball
claude plugin install jcouball-github@jcouball
claude plugin install jcouball-marketplace@jcouball
```

## Update

```bash
claude plugin marketplace update jcouball
claude plugin update jcouball-writing@jcouball
claude plugin update jcouball-github@jcouball
claude plugin update jcouball-marketplace@jcouball
```

Refresh the marketplace first. Without it, `update` reads a stale cache and
reports the plugin as already current. The plugin name has to carry the
marketplace, `<plugin>@jcouball`, or the command reports the plugin as not
found.

A running session keeps the version it started with until it is told otherwise.
Run `/reload-plugins` to activate the new version in place, or restart Claude
Code.

## Plugins

### jcouball-writing

| Component | Name | What it does |
| --- | --- | --- |
| Skill | `unslop` | Removes AI writing tells from prose. Voice rules are tiered by surface, so PR descriptions get personality and YARD reference docs stay dry. |
| Command | `/eli5` | Explains a concept, file, or error in plain language without paraphrasing the real technical terms. |

### jcouball-github

| Component | Name | What it does |
| --- | --- | --- |
| Skill | `resolve-pr-feedback` | Works through unresolved PR review threads and the Copilot comments GitHub suppresses for low confidence, folds each fix into the commit that last touched the same file, and asks Copilot to look again. |
| Skill | `rebase` | Rebases the current branch onto the default branch, walks through any conflicts, and force-pushes with lease. Every Git command runs without opening an editor. |

### jcouball-marketplace

| Component | Name | What it does |
| --- | --- | --- |
| Command | `/promote-skill` | Moves a full project skill into this marketplace, generalizes it, and leaves a thin project-local override file behind. |
| Command | `/add-overrides` | Creates a project-local override file for a skill that lives in this marketplace, holding only the project's changes and additions. |
| Command | `/add-skill` | Adds a new skill to a plugin here: frontmatter, manifest declaration, trigger-worded description, and the project-overrides contract. |
| Command | `/vendor-skill` | Vendors a third-party skill in two commits — upstream byte for byte, then local modifications — with provenance in NOTICE.md. |
| Command | `/update-vendored-skill` | Ports upstream changes into a vendored skill by hand, diffing the two upstream versions and updating NOTICE.md. |

## Using these outside Claude Code

The `.claude-plugin/` manifests are a thin veneer. The content underneath is a
plain `skills/<name>/SKILL.md` tree, which other agents read directly. GitHub
Copilot discovers skills per repository under `.github/skills/`, so reaching it
means vendoring the directory into the consuming repository rather than
installing this one.

## Attribution

`unslop` is derived from poteto's pstack plugin and used under the MIT
license. See [NOTICE.md](NOTICE.md) for the full attribution and the upstream
commit it was taken from.

## License

MIT. See `LICENSE`.
