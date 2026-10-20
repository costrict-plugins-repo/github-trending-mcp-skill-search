import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import fastGlob from 'fast-glob'
import type { SkillSource } from './discovery/types.js'

/**
 * Resolve the list of root paths to walk for skill discovery.
 *
 * When the `SKILL_PATHS` environment variable is set and non-empty it is used
 * exclusively (split on the platform delimiter so both `:` on Unix and `;` on
 * Windows are handled without hard-coding either character).
 *
 * Each entry in SKILL_PATHS may contain glob characters (`*`, `?`, `[`, `{`).
 * Leading `~` is expanded to the home directory before globbing. Glob patterns
 * that match no directories are silently skipped. Literal (non-glob) entries
 * behave as before — they are resolved to absolute paths without existence
 * checks.
 *
 * Otherwise the three default locations are returned:
 *  - ~/.claude/skills/      — user-global skills
 *  - <cwd>/.claude/skills/  — project-local skills
 *  - ~/.claude/plugins/     — plugin-bundled skills
 *
 * All returned paths are absolute and deduplicated. Existence is NOT verified —
 * the downstream consumer (findSkills) is responsible for skipping missing dirs.
 */
export function getSkillPaths(): string[] {
  const raw = process.env.SKILL_PATHS

  if (raw !== undefined && raw.trim() !== '') {
    const resolved: string[] = []

    for (const entry of raw.split(path.delimiter).filter((p) => p.trim() !== '')) {
      const expanded = entry.startsWith('~')
        ? os.homedir() + entry.slice(1)
        : entry

      if (/[*?[{]/.test(expanded)) {
        const pattern = expanded.replace(/\\/g, '/')
        const matches = fastGlob.sync(pattern, { onlyDirectories: true, absolute: true })
        for (const m of matches) {
          resolved.push(path.resolve(m))
        }
      } else {
        resolved.push(path.resolve(expanded))
      }
    }

    return dedupe(resolved)
  }

  const defaults = [
    path.join(os.homedir(), '.claude', 'skills'),
    path.join(process.cwd(), '.claude', 'skills'),
    path.join(os.homedir(), '.claude', 'plugins'),
  ].map((p) => path.resolve(p))

  return dedupe(defaults)
}

function dedupe(paths: string[]): string[] {
  return [...new Set(paths)]
}

/**
 * Resolve the "current project" — the absolute path of the repo the user is
 * working in. We use this to disambiguate skills with the same name across
 * multiple repos: project-local skills win over cross-project ones at dedup
 * time, and they get a +5 score boost in keyword search.
 *
 * Resolution order:
 *  1. `git rev-parse --show-toplevel` from CWD (handles monorepos + sub-dirs)
 *  2. CWD itself when not in a git repo
 *  3. null if even CWD is unavailable (process detached)
 *
 * Cached for the lifetime of the process — git-root doesn't move.
 */
let currentProjectCache: string | null | undefined
export function getCurrentProject(): string | null {
  if (currentProjectCache !== undefined) return currentProjectCache

  try {
    const out = execSync('git rev-parse --show-toplevel', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    currentProjectCache = path.resolve(out)
    return currentProjectCache
  } catch {
    // Not in a git repo (or git not installed). Fall back to CWD.
    try {
      currentProjectCache = path.resolve(process.cwd())
      return currentProjectCache
    } catch {
      currentProjectCache = null
      return null
    }
  }
}

/** Test seam — clears the cache so tests can change CWD between runs. */
export function _resetCurrentProjectCache(): void {
  currentProjectCache = undefined
}

/**
 * Classify where a skill came from. Path-prefix-based; case-insensitive on
 * Windows is handled by `path.relative` returning '..' for non-children.
 */
export function classifySkillSource(
  skillPath: string,
  currentProject: string | null,
): SkillSource {
  const home = os.homedir()
  const userSkills = path.join(home, '.claude', 'skills')
  const userPlugins = path.join(home, '.claude', 'plugins')

  if (isUnder(skillPath, userPlugins)) return 'plugin'
  if (isUnder(skillPath, userSkills)) return 'user'
  if (currentProject !== null) {
    const projectSkills = path.join(currentProject, '.claude', 'skills')
    if (isUnder(skillPath, projectSkills)) return 'project'
  }
  return 'cross-project'
}

function isUnder(child: string, parent: string): boolean {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}
