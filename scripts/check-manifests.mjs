#!/usr/bin/env node
//
// Validate the marketplace manifest, the plugin manifests, and the skills on
// disk against each other.
//
// The three can drift independently: a skill can exist without being declared,
// a plugin can be declared without being listed in the marketplace, and a
// version can be bumped in one file but not the other. Nothing else catches
// any of that, because none of it is code that runs.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []
const fail = (message) => errors.push(message)

const readJson = (relative) => {
  const path = join(root, relative)
  if (!existsSync(path)) {
    fail(`missing file: ${relative}`)
    return null
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(`${relative} is not valid JSON: ${error.message}`)
    return null
  }
}

const directoriesIn = (relative) => {
  const path = join(root, relative)
  if (!existsSync(path)) return []
  return readdirSync(path).filter((name) => statSync(join(path, name)).isDirectory())
}

// Parses just enough YAML for skill frontmatter: top-level `key: value` pairs
// between the opening and closing `---`. A real YAML parser would be a
// dependency for four lines of input.
const frontmatter = (relative) => {
  // Split on either ending. A CRLF file leaves a trailing \r on every line,
  // and JS regex '.' does not match \r, so the field pattern below would fail
  // on all of them.
  const lines = readFileSync(join(root, relative), 'utf8').split(/\r?\n/)
  if (lines[0].trim() !== '---') return null
  // Trim before comparing. A file written with CRLF endings closes its
  // frontmatter with "---\r", which an exact match would miss, reporting a
  // perfectly good skill as having no frontmatter at all.
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end === -1) return null
  const fields = {}
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([A-Za-z_-]+):\s*(.*)$/)
    if (match) fields[match[1]] = match[2].trim()
  }
  return fields
}

const marketplace = readJson('.claude-plugin/marketplace.json')
const pluginDirectories = directoriesIn('plugins')

if (pluginDirectories.length === 0) fail('no plugins found under plugins/')

const listed = new Map()
// A manifest whose plugins key is not an array is a manifest problem, and
// should read as one rather than as a crash inside .entries().
if (marketplace && !Array.isArray(marketplace.plugins)) {
  fail('.claude-plugin/marketplace.json has a plugins key that is not an array')
}

const entries = Array.isArray(marketplace?.plugins) ? marketplace.plugins : []

for (const [index, entry] of entries.entries()) {
  // sync-plugins.mjs calls entry.source.replace() on every entry. Letting a
  // malformed one through here trades this message for a TypeError there.
  if (typeof entry.name !== 'string') {
    fail(`marketplace plugin at index ${index} has no name, or its name is not a string`)
    continue
  }
  if (typeof entry.source !== 'string') {
    fail(`marketplace lists ${entry.name} with a source that is not a string`)
    continue
  }

  // A Map would quietly keep the last entry and drop the first, leaving a
  // manifest that names one plugin twice looking perfectly valid.
  if (listed.has(entry.name)) {
    fail(`marketplace lists ${entry.name} more than once`)
    continue
  }

  listed.set(entry.name, entry)
  if (!existsSync(join(root, entry.source))) {
    fail(`marketplace lists ${entry.name} with a source that does not exist: ${entry.source}`)
  }
}

const claimed = new Set()

for (const plugin of pluginDirectories) {
  const manifestPath = `plugins/${plugin}/.claude-plugin/plugin.json`
  const manifest = readJson(manifestPath)
  if (!manifest) continue

  if (!manifest.name) {
    fail(`${manifestPath} has no name`)
    continue
  }
  if (!manifest.version) fail(`${manifestPath} has no version`)

  const entry = listed.get(manifest.name)
  if (!entry) {
    fail(`${manifest.name} is not listed in the marketplace manifest`)
  } else {
    claimed.add(manifest.name)
    if (entry.source !== `./plugins/${plugin}`) {
      fail(`marketplace source for ${manifest.name} is ${entry.source}, expected ./plugins/${plugin}`)
    }
  }

  // Each plugin has its own release-please config and manifest pair, so the
  // release pull requests share no files and merging one cannot conflict
  // with another. The pair has to exist, the config has to describe this
  // plugin's directory and no other — a second package entry would put two
  // plugins back in one release PR — and the tracked version has to agree
  // with plugin.json: release-please owns the version, so a disagreement
  // means the release PR updated one file and not the other.
  const releaseConfig = readJson(`.release-please/${plugin}-config.json`)
  if (releaseConfig) {
    const packages = Object.keys(releaseConfig.packages ?? {})
    if (!packages.includes(`plugins/${plugin}`)) {
      fail(`.release-please/${plugin}-config.json does not declare plugins/${plugin} under packages`)
    }
    const extras = packages.filter((path) => path !== `plugins/${plugin}`)
    if (extras.length > 0) {
      fail(
        `.release-please/${plugin}-config.json declares packages beyond ` +
          `plugins/${plugin}: ${extras.join(', ')}`
      )
    }
  }

  const releaseManifestPath = `.release-please/${plugin}-manifest.json`
  const versions = readJson(releaseManifestPath)
  if (versions) {
    const tracked = versions[`plugins/${plugin}`]
    if (tracked === undefined) {
      fail(`plugins/${plugin} is not tracked in ${releaseManifestPath}`)
    } else if (tracked !== manifest.version) {
      fail(
        `version mismatch for ${manifest.name}: ` +
          `plugin.json says ${manifest.version}, ${releaseManifestPath} says ${tracked}`
      )
    }
  }

  if (manifest.skills !== undefined && !Array.isArray(manifest.skills)) {
    fail(`${manifestPath} has a skills key that is not an array`)
  }

  const declared = (Array.isArray(manifest.skills) ? manifest.skills : []).filter((relative) => {
    if (typeof relative === 'string') return true
    fail(`${manifestPath} declares a skill that is not a string: ${JSON.stringify(relative)}`)
    return false
  })

  for (const relative of declared) {
    const skill = join('plugins', plugin, relative, 'SKILL.md')
    if (!existsSync(join(root, skill))) fail(`declared skill has no SKILL.md: ${skill}`)
  }

  for (const skill of directoriesIn(`plugins/${plugin}/skills`)) {
    const relative = `./skills/${skill}`
    const skillFile = `plugins/${plugin}/skills/${skill}/SKILL.md`

    if (!existsSync(join(root, skillFile))) {
      fail(`skill directory has no SKILL.md: plugins/${plugin}/skills/${skill}`)
      continue
    }
    if (!declared.includes(relative)) {
      fail(`skill on disk but not declared in ${manifestPath}: ${relative}`)
    }

    const fields = frontmatter(skillFile)
    if (!fields) {
      fail(`${skillFile} has no frontmatter block`)
      continue
    }
    if (!fields.name) fail(`${skillFile} frontmatter has no name`)
    else if (fields.name !== skill) {
      fail(`${skillFile} frontmatter name is "${fields.name}", expected "${skill}" to match its directory`)
    }
    // Claude Code routes on the description alone. A skill without one is
    // installed but unreachable.
    if (!fields.description) fail(`${skillFile} frontmatter has no description`)
  }

  const commands = join(root, 'plugins', plugin, 'commands')
  if (existsSync(commands)) {
    for (const file of readdirSync(commands)) {
      // Dotfiles are tool config (a nested .markdownlint.yml, a stray
      // .DS_Store), not commands.
      if (file.startsWith('.')) continue
      if (!file.endsWith('.md')) fail(`command file is not markdown: plugins/${plugin}/commands/${file}`)
    }
  }
}

for (const name of listed.keys()) {
  if (!claimed.has(name)) fail(`marketplace lists ${name}, but no plugin under plugins/ declares that name`)
}

if (errors.length > 0) {
  console.error('manifest check failed:')
  for (const error of errors) console.error(`  ${error}`)
  process.exit(1)
}

console.log(`manifests ok: ${pluginDirectories.length} plugin(s) checked`)
