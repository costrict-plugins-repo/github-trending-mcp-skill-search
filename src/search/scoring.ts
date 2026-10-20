import { parseSkillName } from './parseSkillName.js'
import type { Skill, SearchResult } from '../discovery/types.js'

/** Score boost applied to skills sourced from the current project. */
export const PROJECT_SOURCE_BOOST = 5

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Pre-compile word-boundary regexes for all search terms.
 * Called once per search instead of skills×terms×fields times.
 *
 * Direct port of compileTermPatterns from ToolSearchTool source lines 167–175.
 */
function compileTermPatterns(terms: string[]): Map<string, RegExp> {
  const patterns = new Map<string, RegExp>()
  for (const term of terms) {
    if (!patterns.has(term)) {
      patterns.set(term, new RegExp(`\\b${escapeRegExp(term)}\\b`))
    }
  }
  return patterns
}

/**
 * Keyword-based search over skill names and descriptions.
 *
 * Direct port of searchToolsWithKeywords (ToolSearchTool source lines 186–302)
 * adapted for skills (kebab-case names, no MCP/CamelCase distinction).
 *
 * Scoring weights per field:
 *   +10  exact part match (term is element of parsed.parts)
 *   +5   substring part match (term is substring of any parsed.parts element)
 *   +3   full-name fallback (parsed.full contains term AND score is still 0 at that point)
 *   +4   whenToUse word-boundary match
 *   +2   description word-boundary match
 *   +2   triggers word-boundary match
 *
 * Required-term prefix: terms prefixed with '+' must match; skills failing any
 * required term are excluded before scoring.
 *
 * @param skills     Deduplicated Skill list from findSkills
 * @param query      Raw user query string
 * @param maxResults Maximum number of results to return
 * @returns          SearchResult[] sorted by score descending, then name ascending
 */
export function scoreSkills(
  skills: Skill[],
  query: string,
  maxResults: number,
): SearchResult[] {
  // Step 1: query normalization
  const queryLower = query.toLowerCase().trim()

  // Step 2: bare-name fast path (source lines 199–204)
  // If any skill matches the query exactly by name, return it (project-source
  // wins on collision; ties from other sources still surface so the caller
  // sees that the same name exists elsewhere).
  const exactCandidates = skills.filter(s => s.name.toLowerCase() === queryLower)
  if (exactCandidates.length > 0) {
    const sorted = [...exactCandidates].sort(sourcePriorityDesc)
    const winner = sorted[0]!
    const ties = sorted.slice(1).filter(s => s.source !== winner.source)
    return [winner, ...ties].map(s => ({
      name: s.name,
      description: s.description,
      path: s.path,
      score: 0,
      source: s.source,
    }))
  }

  // Step 3: tokenize
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 0)

  // Empty query after trim → all-zero scores → filter drops everything
  if (queryTerms.length === 0) {
    return []
  }

  // Step 4: required vs optional partition (source lines 218–229)
  const requiredTerms: string[] = []
  const optionalTerms: string[] = []
  for (const term of queryTerms) {
    if (term.startsWith('+') && term.length > 1) {
      requiredTerms.push(term.slice(1))
    } else {
      optionalTerms.push(term)
    }
  }

  const allScoringTerms =
    requiredTerms.length > 0 ? [...requiredTerms, ...optionalTerms] : queryTerms

  // Step 5: compile term regexes once (source lines 167–175)
  const termPatterns = compileTermPatterns(allScoringTerms)

  // Step 6: required-term pre-filter (source lines 236–257)
  // Skills that fail any required term are excluded entirely.
  let candidateSkills = skills
  if (requiredTerms.length > 0) {
    candidateSkills = skills.filter(skill => {
      const parsed = parseSkillName(skill.name)
      const descNormalized = (skill.description || '').toLowerCase()
      const whenToUseNormalized = (skill.whenToUse || '').toLowerCase()
      const triggersNormalized = (skill.triggers || '').toLowerCase()
      return requiredTerms.every(term => {
        const pattern = termPatterns.get(term)!
        return (
          parsed.parts.includes(term) ||
          parsed.parts.some(part => part.includes(term)) ||
          pattern.test(descNormalized) ||
          pattern.test(whenToUseNormalized) ||
          pattern.test(triggersNormalized)
        )
      })
    })
  }

  // Step 7: score (source lines 259–302)
  // Each candidate also carries a `rawScore` (no boost) so dedup-with-ties
  // can use the boost-stripped quality to decide whether a same-named skill
  // from another source is a comparable match worth surfacing.
  type ScoredSkill = SearchResult & { rawScore: number }

  const scored: ScoredSkill[] = candidateSkills.map(skill => {
    const parsed = parseSkillName(skill.name)
    const descNormalized = (skill.description || '').toLowerCase()
    const whenToUseNormalized = (skill.whenToUse || '').toLowerCase()
    const triggersNormalized = (skill.triggers || '').toLowerCase()

    let rawScore = 0
    for (const term of allScoringTerms) {
      const pattern = termPatterns.get(term)!

      if (parsed.parts.includes(term)) {
        rawScore += 10
      } else if (parsed.parts.some(part => part.includes(term))) {
        rawScore += 5
      }

      if (parsed.full.includes(term) && rawScore === 0) {
        rawScore += 3
      }

      if (whenToUseNormalized && pattern.test(whenToUseNormalized)) {
        rawScore += 4
      }

      if (pattern.test(descNormalized)) {
        rawScore += 2
      }

      if (triggersNormalized && pattern.test(triggersNormalized)) {
        rawScore += 2
      }
    }

    const score = rawScore + (skill.source === 'project' ? PROJECT_SOURCE_BOOST : 0)

    return {
      name: skill.name,
      description: skill.description,
      path: skill.path,
      source: skill.source,
      score,
      rawScore,
    }
  })

  // Step 8a: filter zero-score, sort by score then name
  const sorted = scored
    .filter(r => r.rawScore > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.name.localeCompare(b.name)
    })

  // Step 8b: source-aware dedup with tie-tolerance.
  // Within each name-group, the highest-scored entry wins (project usually
  // does, thanks to PROJECT_SOURCE_BOOST). Other-source entries are also kept
  // when their *raw* match quality is comparable to the winner's — meaning
  // the cross-project version was at least as keyword-relevant despite losing
  // on boost. They surface with their distinct `source` so the caller can
  // distinguish them.
  const byName = new Map<string, ScoredSkill[]>()
  for (const r of sorted) {
    const list = byName.get(r.name) ?? []
    list.push(r)
    byName.set(r.name, list)
  }

  const surviving: ScoredSkill[] = []
  for (const group of byName.values()) {
    const winner = group[0]!
    surviving.push(winner)
    for (const other of group.slice(1)) {
      if (other.source !== winner.source && other.rawScore >= winner.rawScore) {
        surviving.push(other)
      }
    }
  }

  // Re-sort surviving (winners + ties may now be intermixed) and cap.
  surviving.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.name.localeCompare(b.name)
  })

  return surviving.slice(0, maxResults).map(({ rawScore: _r, ...rest }) => rest)
}

/** Sort comparator: project > user > plugin > cross-project (descending priority). */
function sourcePriorityDesc(a: Skill, b: Skill): number {
  const order: Record<string, number> = {
    project: 4,
    user: 3,
    plugin: 2,
    'cross-project': 1,
  }
  return (order[b.source] ?? 0) - (order[a.source] ?? 0)
}
