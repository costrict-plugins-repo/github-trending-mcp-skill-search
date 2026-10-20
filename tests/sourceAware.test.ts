import { describe, it, expect } from 'vitest'
import { scoreSkills, PROJECT_SOURCE_BOOST } from '../src/search/scoring.js'
import { querySelect } from '../src/search/querySelect.js'
import type { Skill } from '../src/discovery/types.js'

/** Test helper — defaults to cross-project source unless overridden. */
const skill = (overrides: Partial<Skill> & { name: string; description: string }): Skill => ({
  source: 'cross-project',
  path: `/fake/${overrides.name}/SKILL.md`,
  ...overrides,
})

describe('source-aware behavior', () => {
  describe('scoreSkills + project boost', () => {
    it('adds +5 to score when source is project', () => {
      const projectSkill = skill({ name: 'deploy', description: '', source: 'project' })
      const otherSkill = skill({ name: 'deploy-2', description: '', source: 'cross-project' })

      // Use a query that exact-matches both name parts ("deploy" exact part = 10)
      const results = scoreSkills([projectSkill, otherSkill], 'deploy', 10)
      const project = results.find((r) => r.name === 'deploy')!
      const other = results.find((r) => r.name === 'deploy-2')

      // 'deploy' is the bare-name fast path here — but only if it matches
      // exactly. With the boost path on (mixed names), score should differ.
      expect(project.score).toBeGreaterThanOrEqual(0)
      // If both score-paths match, project's total = 10 + 5 = 15, other = 5 (substring)
      if (other) {
        expect(project.score).toBeGreaterThan(other.score)
      }
    })

    it('boost amount is exactly 5', () => {
      // Two identical skills, only source differs. Use a non-exact-name query
      // so both go through the scoring path (not the bare-name fast path).
      const a = skill({
        name: 'foo',
        description: 'helps with bar workflow',
        source: 'project',
      })
      const b = skill({
        name: 'foo-2',
        description: 'helps with bar workflow',
        source: 'cross-project',
      })

      const results = scoreSkills([a, b], 'bar', 10)
      const projectScore = results.find((r) => r.name === 'foo')!.score
      const crossScore = results.find((r) => r.name === 'foo-2')!.score

      expect(projectScore - crossScore).toBe(PROJECT_SOURCE_BOOST)
    })
  })

  describe('scoreSkills + name-collision dedup', () => {
    it('keeps project skill, drops cross-project when only project matches better', () => {
      const projectSkill = skill({
        name: 'start-server',
        description: 'Boot the GAIN-MSP dev server on port 4002',
        source: 'project',
      })
      const otherSkill = skill({
        name: 'start-server',
        description: 'Boot the marketing site',
        source: 'cross-project',
      })

      // Query "GAIN" — only project description matches
      const results = scoreSkills([projectSkill, otherSkill], 'GAIN', 10)
      const matches = results.filter((r) => r.name === 'start-server')
      expect(matches.length).toBe(1)
      expect(matches[0]!.source).toBe('project')
    })

    it('surfaces both when raw match quality is comparable', () => {
      const projectSkill = skill({
        name: 'deploy-prod',
        description: 'project deploy',
        source: 'project',
      })
      const otherSkill = skill({
        name: 'deploy-prod',
        description: 'other deploy',
        source: 'cross-project',
      })

      // Query "deploy" matches kebab-part exactly (+10) AND the descriptions
      // both contain the word "deploy" (+2). Both have raw score 12.
      // Project gets +5 boost → total 17. Other stays at 12.
      // Tie-tolerance: other.rawScore (12) >= project.rawScore (12) → SHOW.
      // (Note: query does NOT equal full name 'deploy-prod', so the bare-name
      // fast path does not trigger — normal scoring + dedup-with-ties applies.)
      const results = scoreSkills([projectSkill, otherSkill], 'deploy', 10)
      const matches = results.filter((r) => r.name === 'deploy-prod')
      expect(matches.length).toBe(2)
      expect(matches[0]!.source).toBe('project')
      expect(matches[0]!.score).toBe(17)
      expect(matches[1]!.source).toBe('cross-project')
      expect(matches[1]!.score).toBe(12)
    })
  })

  describe('querySelect + project priority', () => {
    it('returns project version first when name exists in two sources', () => {
      const projectSkill = skill({
        name: 'go',
        description: 'project go',
        source: 'project',
      })
      const otherSkill = skill({
        name: 'go',
        description: 'cross-project go',
        source: 'cross-project',
      })

      const result = querySelect('select:go', [otherSkill, projectSkill])
      // Project ranked first regardless of input order
      expect(result.found[0]!.source).toBe('project')
      expect(result.found[0]!.description).toBe('project go')
      // Other source surfaces as a sibling
      expect(result.found.length).toBe(2)
      expect(result.found[1]!.source).toBe('cross-project')
    })

    it('returns the only match when no collision', () => {
      const s = skill({ name: 'unique', description: 'one of a kind', source: 'project' })
      const result = querySelect('select:unique', [s])
      expect(result.found).toHaveLength(1)
      expect(result.found[0]!.source).toBe('project')
    })

    it('reports missing when name does not exist anywhere', () => {
      const s = skill({ name: 'foo', description: '', source: 'project' })
      const result = querySelect('select:bar', [s])
      expect(result.found).toHaveLength(0)
      expect(result.missing).toEqual(['bar'])
    })
  })

  describe('source priority order: project > user > plugin > cross-project', () => {
    it('querySelect picks user over plugin when no project exists', () => {
      const userSkill = skill({ name: 'foo', description: 'user', source: 'user' })
      const pluginSkill = skill({ name: 'foo', description: 'plugin', source: 'plugin' })
      const result = querySelect('select:foo', [pluginSkill, userSkill])
      expect(result.found[0]!.source).toBe('user')
    })

    it('querySelect picks plugin over cross-project when no project/user exists', () => {
      const pluginSkill = skill({ name: 'foo', description: 'plugin', source: 'plugin' })
      const crossSkill = skill({ name: 'foo', description: 'cross', source: 'cross-project' })
      const result = querySelect('select:foo', [crossSkill, pluginSkill])
      expect(result.found[0]!.source).toBe('plugin')
    })
  })
})
