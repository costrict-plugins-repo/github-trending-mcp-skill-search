#!/usr/bin/env node
// install-vscode.mjs — manual plugin install for users on the Claude Code
// VSCode extension where `/plugin install` isn't yet exposed. Mirrors what
// the CLI does: clones this repo into the plugin cache path, registers the
// plugin in installed_plugins.json, enables it in settings.json.
//
// Run from anywhere:
//   curl -fsSL https://raw.githubusercontent.com/PettHa/mcp-skill-search/main/scripts/install-vscode.mjs | node
//
// Or after cloning the repo locally:
//   node scripts/install-vscode.mjs
//
// Idempotent — re-running updates to the latest version. Does NOT touch
// other plugins or settings keys.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'

const PLUGIN_NAME = 'mcp-skill-search'
const MARKETPLACE_NAME = 'mcp-skill-search'
const REPO_URL = 'https://github.com/PettHa/mcp-skill-search.git'
const KEY = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`

const HOME = os.homedir()
const PLUGINS_DIR = path.join(HOME, '.claude', 'plugins')
const CACHE_DIR = path.join(PLUGINS_DIR, 'cache', MARKETPLACE_NAME, PLUGIN_NAME)
const REGISTRY_FILE = path.join(PLUGINS_DIR, 'installed_plugins.json')
const SETTINGS_FILE = path.join(HOME, '.claude', 'settings.json')

function log(msg) { console.log(`[install] ${msg}`) }
function die(msg) { console.error(`[install] ${msg}`); process.exit(1) }

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (e) {
    die(`failed to parse ${file}: ${e.message}`)
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

function cloneOrUpdate() {
  // Resolve a "version" identifier — we use the short SHA. That gives us a
  // stable cache path and lets re-runs detect "already at this version".
  let version = 'main'
  let installPath = path.join(CACHE_DIR, version)

  if (fs.existsSync(installPath)) {
    log(`updating existing clone at ${installPath}`)
    execSync('git fetch origin main && git reset --hard origin/main', {
      cwd: installPath,
      stdio: 'inherit',
    })
  } else {
    log(`cloning ${REPO_URL} into ${installPath}`)
    fs.mkdirSync(path.dirname(installPath), { recursive: true })
    execSync(`git clone --depth 1 ${REPO_URL} "${installPath}"`, { stdio: 'inherit' })
  }

  // Read the version from package.json inside the clone — that's the
  // authoritative source.
  const pkgPath = path.join(installPath, 'package.json')
  const pkgVersion = readJson(pkgPath, { version: 'unknown' }).version
  const sha = execSync('git rev-parse HEAD', { cwd: installPath, encoding: 'utf-8' }).trim()
  return { installPath, version: pkgVersion, gitCommitSha: sha }
}

function registerPlugin({ installPath, version, gitCommitSha }) {
  const registry = readJson(REGISTRY_FILE, { version: 2, plugins: {} })
  if (registry.version !== 2) {
    die(`installed_plugins.json has unexpected version=${registry.version}; aborting to avoid corruption`)
  }

  registry.plugins ??= {}
  const existing = registry.plugins[KEY] ?? []

  // Replace any prior user-scoped entry for this plugin; keep other scopes.
  const otherScopes = existing.filter((e) => e.scope !== 'user')
  const userEntry = {
    scope: 'user',
    installPath: installPath.replace(/\//g, path.sep),
    version,
    installedAt: existing.find((e) => e.scope === 'user')?.installedAt ?? new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    gitCommitSha,
  }
  registry.plugins[KEY] = [userEntry, ...otherScopes]

  writeJson(REGISTRY_FILE, registry)
  log(`registered ${KEY} in installed_plugins.json (version ${version})`)
}

function enablePlugin() {
  const settings = readJson(SETTINGS_FILE, {})
  settings.enabledPlugins ??= {}
  if (settings.enabledPlugins[KEY] === true) {
    log(`already enabled in ~/.claude/settings.json`)
    return
  }
  settings.enabledPlugins[KEY] = true
  writeJson(SETTINGS_FILE, settings)
  log(`enabled ${KEY} in ~/.claude/settings.json`)
}

function main() {
  log(`installing ${PLUGIN_NAME} for the Claude Code VSCode extension`)
  log(`(this is a manual mirror of /plugin install — needed until the VSCode extension exposes the command)`)

  const cloneInfo = cloneOrUpdate()
  registerPlugin(cloneInfo)
  enablePlugin()

  log('')
  log('Done. Next steps:')
  log('  1. Fully restart Claude Code (close all VSCode windows + tray; relaunch).')
  log('  2. In a fresh chat, run /mcp — skill-search should appear under a plugin section.')
  log('  3. Slash-commands /optimize-skill-context and /restore-skill-descriptions become available.')
  log('  4. Run /optimize-skill-context once to free skill-description budget (Windows note: setx requires a real restart, not Reload Window).')
}

main()
