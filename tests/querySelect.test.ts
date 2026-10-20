import { describe, it, expect } from 'vitest'
import { querySelect } from '../src/search/querySelect.js'
import type { Skill } from '../src/discovery/types.js'

const skills: Skill[] = [
  { name: 'auto-go', description: 'orchestrator', path: '/p/auto-go/SKILL.md' },
  { name: 'ship-to-prod', description: 'deploy', path: '/p/ship-to-prod/SKILL.md' },
  { name: 'minimal', description: 'just a stub', path: '/p/minimal/SKILL.md' },
]

describe('querySelect', () => {
  it('should return a single matched skill with score 0 for a single-name select', () => {
    const r = querySelect('select:auto-go', skills)
    expect(r.found.length).toBe(1)
    expect(r.found[0].name).toBe('auto-go')
    expect(r.found[0].description).toBe('orchestrator')
    expect(r.found[0].path).toBe('/p/auto-go/SKILL.md')
    expect(r.found[0].score).toBe(0)
    expect(r.missing).toEqual([])
  })

  it('should return multiple matched skills for a comma-separated select', () => {
    const r = querySelect('select:auto-go,ship-to-prod', skills)
    expect(r.found.map(f => f.name)).toEqual(['auto-go', 'ship-to-prod'])
    expect(r.missing).toEqual([])
  })

  it('should return found skills and list missing names when only some names exist', () => {
    const r = querySelect('select:auto-go,nonexistent', skills)
    expect(r.found.length).toBe(1)
    expect(r.found[0].name).toBe('auto-go')
    expect(r.missing).toEqual(['nonexistent'])
  })

  it('should match case-insensitively but preserve original skill casing in output', () => {
    const r = querySelect('select:AUTO-GO', skills)
    expect(r.found.length).toBe(1)
    expect(r.found[0].name).toBe('auto-go')
  })

  it('should trim whitespace around each name in the select list', () => {
    const r = querySelect('select: auto-go , ship-to-prod ', skills)
    expect(r.found.map(f => f.name)).toEqual(['auto-go', 'ship-to-prod'])
  })

  it('should deduplicate repeated names in found, returning each skill only once', () => {
    const r = querySelect('select:auto-go,auto-go', skills)
    expect(r.found.length).toBe(1)
    expect(r.found[0].name).toBe('auto-go')
  })

  it('should return empty found and missing when the select list is empty', () => {
    const r = querySelect('select:', skills)
    expect(r.found).toEqual([])
    expect(r.missing).toEqual([])
  })

  it('should return empty found and missing when the select list contains only commas', () => {
    const r = querySelect('select:,,,', skills)
    expect(r.found).toEqual([])
    expect(r.missing).toEqual([])
  })

  it('should return empty found and missing defensively when query has no select: prefix', () => {
    const r = querySelect('hetzner deploy', skills)
    expect(r.found).toEqual([])
    expect(r.missing).toEqual([])
  })

  it('should report all requested names as missing when the skills array is empty', () => {
    const r = querySelect('select:auto-go', [])
    expect(r.found).toEqual([])
    expect(r.missing).toEqual(['auto-go'])
  })

  it('should return found skills in the order names appear in the query, not in the skills array', () => {
    const r = querySelect('select:ship-to-prod,auto-go', skills)
    expect(r.found.map(f => f.name)).toEqual(['ship-to-prod', 'auto-go'])
  })

  it('should not mutate the input skills array', () => {
    const skillsCopy = JSON.parse(JSON.stringify(skills))
    querySelect('select:auto-go', skills)
    expect(skills).toEqual(skillsCopy)
  })
})
