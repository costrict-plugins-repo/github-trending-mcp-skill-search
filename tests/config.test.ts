import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { getSkillPaths } from '../src/config.js'

// ── Env cleanup ───────────────────────────────────────────────────────────────

let originalEnv: string | undefined

beforeEach(() => {
  originalEnv = process.env.SKILL_PATHS
  delete process.env.SKILL_PATHS
})

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.SKILL_PATHS
  } else {
    process.env.SKILL_PATHS = originalEnv
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return path.join(
    os.tmpdir(),
    'mcp-skill-search-test-' + Date.now() + '-' + Math.random().toString(36).slice(2),
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getSkillPaths', () => {
  describe('defaults', () => {
    it('returns the three default paths when SKILL_PATHS is unset', () => {
      delete process.env.SKILL_PATHS
      const paths = getSkillPaths()
      // If cwd === homedir, dedupe collapses to 2 entries
      expect(paths.length).toBeGreaterThanOrEqual(2)
      expect(paths.length).toBeLessThanOrEqual(3)
      expect(paths).toContain(path.resolve(os.homedir(), '.claude', 'skills'))
      expect(paths).toContain(path.resolve(process.cwd(), '.claude', 'skills'))
      expect(paths).toContain(path.resolve(os.homedir(), '.claude', 'plugins'))
    })

    it('falls back to defaults when SKILL_PATHS is empty string', () => {
      process.env.SKILL_PATHS = ''
      const paths = getSkillPaths()
      expect(paths.length).toBeGreaterThanOrEqual(2)
      expect(paths).toContain(path.resolve(os.homedir(), '.claude', 'skills'))
      expect(paths).toContain(path.resolve(os.homedir(), '.claude', 'plugins'))
    })

    it('falls back to defaults on whitespace-only value', () => {
      process.env.SKILL_PATHS = '   '
      const paths = getSkillPaths()
      expect(paths).toContain(path.resolve(os.homedir(), '.claude', 'skills'))
    })
  })

  describe('literal paths (no glob chars)', () => {
    it('uses only env paths when set, excluding defaults', () => {
      const sep = path.delimiter
      process.env.SKILL_PATHS = `/foo${sep}/bar`
      const paths = getSkillPaths()
      expect(paths.length).toBe(2)
      expect(paths).toContain(path.resolve('/foo'))
      expect(paths).toContain(path.resolve('/bar'))
      expect(paths).not.toContain(path.resolve(os.homedir(), '.claude', 'skills'))
    })

    it('preserves two platform-correct literal paths', () => {
      const a = path.join(os.tmpdir(), 'skill-test-a')
      const b = path.join(os.tmpdir(), 'skill-test-b')
      process.env.SKILL_PATHS = [a, b].join(path.delimiter)
      const paths = getSkillPaths()
      expect(paths).toContain(path.resolve(a))
      expect(paths).toContain(path.resolve(b))
    })

    it('filters empty entries caused by double delimiters', () => {
      const sep = path.delimiter
      process.env.SKILL_PATHS = `/foo${sep}${sep}/bar`
      const paths = getSkillPaths()
      expect(paths.length).toBe(2)
      expect(paths).toEqual([path.resolve('/foo'), path.resolve('/bar')])
    })

    it('deduplicates repeated literal paths', () => {
      const sep = path.delimiter
      process.env.SKILL_PATHS = `/foo${sep}/foo${sep}/bar`
      const paths = getSkillPaths()
      expect(paths.length).toBe(2)
    })

    it('resolves relative paths to absolute', () => {
      process.env.SKILL_PATHS = './rel-skills'
      const paths = getSkillPaths()
      expect(path.isAbsolute(paths[0])).toBe(true)
      expect(paths[0]).toBe(path.resolve('./rel-skills'))
    })
  })

  describe('tilde expansion', () => {
    it('expands leading tilde to home directory', () => {
      process.env.SKILL_PATHS = '~/foo'
      const paths = getSkillPaths()
      expect(paths).toContain(path.resolve(path.join(os.homedir(), 'foo')))
    })

    it('does not expand tilde when not leading', () => {
      process.env.SKILL_PATHS = '/foo/~bar'
      const paths = getSkillPaths()
      expect(paths[0]).toBe(path.resolve('/foo/~bar'))
    })
  })

  describe('glob expansion', () => {
    it('expands glob patterns to matching directories', () => {
      const tmp = makeTmpDir()
      const proj1Skills = path.join(tmp, 'proj1', '.claude', 'skills')
      const proj2Skills = path.join(tmp, 'proj2', '.claude', 'skills')
      fs.mkdirSync(proj1Skills, { recursive: true })
      fs.mkdirSync(proj2Skills, { recursive: true })

      try {
        // forward slashes required by fast-glob on all platforms
        const pattern = tmp.replace(/\\/g, '/') + '/*/.claude/skills'
        process.env.SKILL_PATHS = pattern
        const result = getSkillPaths()
        expect(result).toContain(path.resolve(proj1Skills))
        expect(result).toContain(path.resolve(proj2Skills))
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    })

    it('silently skips glob patterns with no matches — returns empty array', () => {
      process.env.SKILL_PATHS = '/nonexistent-glob-target-xyz-' + Date.now() + '/*/.claude/skills'
      const result = getSkillPaths()
      expect(result).toHaveLength(0)
    })

    it('handles glob mixed with literal entries', () => {
      const tmp = makeTmpDir()
      const proj1Skills = path.join(tmp, 'proj1', 'skills')
      const proj2Skills = path.join(tmp, 'proj2', 'skills')
      const literal = path.join(os.tmpdir(), 'skill-test-literal-' + Date.now())
      fs.mkdirSync(proj1Skills, { recursive: true })
      fs.mkdirSync(proj2Skills, { recursive: true })

      try {
        const globPart = tmp.replace(/\\/g, '/') + '/*/skills'
        process.env.SKILL_PATHS = [globPart, literal].join(path.delimiter)
        const result = getSkillPaths()
        expect(result).toContain(path.resolve(proj1Skills))
        expect(result).toContain(path.resolve(proj2Skills))
        // Literal (even non-existent) path included
        expect(result).toContain(path.resolve(literal))
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    })

    it('deduplicates paths that appear more than once after glob expansion', () => {
      const tmp = makeTmpDir()
      const skillsDir = path.join(tmp, 'proj1', 'skills')
      fs.mkdirSync(skillsDir, { recursive: true })

      try {
        const globPart = tmp.replace(/\\/g, '/') + '/*/skills'
        // Same glob entry twice
        process.env.SKILL_PATHS = [globPart, globPart].join(path.delimiter)
        const result = getSkillPaths()
        const resolvedDir = path.resolve(skillsDir)
        const occurrences = result.filter((p) => p === resolvedDir).length
        expect(occurrences).toBe(1)
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    })
  })

  describe('purity', () => {
    it('does not mutate process.env.SKILL_PATHS', () => {
      process.env.SKILL_PATHS = '/foo'
      getSkillPaths()
      expect(process.env.SKILL_PATHS).toBe('/foo')
    })
  })
})
