import { describe, it, expect } from 'vitest'
import { scoreSkills } from '../src/search/scoring.js'
import type { Skill } from '../src/discovery/types.js'

const skill = (overrides: Partial<Skill>): Skill => ({
  name: 'test',
  description: '',
  path: '/fake/test/SKILL.md',
  ...overrides,
})

describe('scoreSkills', () => {
  describe('exact part match (+10)', () => {
    it('should score 10 when query term equals first kebab part of skill name', () => {
      const s = skill({ name: 'auto-go' })
      const result = scoreSkills([s], 'auto', 5)
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ name: 'auto-go', score: 10 })
    })

    it('should score 10 when query term equals last kebab part of skill name', () => {
      const s = skill({ name: 'auto-go' })
      const result = scoreSkills([s], 'go', 5)
      expect(result[0]).toMatchObject({ name: 'auto-go', score: 10 })
    })

    it('should score 10 when query term equals last part of a three-segment name', () => {
      const s = skill({ name: 'ship-to-prod' })
      const result = scoreSkills([s], 'prod', 5)
      expect(result[0]).toMatchObject({ name: 'ship-to-prod', score: 10 })
    })

    it('should score 10 when query term equals middle part of a three-segment name', () => {
      const s = skill({ name: 'ship-to-prod' })
      const result = scoreSkills([s], 'to', 5)
      expect(result[0]).toMatchObject({ name: 'ship-to-prod', score: 10 })
    })
  })

  describe('substring of part (+5)', () => {
    it('should score 5 when query term is a substring of a name part but not equal to it', () => {
      // parts = ["automation", "go"]; "auto" is a substring of "automation" but not an exact part
      const s = skill({ name: 'automation-go' })
      const result = scoreSkills([s], 'auto', 5)
      expect(result[0]).toMatchObject({ name: 'automation-go', score: 5 })
    })

    it('should score 5 when query term is a prefix-substring of a longer name part', () => {
      // parts = ["ship", "to", "prod"]; "shi" is a substring of "ship"
      const s = skill({ name: 'ship-to-prod' })
      const result = scoreSkills([s], 'shi', 5)
      expect(result[0]).toMatchObject({ name: 'ship-to-prod', score: 5 })
    })
  })

  describe('full-name fallback (+3)', () => {
    // The +3 fallback fires when parsed.full.includes(term) AND score is still 0
    // at that iteration. Because parsed.full = parts.join(' '), any term that is
    // a substring of a part already gets +5 above, which prevents the +3 path.
    // The only theoretical trigger would be a term that spans a hyphen boundary
    // (e.g. "c d" from "abc-def") but tokenization splits such queries into
    // individual tokens that each hit +5 via substring matching.
    // Source reference: scoring.ts line 137 (ported from ToolSearchTool.ts line 278).
    it.skip('full-name fallback +3 — rarely reachable, documented in source line 278', () => {
      // Structural reason: parseSkillName converts hyphens to spaces, so
      // parsed.full = parts.join(' '). Any term that appears in parsed.full
      // must be a substring of at least one part (or equal to a part), which
      // causes score > 0 before the fallback check, preventing +3 from firing.
      // The path is present in the source for completeness / future CamelCase
      // edge cases but cannot be demonstrated with kebab-case skill names.
    })
  })

  describe('whenToUse (+4)', () => {
    it('should score 4 when query term matches a word in whenToUse (word-boundary)', () => {
      const s = skill({ name: 'unrelated', whenToUse: 'deploy to production' })
      const result = scoreSkills([s], 'deploy', 5)
      expect(result).toEqual([
        expect.objectContaining({ name: 'unrelated', score: 4 }),
      ])
    })
  })

  describe('description (+2)', () => {
    it('should score 2 when query term matches a word in description (word-boundary)', () => {
      const s = skill({ name: 'unrelated', description: 'deploy to production' })
      const result = scoreSkills([s], 'deploy', 5)
      expect(result[0]).toMatchObject({ name: 'unrelated', score: 2 })
    })

    it('should score 0 when query term appears only as substring inside a description word (no word boundary)', () => {
      // \bdeploy\b does NOT match inside "redeploy" — "deploy" is preceded by "re"
      const s = skill({ name: 'unrelated', description: 'redeploy' })
      const result = scoreSkills([s], 'deploy', 5)
      expect(result).toHaveLength(0)
    })
  })

  describe('triggers (+2)', () => {
    it('should score 2 when query term matches a word in triggers (word-boundary)', () => {
      const s = skill({ name: 'unrelated', triggers: 'alpha beta' })
      const result = scoreSkills([s], 'alpha', 5)
      expect(result[0]).toMatchObject({ name: 'unrelated', score: 2 })
    })
  })

  describe('combined scoring', () => {
    it('should sum scores across matching fields: +10 exact part + +2 description = 12', () => {
      // "auto" is an exact part of "auto-go" (+10) and a word in description (+2)
      const s = skill({ name: 'auto-go', description: 'auto something' })
      const result = scoreSkills([s], 'auto', 5)
      expect(result[0]).toMatchObject({ name: 'auto-go', score: 12 })
    })
  })

  describe('required-term pre-filter', () => {
    it('should include skills that satisfy a required term and rank by optional terms', () => {
      const a = skill({ name: 'browser-test', description: 'playwright' })
      const b = skill({ name: 'browser-foo', description: 'puppeteer' })
      // "+browser" is required (both pass); "playwright" is optional (only A matches)
      // Scores: A = +10 (browser part exact) + +2 (playwright in description) = 12
      //         B = +10 (browser part exact) = 10
      const result = scoreSkills([a, b], '+browser playwright', 5)
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ name: 'browser-test', score: 12 })
      expect(result[1]).toMatchObject({ name: 'browser-foo', score: 10 })
    })

    it('should return empty array when no skills satisfy the required term', () => {
      const a = skill({ name: 'browser-test', description: 'playwright' })
      const b = skill({ name: 'browser-foo', description: 'puppeteer' })
      const result = scoreSkills([a, b], '+nonexistent foo', 5)
      expect(result).toEqual([])
    })
  })

  describe('tie-break', () => {
    it('should sort skills with equal scores alphabetically by name ascending', () => {
      const a = skill({ name: 'zebra', description: 'foo' })
      const b = skill({ name: 'apple', description: 'foo' })
      const result = scoreSkills([a, b], 'foo', 5)
      expect(result.map(r => r.name)).toEqual(['apple', 'zebra'])
    })
  })

  describe('bare-name fast path', () => {
    it('should return exactly the one skill whose name exactly matches the query', () => {
      const auto = skill({ name: 'auto-go', description: 'orchestrator' })
      const ship = skill({ name: 'ship-to-prod', description: 'auto deploy' })
      const result = scoreSkills([auto, ship], 'auto-go', 5)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('auto-go')
    })
  })

  describe('edge cases', () => {
    it('should return empty array for an empty skills list', () => {
      expect(scoreSkills([], 'deploy', 5)).toEqual([])
    })

    it('should return empty array for an empty query string', () => {
      const s = skill({ name: 'auto-go', description: 'deploy' })
      expect(scoreSkills([s], '', 5)).toEqual([])
    })

    it('should respect maxResults and return at most that many results', () => {
      const skills = [
        skill({ name: 'alpha-go', description: 'deploy' }),
        skill({ name: 'beta-go', description: 'deploy' }),
        skill({ name: 'gamma-go', description: 'deploy' }),
      ]
      const result = scoreSkills(skills, 'deploy', 1)
      expect(result).toHaveLength(1)
    })

    it('should filter out skills with zero score (no field matched)', () => {
      const matching = skill({ name: 'auto-go' })
      const noMatch = skill({ name: 'zebra-foo' })
      const result = scoreSkills([matching, noMatch], 'auto', 5)
      expect(result.map(r => r.name)).not.toContain('zebra-foo')
    })
  })
})
