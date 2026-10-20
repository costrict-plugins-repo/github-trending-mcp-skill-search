export interface ParsedName {
  parts: string[]
  full: string
}

/**
 * Parse a skill name into searchable parts.
 *
 * Handles kebab-case (primary), CamelCase, and snake_case.
 * Output drives scoring.ts: `parts` for exact-term matching,
 * `full` for substring matching.
 *
 * @example
 * parseSkillName("ship-to-prod")  // { parts: ["ship","to","prod"], full: "ship to prod" }
 * parseSkillName("MyCamelSkill")  // { parts: ["my","camel","skill"], full: "my camel skill" }
 * parseSkillName("")              // { parts: [], full: "" }
 */
export function parseSkillName(name: string): ParsedName {
  const parts = name
    .replace(/([a-z])([A-Z])/g, '$1 $2') // CamelCase → "Camel Case"
    .replace(/[-_]/g, ' ')               // kebab and snake → spaces
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  return {
    parts,
    full: parts.join(' '),
  }
}
