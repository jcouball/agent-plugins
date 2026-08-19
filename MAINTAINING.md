# Maintaining this marketplace

How to change what this repository ships. Written for the maintainer and for
any agent working in this repository.

## Layout

```
.claude-plugin/marketplace.json     the marketplace, lists every plugin below
plugins/<plugin>/
  .claude-plugin/plugin.json        the plugin manifest, declares its skills
  skills/<skill>/SKILL.md           one directory per skill
  commands/<command>.md             one file per slash command
bin/release                         version bump, install, and verify in one step
```

The path names the plugin, the `name` field in `plugin.json` keeps it unique
across marketplaces. That is why the directory is `writing` and the name is
`jcouball-writing`.

## Releasing a change

Commit the content first, then release. The install pins a commit sha, so the
commit has to exist before the plugin can point at it.

```bash
git commit -m "feat(unslop): ..."
bin/release writing 1.2.0
```

`bin/release` validates the manifests, bumps the version, commits the bump,
refreshes the marketplace, upgrades the install, and verifies that the
installed version and sha match the new commit. Add `--dry-run` to check the
validation without committing anything.

Restart Claude Code afterward. A running session keeps the version it started
with.

## Adding a skill

1. Create `plugins/<plugin>/skills/<name>/SKILL.md` with `name` and
   `description` frontmatter.
2. Add `"./skills/<name>"` to the `skills` array in the plugin manifest.
   `bin/release` fails if a skill exists on disk but is not declared.
3. Write the description to name its triggers. Claude Code routes on the
   description alone, so a description without trigger words means the skill
   never fires on its own.

## Adding a command

Drop the file in `plugins/<plugin>/commands/<name>.md`. Commands are
discovered by directory and are not declared in the manifest. They report
under Skills in `claude plugin details`, which is a display grouping and not
an error.

## Adding a plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json`.
2. Add an entry to the `plugins` array in the marketplace manifest with
   `"source": "./plugins/<name>"`.
3. Install it: `claude plugin install <plugin-name>@jcouball`.

`claude plugin init` scaffolds a standalone plugin under `~/.claude/skills/`
instead of adding one here. It is not the tool for this repository.

## Removing

```bash
claude plugin uninstall <plugin-name>@jcouball
claude plugin marketplace remove jcouball
```

Old versions stay in `~/.claude/plugins/cache/jcouball/` after an upgrade.
Delete those directories by hand if they accumulate.

## Vendoring a third-party skill

Land it in two commits, always.

1. The upstream file, byte for byte, with no local changes. Record the source
   repository, path, and commit in `NOTICE`.
2. Every local modification, with the reasoning in the commit body.

`git diff <vendor-commit> <modify-commit>` then answers what was changed
locally, and a future upstream bump rebases against a clean base. A prose file
recording the same thing drifts the first time someone edits the skill and
forgets to update it.

Check the upstream license before vendoring, and carry its notice in `NOTICE`.

## Command line gotchas

These cost real time to rediscover.

- `claude plugin update <plugin>` reports the plugin as not found. It needs the
  marketplace-qualified form, `<plugin>@<marketplace>`.
- `claude plugin install` silently succeeds without upgrading when the plugin
  is already installed. Use `update`.
- `claude plugin details` reads the marketplace source, not the installed copy.
  It will happily describe code that is not running. To confirm what is
  actually installed, read `~/.claude/plugins/installed_plugins.json`.
- A marketplace added from a local path is recorded as a directory source and
  resolves only on that machine. Add it by repository name for anything shared.
- `/plugin` is not available in the VS Code extension. Use the `claude plugin`
  command line, or `/plugins` for the graphical manager.
