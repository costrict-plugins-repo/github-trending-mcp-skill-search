import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { findSkills } from '../src/discovery/findSkills.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FIXTURES = path.resolve(__dirname, 'fixtures', 'skills')

let originalEnv: string | undefined

beforeEach(() => {
  originalEnv = process.env.SKILL_PATHS
})

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.SKILL_PATHS
  } else {
    process.env.SKILL_PATHS = originalEnv
  }
})

describe('findSkills', () => {
  describe('basic walk', () => {
    it('finds 4 valid skills from fixtures', async () => {
      process.env.SKILL_PATHS = FIXTURES
      const result = await findSkills({ refresh: true })
      expect(result.skills.map((s) => s.name).sort()).toEqual([
        'auto-go',
        'minimal',
        'norsk',
        'ship-to-prod',
      ])
      expect(result.errored_paths).toEqual([])
    })

    it('surfaces frontmatter fields correctly', async () => {
      process.env.SKILL_PATHS = FIXTURES
      const result = await findSkills({ refresh: true })
      const autoGo = result.skills.find((s) => s.name === 'auto-go')!
      expect(autoGo).toBeDefined()
      expect(autoGo.description).toContain('Autonomous orchestrator')
      expect(autoGo.whenToUse).toContain('/auto-go')
      expect(autoGo.triggers).toBe('/auto-go auto-go')
      expect(autoGo.path).toMatch(/auto-go[\\/]SKILL\.md$/)
    })

    it('handles UTF-8 in descriptions', async () => {
      process.env.SKILL_PATHS = FIXTURES
      const result = await findSkills({ refresh: true })
      const norsk = result.skills.find((s) => s.name === 'norsk')!
      expect(norsk).toBeDefined()
      expect(norsk.description).toContain('æøå')
    })
  })

  describe('error handling', () => {
    it('skips missing-name and malformed with warnings', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      process.env.SKILL_PATHS = FIXTURES
      const result = await findSkills({ refresh: true })
      expect(result.skills.length).toBe(4)
      expect(warnSpy).toHaveBeenCalled()
      const warnings = warnSpy.mock.calls.map((c) => c.join(' '))
      expect(warnings.some((w) => /no-name/.test(w))).toBe(true)
      expect(warnings.some((w) => /malformed/.test(w))).toBe(true)
      warnSpy.mockRestore()
    })

    it('records non-existent paths in errored_paths', async () => {
      process.env.SKILL_PATHS = path.join(FIXTURES, 'this-does-not-exist')
      const result = await findSkills({ refresh: true })
      expect(result.skills).toEqual([])
      expect(result.errored_paths.length).toBe(1)
      expect(result.errored_paths[0]).toContain('this-does-not-exist')
    })
  })

  describe('cache', () => {
    it('returns cached result on second call', async () => {
      process.env.SKILL_PATHS = FIXTURES
      const first = await findSkills({ refresh: true })
      // Point env to a non-existent path — cache should keep the previous result
      process.env.SKILL_PATHS = path.join(FIXTURES, 'nothing')
      const second = await findSkills() // no refresh
      expect(second.skills.length).toBe(first.skills.length)
      expect(second.skills[0].name).toBe(first.skills[0].name)
    })

    it('refreshes when opts.refresh is true', async () => {
      process.env.SKILL_PATHS = FIXTURES
      await findSkills({ refresh: true })
      process.env.SKILL_PATHS = path.join(FIXTURES, 'this-does-not-exist')
      const fresh = await findSkills({ refresh: true })
      expect(fresh.skills).toEqual([])
      expect(fresh.errored_paths.length).toBe(1)
    })
  })

  describe('cross-repo name collisions', () => {
    it('keeps both skills when same name appears in two paths (no name-dedup at this layer)', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-skill-search-'))
      try {
        await fs.mkdir(path.join(tmpDir, 'auto-go'))
        await fs.writeFile(
          path.join(tmpDir, 'auto-go', 'SKILL.md'),
          `---\nname: auto-go\ndescription: OVERRIDE from tmp\n---\nbody`,
        )

        process.env.SKILL_PATHS = `${tmpDir}${path.delimiter}${FIXTURES}`
        const result = await findSkills({ refresh: true })
        const autoGoMatches = result.skills.filter((s) => s.name === 'auto-go')
        // Both skills are returned — the consumer (scoring/querySelect) now
        // decides which wins on collision, with project-source preferred.
        expect(autoGoMatches.length).toBe(2)
        const descriptions = autoGoMatches.map((s) => s.description)
        expect(descriptions).toContain('OVERRIDE from tmp')
        // The fixture's description is the other one — exact text not asserted,
        // we just verify both skills survived discovery.
        expect(descriptions.filter((d) => d !== 'OVERRIDE from tmp')).toHaveLength(1)
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true })
      }
    })

    it('tags every skill with a source classification', async () => {
      process.env.SKILL_PATHS = FIXTURES
      const result = await findSkills({ refresh: true })
      for (const skill of result.skills) {
        expect(['project', 'user', 'plugin', 'cross-project']).toContain(skill.source)
      }
    })
  })
})
