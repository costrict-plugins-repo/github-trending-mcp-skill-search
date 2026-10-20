import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from '../src/discovery/parseFrontmatter.js'

describe('parseFrontmatter', () => {
  it('parses full frontmatter with array triggers', () => {
    const raw = `---
name: auto-go
description: Autonomous orchestrator for cloud routines.
whenToUse: When user says "/auto-go".
triggers:
  - /auto-go
  - auto-go
---

# Body
Hello.`

    const { fields, body } = parseFrontmatter(raw)

    expect(fields.name).toBe('auto-go')
    expect(fields.description).toBe('Autonomous orchestrator for cloud routines.')
    expect(fields.whenToUse).toBe('When user says "/auto-go".')
    expect(fields.triggers).toBe('/auto-go auto-go')
    expect(body).toContain('# Body')
    expect(body).toContain('Hello.')
  })

  it('passes string triggers through unchanged', () => {
    const raw = `---
name: x
description: y
triggers: alpha beta
---`

    const { fields } = parseFrontmatter(raw)

    expect(fields.triggers).toBe('alpha beta')
  })

  it('omits absent optional fields entirely', () => {
    const raw = `---
name: x
description: y
---

body`

    const { fields } = parseFrontmatter(raw)

    expect(fields.name).toBe('x')
    expect(fields.description).toBe('y')
    // Keys must be absent from the object, not present as undefined-valued properties
    expect('whenToUse' in fields).toBe(false)
    expect('triggers' in fields).toBe(false)
  })

  it('returns empty fields when there is no frontmatter', () => {
    const raw = `# Just markdown\nno frontmatter here`

    const { fields, body } = parseFrontmatter(raw)

    expect(fields).toEqual({})
    expect(body).toBe(raw)
  })

  it('throws on malformed YAML', () => {
    const raw = `---
name: x
description: "unbalanced quote
---`

    expect(() => parseFrontmatter(raw)).toThrow(/^Malformed frontmatter:/)
  })

  it('drops non-string entries from triggers arrays', () => {
    const raw = `---
name: x
description: y
triggers:
  - alpha
  - 42
  - beta
---`

    const { fields } = parseFrontmatter(raw)

    // The numeric value 42 must be dropped; only string entries are kept
    expect(fields.triggers).toBe('alpha beta')
  })

  it('returns empty string for empty triggers array', () => {
    const raw = `---
name: x
description: y
triggers: []
---`

    const { fields } = parseFrontmatter(raw)

    // An empty array filtered and joined produces "" — the key is present as an empty string
    // (not undefined) because triggers was explicitly set in the frontmatter
    expect(fields.triggers).toBe('')
  })

  describe('recovery for prose-style descriptions', () => {
    it('recovers an unquoted description with embedded colon', () => {
      const raw = `---
name: new-routine
description: Add a new routine. Wraps /schedule but applies the patterns we've established: silence-on-clean default, rolling-tracker dedup.
---

body`

      const { fields } = parseFrontmatter(raw)

      expect(fields.name).toBe('new-routine')
      expect(fields.description).toContain("we've established: silence-on-clean default")
    })

    it('recovers an unquoted description with embedded double quotes', () => {
      const raw = `---
name: x
description: Use when user says "lag rutine", "ny rutine", or "add a routine".
---

body`

      const { fields } = parseFrontmatter(raw)

      expect(fields.description).toBe('Use when user says "lag rutine", "ny rutine", or "add a routine".')
    })

    it('recovers an unquoted whenToUse with embedded colon', () => {
      const raw = `---
name: x
description: short ok desc
whenToUse: After step 3: when the user has confirmed the plan
---

body`

      const { fields } = parseFrontmatter(raw)

      expect(fields.whenToUse).toBe('After step 3: when the user has confirmed the plan')
    })

    it('does not touch already-quoted values', () => {
      const raw = `---
name: x
description: "Already quoted: with colon inside"
---

body`

      const { fields } = parseFrontmatter(raw)

      expect(fields.description).toBe('Already quoted: with colon inside')
    })

    it('does not touch folded-scalar descriptions', () => {
      const raw = `---
name: x
description: >-
  Folded description: that spans multiple lines
  with embedded colons.
---

body`

      const { fields } = parseFrontmatter(raw)

      expect(fields.description).toContain('Folded description: that spans multiple lines')
    })

    it('does not touch array-form triggers when description recovery fires', () => {
      const raw = `---
name: x
description: Has a colon: in the description
triggers:
  - /alpha
  - /beta
---

body`

      const { fields } = parseFrontmatter(raw)

      expect(fields.description).toBe('Has a colon: in the description')
      expect(fields.triggers).toBe('/alpha /beta')
    })

    it('still throws on truly malformed YAML that recovery cannot fix', () => {
      // Unclosed flow-sequence bracket — recovery skips lines starting with
      // `[` (already-flow-form), so strict re-parse hits the same error.
      const raw = `---
name: x
description: y
triggers: [alpha, beta
---`

      expect(() => parseFrontmatter(raw)).toThrow(/^Malformed frontmatter:/)
    })
  })
})
