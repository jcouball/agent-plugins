# Maintaining this marketplace

How to change what this repository ships. Written for the maintainer and for
any agent working in this repository.

## Layout

```text
.claude-plugin/marketplace.json     the marketplace, lists every plugin below
.commitlintrc.yml                   the commit message rules
.release-please/
  <plugin>-config.json              how release-please releases the plugin
  <plugin>-manifest.json            the plugin's current version
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

No Node version is claimed here, because a claim goes stale the moment a
dependency raises its own floor. Instead `.npmrc` sets `engine-strict`, so an
install under a Node too old for any package fails at once and names the
package that wants more. CI pins its version in `ci.yml`.

The install puts commitlint and markdownlint in place and points git at the
hooks in `.husky`, so it has to run once per clone or the hooks do nothing.
The checks under `scripts/` are plain Node scripts with no dependencies.

The one exception is actionlint, a Go binary. `npm run lint:actions` downloads
the pinned release from GitHub, checks it against a checksum recorded in the
script, runs it, and deletes it. A copy already on `PATH` is used instead when
it reports the pinned version, so an actionlint you installed yourself — from
Homebrew, `go install`, or the release page — skips the download entirely.

Nothing is kept between runs. A cache would have to be keyed by version and
platform both and populated without two runs racing to fill it, and it would
buy nothing here: CI deletes `node_modules` before every job, and a maintainer
with actionlint installed never reads it.

The download covers macOS and Linux on x64 and arm64. Anywhere else — Windows,
or a 32-bit or armv6 Linux — the check names the build it wanted and stops;
install actionlint yourself and put it on `PATH`. Supporting one of those means
adding its checksum, and for Windows a zip to unpack rather than a tarball.

actionlint lints the shell inside `run:` steps by handing it to shellcheck,
but only when shellcheck is on `PATH`. The Ubuntu runners have it, so a
machine without it checks less than CI does; the check says so when it is
missing. Installing shellcheck closes the gap; upstream lists packages for
macOS, Linux, and Windows at
<https://github.com/koalaman/shellcheck#installing>. The same applies to
pyflakes and `shell: python` steps, which no workflow here uses — except that
the pyflakes notice needs a POSIX shell and so never appears on Windows. The
shellcheck notice does.

Bumping the version means editing both the version and the checksums
at the top of `scripts/check-actions.mjs`; the values come from
`actionlint_<version>_checksums.txt` in the release.

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

One commit, one plugin. release-please attributes a commit to a plugin by the
paths it touches, not by its scope, and it honors a breaking marker on every
plugin the commit reaches. A `feat(github)!` that also updates references in
the marketplace commands therefore proposes a major bump for the marketplace
plugin too — which is how marketplace v2.0.0 shipped a changelog describing a
github rename. When a change spans plugin directories, split it into one
commit per plugin so the type and the `!` land only where they apply.

## Releasing a change

No one edits a version by hand. release-please watches `main` and keeps one
open release pull request per plugin. Merging that pull request bumps the
version in the plugin manifest, writes the plugin `CHANGELOG.md`, tags the
commit, and cuts a GitHub release.

Each plugin has its own config and manifest pair under `.release-please/`,
and the release workflow runs release-please once per pair. This is what
keeps the release pull requests independent: they touch disjoint files, so
merging one leaves the others mergeable. With one shared manifest, every
release pull request edited the same five-line file, and merging one left
the rest in conflict — release-please does not rebase a pull request whose
content it considers unchanged, so each conflicted pull request had to be
closed and regenerated.

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

A running session keeps the version it started with until it is told otherwise.
Run `/reload-plugins` to activate the new version in place, or restart Claude
Code.

### How release-please finds the starting point

release-please looks for a tag named `<component>-v<version>`, taking the
version from the plugin's manifest in `.release-please/`, and considers only
the commits that touched the plugin's directory since that tag. With no tag
it reads the whole history, which on a repository that predates
release-please means proposing versions built from commits that already
shipped.

Both plugins were tagged once to give it a floor. This is done and does not
need repeating:

```bash
git tag writing-v1.1.0 e5d49b9
git tag github-v1.0.0 e5d49b9
git push --tags
```

A new plugin needs a tag only if its seeded version should ship as it stands.
Without one, the commits that created the plugin all count toward its next
release, so a `feat` among them bumps the seeded version before it has shipped
at all. Tag the creating commit to release that version unchanged, or leave it
untagged and let the first release pull request bump past it.

## Running the checks

```bash
npm run ci
```

Five checks, each runnable on its own:

- `npm run lint:manifests` compares the marketplace manifest, the plugin
  manifests, and the skills on disk against each other, and fails when a skill
  is undeclared, a plugin is unlisted, a `SKILL.md` has no description, or
  `plugin.json` and the plugin's `.release-please/` manifest disagree about a
  version.
- `npm run lint:links` resolves every relative markdown link. External URLs are
  left alone, since the links that rot here are the ones naming files in this
  repository.
- `npm run lint:actions` runs actionlint over `.github/workflows/`, which
  catches broken expressions, undefined contexts, bad `runs-on` labels, and
  wrong action inputs before a push finds them.
- `npm run lint:markdown` runs markdownlint-cli2 over every markdown file.
  Rule settings live in `.markdownlint.yml`; the globs and ignores live in
  `.markdownlint-cli2.yaml`, which skips the release-please changelogs.
  Command files get their own nested config that drops the first-line-heading
  rule, since they are prompts, not documents.
- `npm run lint:commits` runs commitlint over the commits not yet on `main`.

CI runs the same checks in two jobs, `Lint and Validate` and
`Verify Conventional Commits`.

## Adding a skill

Run `/jcouball-marketplace:add-skill` with the plugin and skill name;
[its command file](plugins/marketplace/commands/add-skill.md) is the
canonical procedure, paste-able by an agent without the plugin installed.
It covers the frontmatter, the manifest declaration that
`npm run lint:manifests` enforces, a trigger-worded description — Claude
Code routes on the description alone — and the project-overrides contract
that every skill here carries. Commands do not carry the contract; it is
for skills only.

The contract is what lets a project adapt a skill by dropping in a thin file
of deltas instead of forking the skill — the plugin holds the one full copy,
the project keeps only its differences. The jcouball-marketplace plugin
ships both directions of that move as commands, run from a Claude Code
session in the project repository: `/jcouball-marketplace:promote-skill`
when the full skill lives in the project and should become the plugin's
canonical copy, and `/jcouball-marketplace:add-overrides` when the skill
already lives here and the project only needs its delta file. The command
files under [plugins/marketplace/commands/](plugins/marketplace/commands/)
are plain markdown prompts, so an agent without the plugin installed can
paste them from the repository instead.

## Adding a command

Drop the file in `plugins/<plugin>/commands/<name>.md`. Commands are
discovered by directory and are not declared in the manifest. They report
under Skills in `claude plugin details`, which is a display grouping and not
an error.

## Adding a plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json`.
2. Add an entry to the `plugins` array in the marketplace manifest with
   `"source": "./plugins/<name>"`.
3. Create `.release-please/<name>-config.json` and seed its starting version
   in `.release-please/<name>-manifest.json`. Copy an existing pair and
   change the plugin name throughout. The manifest check fails while either
   is missing. The release workflow builds its matrix from the directories
   under `plugins/`, so there is no list to update there. Whether that
   seeded version ships as it stands depends on whether you tag it, which
   [How release-please finds the starting point](#how-release-please-finds-the-starting-point)
   explains.
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

Land it in two commits, always: first the upstream file byte for byte, then
every local modification with the reasoning in the commit body.
`/jcouball-marketplace:vendor-skill` walks the procedure, license check
included; [its command file](plugins/marketplace/commands/vendor-skill.md)
is the canonical copy of the steps.

The two commits are the point, not a formality:
`git diff <vendor-commit> <modify-commit>` answers what was changed locally.
A prose file recording the same thing drifts the first time someone edits
the skill and forgets to update it — which is why `NOTICE.md` records only
the source repository, path, upstream commit, and license notice, and
describes the local changes not at all. The git history is the record of
those.

### Updating a vendored skill

The local copy drifts from upstream on purpose — reformatting, dropped
sections, local fixes — so an upstream update is ported by hand, not merged.
`NOTICE.md` records the upstream commit last reviewed.
`/jcouball-marketplace:update-vendored-skill` walks the port: fetch both
upstream versions, diff them so local changes never appear, take the hunks
worth taking, update `NOTICE.md`, and commit as `feat` or `fix` — never
`chore`, which would strand installs on the old commit.
[Its command file](plugins/marketplace/commands/update-vendored-skill.md)
is the canonical copy of the steps.

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
- In a release-please config, a relative `extra-files` path resolves
  against the package directory, not the repository root. A leading `/` makes
  it repository-relative.
