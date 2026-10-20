import { describe, it, expect } from 'vitest'
import { parseSkillName } from '../src/search/parseSkillName.js'

describe('parseSkillName', () => {
  it.each([
    { input: 'auto-go', parts: ['auto', 'go'], full: 'auto go' },
    { input: 'ship-to-prod', parts: ['ship', 'to', 'prod'], full: 'ship to prod' },
    { input: 'MyCamelSkill', parts: ['my', 'camel', 'skill'], full: 'my camel skill' },
    { input: 'snake_case_skill', parts: ['snake', 'case', 'skill'], full: 'snake case skill' },
    {
      input: 'hetzner-server-security-audit',
      parts: ['hetzner', 'server', 'security', 'audit'],
      full: 'hetzner server security audit',
    },
    { input: '', parts: [], full: '' },
    { input: '---', parts: [], full: '' },
  ])('parses $input', ({ input, parts, full }) => {
    const result = parseSkillName(input)
    expect(result.parts).toEqual(parts)
    expect(result.full).toBe(full)
  })

  it('handles a single character', () => {
    const result = parseSkillName('a')
    expect(result.parts).toEqual(['a'])
    expect(result.full).toBe('a')
  })

  it('handles all-uppercase two-char input (AB quirk: no lower-then-upper boundary)', () => {
    const result = parseSkillName('AB')
    expect(result.parts).toEqual(['ab'])
    expect(result.full).toBe('ab')
  })

  it('handles whitespace-padded input', () => {
    const result = parseSkillName('  auto-go  ')
    expect(result.parts).toEqual(['auto', 'go'])
    expect(result.full).toBe('auto go')
  })

  it('handles double dashes by filtering empty segments', () => {
    const result = parseSkillName('auto--go')
    expect(result.parts).toEqual(['auto', 'go'])
    expect(result.full).toBe('auto go')
  })

  it('keeps parts and full consistent', () => {
    const r = parseSkillName('hetzner-server-security-audit')
    expect(r.full).toBe(r.parts.join(' '))
  })
})
