import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import { getSkillPaths, getCurrentProject, classifySkillSource } from '../config.js'
import { parseFrontmatter } from './parseFrontmatter.js'
import type { Skill } from './types.js'

export interface FindSkillsResult {
  skills: Skill[]
  /** Paths that errored during walk — surfaced when no matches are found */
  errored_paths: string[]
}

/** Hard cap on a single SKILL.md size — prevents memory exhaustion on a crafted file. */
const MAX_SKILL_SIZE_BYTES = 512 * 1024

let cache: FindSkillsResult | null = null

/**
 * Resolve the realpath of a candidate file and assert it stays under one of the configured roots.
 * Why: prevents symlink escape (e.g. `~/.claude/skills/evil → /etc/`) from causing reads
 * outside the user's intended skill directories.
 */
async function isUnderConfiguredRoot(filePath: string, rootPaths: string[]): Promise<boolean> {
  let realFile: string
  let realRoots: string[]
  try {
    realFile = await fs.realpath(filePath)
    realRoots = await Promise.all(
      rootPaths.map(async (r) => {
        try {
          return await fs.realpath(r)
        } catch {
          return r
        }
      }),
    )
  } catch {
    return false
  }
  return realRoots.some((root) => {
    const rel = path.relative(root, realFile)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  })
}

/**
 * Find all SKILL.md files under the configured paths. Cached after first call.
 * Pass `{ refresh: true }` to bypass the cache.
 */
export async function findSkills(opts?: { refresh?: boolean }): Promise<FindSkillsResult> {
  if (cache !== null && opts?.refresh !== true) {
    return cache
  }

  cache = null

  const rootPaths = getSkillPaths()
  const currentProject = getCurrentProject()
  const skills: Skill[] = []
  const errored_paths: string[] = []

  await Promise.all(
    rootPaths.map(async (rootPath) => {
      let entries: Dirent[]
      try {
        entries = await fs.readdir(rootPath, { withFileTypes: true, recursive: true })
      } catch {
        errored_paths.push(rootPath)
        return
      }

      for (const entry of entries) {
        if (!entry.isFile() && !entry.isSymbolicLink()) continue
        if (entry.name !== 'SKILL.md') continue

        // entry.parentPath is available in Node ≥18.17 / ≥20.1 with recursive readdir
        const parentPath = (entry as Dirent & { parentPath?: string }).parentPath ?? entry.path
        const filePath = path.resolve(parentPath, entry.name)

        if (!(await isUnderConfiguredRoot(filePath, rootPaths))) {
          console.warn(
            `[mcp-skill-search] Skipping ${filePath}: resolves outside configured skill roots (symlink escape)`,
          )
          continue
        }

        try {
          const stat = await fs.stat(filePath)
          if (stat.size > MAX_SKILL_SIZE_BYTES) {
            console.warn(
              `[mcp-skill-search] Skipping ${filePath}: file size ${stat.size} exceeds cap of ${MAX_SKILL_SIZE_BYTES} bytes`,
            )
            continue
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          console.warn(`[mcp-skill-search] Skipping ${filePath}: ${reason}`)
          continue
        }

        let raw: string
        try {
          raw = await fs.readFile(filePath, 'utf-8')
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          console.warn(`[mcp-skill-search] Skipping ${filePath}: ${reason}`)
          continue
        }

        let fields: ReturnType<typeof parseFrontmatter>['fields']
        try {
          const parsed = parseFrontmatter(raw)
          fields = parsed.fields
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          console.warn(`[mcp-skill-search] Skipping ${filePath}: ${reason}`)
          continue
        }

        if (!fields.name || !fields.description) {
          console.warn(
            `[mcp-skill-search] Skipping ${filePath}: missing required field(s) — name and description are required`,
          )
          continue
        }

        const skill: Skill = {
          name: fields.name,
          description: fields.description,
          path: filePath,
          source: classifySkillSource(filePath, currentProject),
          ...(fields.whenToUse !== undefined && { whenToUse: fields.whenToUse }),
          ...(fields.triggers !== undefined && { triggers: fields.triggers }),
        }

        skills.push(skill)
      }
    }),
  )

  // Path-dedup only: a SKILL.md walked through two different roots (e.g.
  // overlapping globs) shouldn't appear twice. Name-collisions across repos
  // are handled by consumers (scoring.ts and querySelect.ts) which apply the
  // project-wins policy with source-aware tie-tolerance.
  const seenPaths = new Set<string>()
  const pathDeduped: Skill[] = []
  for (const skill of skills) {
    if (!seenPaths.has(skill.path)) {
      seenPaths.add(skill.path)
      pathDeduped.push(skill)
    }
  }

  const result: FindSkillsResult = { skills: pathDeduped, errored_paths }
  cache = result
  return result
}
