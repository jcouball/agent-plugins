// A fixture marketplace for the tests of sync-plugins: a repository named
// `fixture` with plugins alpha and beta, pushed to a local bare origin, and a
// home directory that holds the install record. Nothing touches the network or
// an installed plugin.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { devNull, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// The environment git runs in on a fixture, apart from the developer's user and
// system configuration: a signing key, a hooks directory, a URL rewrite, or a
// ban on local fetches there would change or break every fixture. `extra`
// overrides variables, such as the HOME a run sees.
export const isolatedEnv = (extra = {}) => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  ...extra,
})

export const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    env: isolatedEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

export const json = (value) => `${JSON.stringify(value, null, 2)}\n`

// The files of a plugin that passes the manifest check.
const pluginFiles = (directory, version = '1.0.0') => ({
  [`plugins/${directory}/.claude-plugin/plugin.json`]: json({
    name: `jcouball-${directory}`,
    version,
    description: `The ${directory} plugin`,
  }),
  [`.release-please/${directory}-config.json`]: json({ packages: { [`plugins/${directory}`]: {} } }),
  [`.release-please/${directory}-manifest.json`]: json({ [`plugins/${directory}`]: version }),
})

// A repository named `fixture` with plugins alpha and beta, pushed to a local
// bare origin. `unpushed` names a plugin whose manifest stays out of the
// commit, so origin/main has no manifest for it. `files` overrides or adds
// files before the commit.
export const fixture = ({ unpushed, files = {} } = {}) => {
  const base = mkdtempSync(join(tmpdir(), 'sync-plugins-'))
  const root = join(base, 'repository')
  const home = join(base, 'home')
  mkdirSync(join(home, '.claude/plugins'), { recursive: true })
  const all = {
    '.claude-plugin/marketplace.json': json({
      name: 'fixture',
      plugins: ['alpha', 'beta'].map((directory) => ({
        name: `jcouball-${directory}`,
        source: `./plugins/${directory}`,
        description: `The ${directory} plugin`,
      })),
    }),
    ...pluginFiles('alpha'),
    ...pluginFiles('beta'),
    ...files,
  }
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  git(base, 'init', '--quiet', '--bare', '--initial-branch=main', 'origin.git')
  git(root, 'init', '--quiet', '--initial-branch=main')
  git(root, 'remote', 'add', 'origin', join(base, 'origin.git'))
  const skipped = unpushed ? [`:!plugins/${unpushed}/.claude-plugin/plugin.json`] : []
  git(root, 'add', '--all', '--', '.', ...skipped)
  git(root, 'commit', '--quiet', '--message', 'fixture')
  git(root, 'push', '--quiet', 'origin', 'main')
  git(root, 'fetch', '--quiet', 'origin')
  const head = git(root, 'rev-parse', 'origin/main')
  return { base, root, home, head }
}

export const install = (version, gitCommitSha) => [{ version, gitCommitSha, installPath: '/installed/path' }]
export const record = (plugins) => json({ plugins })
export const recordFile = (home) => join(home, '.claude/plugins/installed_plugins.json')

export const both = (version, sha) =>
  record({ 'jcouball-alpha@fixture': install(version, sha), 'jcouball-beta@fixture': install(version, sha) })
