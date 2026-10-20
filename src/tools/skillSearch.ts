import { z } from 'zod'
import { findSkills } from '../discovery/findSkills.js'
import { getCurrentProject } from '../config.js'
import { scoreSkills } from '../search/scoring.js'
import { querySelect } from '../search/querySelect.js'
import type { SearchResult, ToolOutput } from '../discovery/types.js'

// ---------------------------------------------------------------------------
// Input schema — Zod (used by handleSkillSearch for runtime validation)
// ---------------------------------------------------------------------------

export const skillSearchInputSchema = z
  .object({
    query: z
      .string()
      .min(1, 'query must not be empty')
      .describe('select:<name>[,<name>] | keywords | +<required> [optional...]'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .default(5),
  })
  .strict()

export type SkillSearchInput = z.infer<typeof skillSearchInputSchema>

// ---------------------------------------------------------------------------
// Tool definition — exposed to MCP host
// JSON Schema is kept in sync with the Zod schema above manually.
// ---------------------------------------------------------------------------

export const skillSearchTool = {
  name: 'skill_search',
  description:
    'CALL THIS TOOL FIRST whenever the user asks about available skills, capabilities, or "how do I X" / "what can I do for X" type questions. Do not enumerate from the system prompt\'s skill list — that list may be truncated, and skills may exist in other repos that the system prompt does not show. This tool is the canonical source.\n\nWhen to call (call without asking permission):\n- User asks "what skills do I have for <topic>" → call with query="<topic>"\n- User mentions a workflow that might match a skill → call to verify\n- User refers to a skill name that\'s not visible in the active list → call with query="select:<name>" to fetch its description\n- You\'re about to say "skill X is not available" — first verify with this tool\n\nDo NOT ask "should I check?" — just call.\n\nThree query forms:\n- "select:auto-go,ship-to-prod" — direct selection by exact skill name (comma-separated)\n- "hetzner deploy" — keyword search, ranked by relevance\n- "+browser playwright" — "+browser" is required, "playwright" is a ranking term\n\nReturns matches as { name, description, path, score, source } and the current_project root. `source` is one of project | user | plugin | cross-project — project-source skills win at name-collision time and get a +5 score boost. Same-named skills from another source surface only when their raw match quality matches the winner\'s. The description is the full frontmatter description, never truncated.\n\nWhen the response includes a `setup_hint`, the server prepends a [ACTION REQUIRED] content block before the JSON. Surface that notice to the user in your reply — briefly mention they can run `/optimize-skill-context` to free skill description budget. Do this on the first call of a session; don\'t repeat it on every subsequent call.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        minLength: 1,
        description: 'select:<name>[,<name>] | keywords | +<required> [optional...]',
      },
      max_results: {
        type: 'number',
        minimum: 1,
        maximum: 20,
        default: 5,
        description: 'Maximum number of matches to return (default 5, max 20)',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  _meta: { 'anthropic/alwaysLoad': true },
} as const

// ---------------------------------------------------------------------------
// Handler — called by the MCP server request handler
// ---------------------------------------------------------------------------

/**
 * Handler: takes validated input, returns MCP tool result content.
 *
 * Routing:
 *   - query matching /^select:/i → querySelect (direct name lookup)
 *   - all other queries            → scoreSkills (keyword ranking)
 *
 * pending_paths is only included when matches is empty AND errored_paths is
 * non-empty — avoids noise on every successful response.
 */
export async function handleSkillSearch(input: SkillSearchInput): Promise<ToolOutput> {
  const { query, max_results } = input
  const { skills, errored_paths } = await findSkills()

  let matches: SearchResult[]
  if (/^select:/i.test(query)) {
    const result = querySelect(query, skills)
    matches = result.found.slice(0, max_results)
    // Note: querySelect.missing is intentionally NOT surfaced in this MCP layer.
    // The host can re-issue with corrected names — adding "missing" to ToolOutput
    // would require expanding the type. Defer to a future iteration if needed.
  } else {
    matches = scoreSkills(skills, query, max_results)
  }

  const output: ToolOutput = {
    matches,
    query,
    total_skills: skills.length,
    current_project: getCurrentProject(),
  }
  if (matches.length === 0 && errored_paths.length > 0) {
    output.pending_paths = errored_paths
  }
  if (!Number(process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET)) {
    output.setup_hint =
      'SLASH_COMMAND_TOOL_CHAR_BUDGET is not set. Run /optimize-skill-context (a slash-command bundled with this plugin) to free skill-description budget — descriptions become names-only in system prompt, and skill_search serves them on demand. Reverse with /restore-skill-descriptions.'
  }
  return output
}
