/**
 * Where a skill came from. Used for repo-aware dedup and ranking:
 *  - 'project'        — under the current git-root's `.claude/skills/`
 *  - 'user'           — under `~/.claude/skills/`
 *  - 'plugin'         — under `~/.claude/plugins/`
 *  - 'cross-project'  — anywhere else (typically a glob-expanded GitHub project)
 */
export type SkillSource = 'project' | 'user' | 'plugin' | 'cross-project'

/**
 * A discovered SKILL.md file with parsed frontmatter fields.
 */
export interface Skill {
  /** Slug from frontmatter (e.g. "auto-go", "ship-to-prod") */
  name: string
  /** Free-text description from frontmatter — surfaced verbatim in match output */
  description: string
  /** Optional whenToUse field — boosts search ranking when matched */
  whenToUse?: string
  /** Optional triggers field, coerced to a single space-joined string */
  triggers?: string
  /** Absolute path to the SKILL.md file on disk */
  path: string
  /** Where this skill was found relative to the current project + standard locations */
  source: SkillSource
}

/**
 * One row of search output, surfaced to the MCP host.
 */
export interface SearchResult {
  name: string
  description: string
  path: string
  score: number
  source: SkillSource
}

/**
 * Top-level shape returned from the skill_search tool.
 */
export interface ToolOutput {
  matches: SearchResult[]
  query: string
  total_skills: number
  /** Absolute path to the current project's git-root (or CWD if not in a git repo) */
  current_project: string | null
  /** Paths that errored during walk — surfaced when matches.length === 0 */
  pending_paths?: string[]
  /**
   * One-time setup advice the model should surface to the user when present.
   * Currently emitted on every response while `SLASH_COMMAND_TOOL_CHAR_BUDGET`
   * is unset — instructs the user to run `/optimize-skill-context` to free
   * skill description budget. Absent when no advice applies.
   */
  setup_hint?: string
}
