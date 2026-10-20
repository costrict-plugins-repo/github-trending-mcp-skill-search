import type { Skill, SearchResult } from '../discovery/types.js'

export interface SelectResult {
  /** Skills matched by name (deduplicated, in input order) */
  found: SearchResult[]
  /** Names that were requested but not in the skill list */
  missing: string[]
}

/**
 * Parse a `select:A,B,C` query and return the matched skills.
 * @param query - the full query string, must start with `select:` (case-insensitive)
 * @param skills - all known skills
 */
export function querySelect(query: string, skills: Skill[]): SelectResult {
  // Step 1: extract the comma list
  const match = query.match(/^select:(.+)$/i)
  if (!match) {
    // Defensive: caller should have already routed only matching queries here
    return { found: [], missing: [] }
  }

  const requested = match[1]!
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  // Step 2: lookup by name (case-insensitive). When multiple skills share a
  // name across repos, project-source wins; ties from other sources are also
  // surfaced so the caller knows the same name exists elsewhere.
  const found: SearchResult[] = []
  const missing: string[] = []
  const foundNames = new Set<string>()

  const sourcePriority: Record<string, number> = {
    project: 4,
    user: 3,
    plugin: 2,
    'cross-project': 1,
  }

  for (const requestedName of requested) {
    const candidates = skills.filter(
      s => s.name.toLowerCase() === requestedName.toLowerCase(),
    )
    if (candidates.length === 0) {
      missing.push(requestedName)
      continue
    }

    const sorted = [...candidates].sort(
      (a, b) => (sourcePriority[b.source] ?? 0) - (sourcePriority[a.source] ?? 0),
    )
    const winner = sorted[0]!
    if (foundNames.has(winner.name)) continue
    foundNames.add(winner.name)

    found.push({
      name: winner.name,
      description: winner.description,
      path: winner.path,
      source: winner.source,
      score: 0,
    })
    for (const other of sorted.slice(1)) {
      if (other.source !== winner.source) {
        found.push({
          name: other.name,
          description: other.description,
          path: other.path,
          source: other.source,
          score: 0,
        })
      }
    }
  }

  // Step 3: return
  return { found, missing }
}
