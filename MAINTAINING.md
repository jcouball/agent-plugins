# Maintaining this marketplace

How to change what this repository ships. Written for the maintainer and for
any agent working in this repository.

## Layout

```
.claude-plugin/marketplace.json     the marketplace, lists every plugin below
.commitlintrc.yml                   the commit message rules
.release-please-config.json         one entry per plugin, versioned independently
.release-please-manifest.json       the current version of every plugin
.husky/                             git hooks, installed by npm install
plugins/<plugin>/
  .claude-plugin/plugin.json        the plugin manifest, declares its skills
  skills/<skill>/SKILL.md           one directory per skill
  commands/<command>.md             one file per slash command
scripts/                            the checks and the local install helper
```

The path names the plugin, the `name` field in `plugin.json` keeps it unique
across marketplaces. That is why the directory is `writing` and the name is
`jcouball-writing`.

## Setup

```bash
npm install
```

Node 20 or newer. This installs commitlint and points git at the hooks in
`.husky`, so it has to run once per clone or the hooks do nothing. There is no
other toolchain. The checks are plain Node scripts with no dependencies.

## Making a change

`main` takes no direct commits. The branch ruleset rejects them on push, and
the pre-commit hook catches them earlier, at the commit.

```bash
git switch -c feat/short-description
# edit
npm run ci
git commit -m "feat(unslop): ..."
git push -u origin HEAD
gh pr create --fill
```

Commit messages are conventional commits, checked by the commit-msg hook and
again in CI. The type is not decoration. `feat` is a minor bump, `fix` is a
patch, and either a `!` after the type or a `BREAKING CHANGE:` footer is a
major. Scope the commit to the plugin, skill, or command it touches.

## Releasing a change

No one edits a version by hand. release-please watches `main` and keeps one
open release pull request per plugin. Merging that pull request bumps the
version in the plugin manifest, writes the plugin `CHANGELOG.md`, tags the
commit, and cuts a GitHub release.

There is nothing to publish. The marketplace serves the default branch
directly, so a release is a tagged commit and nothing more. The tag exists so
release-please knows where the last one ended.

Once the release is merged, install it locally:

```bash
npm run sync              # every plugin
npm run sync -- writing   # one plugin
```

`npm run sync` refreshes the marketplace clone, upgrades the installed
plugins, and checks that the installed version and sha match `origin/main`. It
reads the repository and never writes to it. Because the marketplace clone
pulls from GitHub, only merged work can be installed.

Restart Claude Code afterward. A running session keeps the version it started
with.

### Before the first release

release-please finds the previous release from git tags. With no tags, it
treats the whole history as unreleased and proposes versions built from
commits that already shipped. Tag the current versions once, and it will only
consider what comes after:

```bash
git tag writing-v1.1.0
git tag github-v1.0.0
git push --tags
```

## Running the checks

```bash
npm run ci
```

Three checks, each runnable on its own:

- `npm run lint:manifests` compares the marketplace manifest, the plugin
  manifests, and the skills on disk against each other, and fails when a skill
  is undeclared, a plugin is unlisted, a `SKILL.md` has no description, or
  `plugin.json` and `.release-please-manifest.json` disagree about a version.
- `npm run lint:links` resolves every relative markdown link. External URLs are
  left alone, since the links that rot here are the ones naming files in this
  repository.
- `npm run lint:commits` runs commitlint over the commits not yet on `main`.

CI runs the same checks in two jobs, `Lint and Validate` and
`Verify Conventional Commits`.

## Adding a skill

1. Create `plugins/<plugin>/skills/<name>/SKILL.md` with `name` and
   `description` frontmatter. The `name` has to match the directory.
2. Add `"./skills/<name>"` to the `skills` array in the plugin manifest.
   `npm run lint:manifests` fails if a skill exists on disk but is not
   declared.
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
3. Add the plugin to `.release-please-config.json` and seed its starting
   version in `.release-please-manifest.json`. The manifest check fails while
   either is missing.
4. Install it: `claude plugin install <plugin-name>@jcouball`.

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
- `claude plugin update` compares version numbers, not commits. Content that
  reaches the default branch without a version bump leaves the install pinned
  to the old commit while `update` reports it as already up to date. This is
  why `npm run sync` uninstalls and reinstalls when the sha does not match.
- `claude plugin details` reads the marketplace source, not the installed copy.
  It will happily describe code that is not running. To confirm what is
  actually installed, read `~/.claude/plugins/installed_plugins.json`.
- A marketplace added from a local path is recorded as a directory source and
  resolves only on that machine. Add it by repository name for anything shared.
- `/plugin` is not available in the VS Code extension. Use the `claude plugin`
  command line, or `/plugins` for the graphical manager.
- Never commit in `~/.claude/plugins/marketplaces/jcouball`. It looks like a
  working clone and is not one. A refresh discards whatever is there.
- A pull request opened with `GITHUB_TOKEN` does not start other workflows, so
  release pull requests come back with no CI results. The release workflow uses
  `AUTO_RELEASE_TOKEN`, a personal access token with contents and
  pull-requests write, and falls back to `GITHUB_TOKEN` when that secret is
  missing.
- In `.release-please-config.json`, a relative `extra-files` path resolves
  against the package directory, not the repository root. A leading `/` makes
  it repository-relative.
