import matter from 'gray-matter'

export interface ParsedFrontmatter {
  /** Frontmatter fields, all optional at parse time. Validation is the caller's job. */
  fields: {
    name?: string
    description?: string
    whenToUse?: string
    triggers?: string
  }
  /** The markdown body that follows the closing --- */
  body: string
}

const RECOVERABLE_FIELDS = ['name', 'description', 'whenToUse'] as const

/**
 * Auto-quote unquoted plain-scalar values for known single-line string fields.
 *
 * Why: the official `skill-creator` skill instructs authors to write "pushy",
 * prose-like descriptions. Natural prose contains colons, apostrophes, and
 * embedded double-quotes — all of which break strict YAML plain-scalar rules.
 * Claude Code's own SkillTool tolerates this; we match that contract here.
 *
 * Scope: only single-line values for the three known string fields. Arrays
 * (`triggers:` with a list), folded/literal blocks (`>` / `|`), and already-
 * quoted values are left untouched.
 */
function autoQuoteStringFields(raw: string): string {
  const fmMatch = raw.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/)
  if (!fmMatch) return raw
  const [whole, opening, body, closing] = fmMatch

  const eol = body.includes('\r\n') ? '\r\n' : '\n'
  const lines = body.split(/\r?\n/)
  let changed = false

  const recovered = lines.map((line) => {
    for (const field of RECOVERABLE_FIELDS) {
      const m = line.match(new RegExp(`^(${field}):[\\t ]+(.+)$`))
      if (!m) continue
      const value = m[2]
      if (/^["']/.test(value)) return line
      if (/^[\[{|>]/.test(value)) return line
      changed = true
      return `${field}: ${JSON.stringify(value)}`
    }
    return line
  })

  if (!changed) return raw
  const newBlock = `${opening}${recovered.join(eol)}${closing}`
  return raw.replace(whole, newBlock)
}

function strictParse(raw: string): ParsedFrontmatter {
  const parsed = matter(raw)
  const data = parsed.data as Record<string, unknown>
  const content = parsed.content

  const name = typeof data.name === 'string' ? data.name : undefined
  const description = typeof data.description === 'string' ? data.description : undefined
  const whenToUse = typeof data.whenToUse === 'string' ? data.whenToUse : undefined

  let triggers: string | undefined
  if (Array.isArray(data.triggers)) {
    triggers = data.triggers.filter((t): t is string => typeof t === 'string').join(' ')
  } else if (typeof data.triggers === 'string') {
    triggers = data.triggers
  }

  const fields: ParsedFrontmatter['fields'] = {}
  if (name !== undefined) fields.name = name
  if (description !== undefined) fields.description = description
  if (whenToUse !== undefined) fields.whenToUse = whenToUse
  if (triggers !== undefined) fields.triggers = triggers

  return { fields, body: content }
}

/**
 * Parse a raw SKILL.md string into structured frontmatter fields and a body.
 *
 * Two-pass: strict YAML first, then a recovery pass that auto-quotes plain-
 * scalar string values if strict failed. The recovery pass matches Claude
 * Code's permissive SkillTool behavior — the official skill-creator skill
 * encourages prose-like descriptions that naturally contain colons.
 *
 * @throws Error with message `Malformed frontmatter: <original message>` when
 *   both strict parse and recovery fail.
 *
 * @example
 * parseFrontmatter('---\nname: auto-go\n---\n# Body')
 * // => { fields: { name: 'auto-go' }, body: '# Body' }
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  try {
    return strictParse(raw)
  } catch (firstErr) {
    const recovered = autoQuoteStringFields(raw)
    if (recovered === raw) {
      const message = firstErr instanceof Error ? firstErr.message : String(firstErr)
      throw new Error(`Malformed frontmatter: ${message}`)
    }
    try {
      return strictParse(recovered)
    } catch {
      const message = firstErr instanceof Error ? firstErr.message : String(firstErr)
      throw new Error(`Malformed frontmatter: ${message}`)
    }
  }
}
