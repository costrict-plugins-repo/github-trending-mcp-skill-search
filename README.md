# mcp-skill-search

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-95%20passing-brightgreen)](https://github.com/PettHa/mcp-skill-search/actions)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-blue)](https://code.claude.com/docs/en/discover-plugins)

ToolSearch for skills. An MCP server that searches your `SKILL.md` files by keyword, exact name, or required-term filter — so the model can fetch a skill description on demand instead of paying its system-prompt cost on every turn.

## When this helps you

**In Claude Code specifically:** Claude Code already loads skill descriptions into the system prompt automatically (up to ~1% of the context window before falling back to names-only). With under 50 small skills you may not feel the cost. With 100+ skills, or descriptions over 200 chars each, it adds up. To force `names_only` mode and free that budget — while keeping `skill_search` as your description-on-demand fallback — run the bundled setup skill:

```
/optimize-skill-context
```

The skill detects your platform and runs the appropriate command (`setx` on Windows; appends to `~/.zshrc`/`~/.bashrc` on macOS/Linux) — with your confirmation. Restart Claude Code afterward. Reverse with `/restore-skill-descriptions`.

Slash-commands (`/skill-name`) keep working; descriptions are fetched via `skill_search` when the model needs them. If you'd rather set the env var manually:

```bash
# macOS / Linux
export SLASH_COMMAND_TOOL_CHAR_BUDGET=1
```

```powershell
# Windows (persistent)
setx SLASH_COMMAND_TOOL_CHAR_BUDGET 1
```

**In other MCP hosts** (Claude Desktop, OpenAI Agents SDK, Gemini Code Assist): no native skill-loading exists. `skill_search` is the only way to surface skills. Point `SKILL_PATHS` at your skill directories and the tool finds them.

## Install — Claude Code

> Pending listing in the [official Anthropic marketplace](https://github.com/anthropics/claude-plugins-official). Once approved, install with:
> ```
> /plugin install mcp-skill-search@claude-plugins-official
> ```
> In the meantime, use one of the two paths below — both are fully functional.

### Option A: Self-hosted marketplace (CLI users)

In a terminal, run `claude` to enter Claude Code, then:

```
/plugin marketplace add PettHa/mcp-skill-search
/plugin install mcp-skill-search@mcp-skill-search
```

### Option B: VSCode extension users (`/plugin` not yet exposed)

The VSCode extension does not yet expose `/plugin`. Run the installer script instead — it does exactly what the CLI command does (clone into the plugin cache, register in `installed_plugins.json`, enable in `settings.json`):

```bash
curl -fsSL https://raw.githubusercontent.com/PettHa/mcp-skill-search/main/scripts/install-vscode.mjs | node
```

Or PowerShell:

```powershell
iwr https://raw.githubusercontent.com/PettHa/mcp-skill-search/main/scripts/install-vscode.mjs -OutFile $env:TEMP\install.mjs; node $env:TEMP\install.mjs
```

### After install (any path)

1. Fully restart Claude Code (close all VSCode windows + system tray; relaunch from Start Menu — "Reload Window" is **not** sufficient on Windows).
2. Run `/mcp` to confirm `skill-search` is registered with `alwaysLoad: true`.
3. Run `/optimize-skill-context` once to free your description budget (optional but recommended; see the Windows `setx` note inside the skill).

> The plugin bundles two skills: `optimize-skill-context` (one-time setup) and `restore-skill-descriptions` (reverse). It auto-registers an MCP server pointed at the bundled `dist/index.js`. Default skill paths: `~/.claude/skills`, `<cwd>/.claude/skills`, `~/.claude/plugins`.

## Install — Claude Desktop (manual)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "skill-search": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-skill-search/dist/index.js"],
      "env": {
        "SKILL_PATHS": "~/.claude/skills"
      }
    }
  }
}
```

Replace `/absolute/path/to/...` with your cloned repo path.

## Install — OpenAI Agents SDK / Gemini Code Assist

Both support MCP via configuration — point them at the same `node dist/index.js` command with `SKILL_PATHS` env. Untested by us; PRs welcome.

## Configure skill paths

`SKILL_PATHS` accepts colon-separated (Unix) or semicolon-separated (Windows) paths. Globs are supported:

```bash
SKILL_PATHS="~/Documents/GitHub/*/.claude/skills:~/.claude/skills"
```

This expands at startup to every matching directory. Glob characters: `*`, `?`, `[`, `{`. Tilde is expanded to the home directory. Defaults (used when `SKILL_PATHS` is unset): `~/.claude/skills`, `<cwd>/.claude/skills`, `~/.claude/plugins`.

## Tool: `skill_search`

| Query form     | Example                          | Behavior                                                  |
| -------------- | -------------------------------- | --------------------------------------------------------- |
| Keyword        | `hetzner deploy`                 | Ranks all skills by score; returns top N                  |
| Required-term  | `+browser playwright`            | Skills MUST match `browser` somewhere; ranked by `playwright` |
| Direct lookup  | `select:auto-go,ship-to-prod`    | Returns those exact skills, score 0                       |

Returns: `{ matches: [{ name, description, path, score, source }], query, total_skills, current_project }`. Description is the full frontmatter description, never truncated. `source` is one of `project | user | plugin | cross-project`. `current_project` is the absolute path to the active git-root (or CWD if not in a git repo).

## How scoring works

Ported 1:1 from Claude Code's internal `ToolSearch` algorithm (v2.1.x). Weights: exact-name-part match = 10, name-part substring = 5, full-name substring = 3, `whenToUse` word match = 4, `description` word match = 2. Required-term filter runs first; only skills passing it are scored. See [src/search/scoring.ts](https://github.com/PettHa/mcp-skill-search/blob/main/src/search/scoring.ts).

## Repo-aware behavior

When the same skill name exists in multiple repos (e.g. you have a `start-server` skill in both GAIN-MSP and GAIN-LANDING), the tool resolves the conflict using two signals:

1. **Project boost**: skills under the current git-root's `.claude/skills/` get a `+5` score boost. They almost always rank above same-named cross-project skills.
2. **Tie-tolerant dedup**: when a same-named cross-project skill matches the keyword query as well as the project version (raw match quality, ignoring boost), it surfaces alongside with its `source` field marked. You see "the skill from your repo *and* its cousin from another repo, in case you meant the other one."

Same logic applies to `select:` lookups — project version comes first; non-project siblings are appended.

## Frontmatter contract

Required: `name`, `description`. Optional: `whenToUse`, `triggers`. Embedded colons and quotes in unquoted prose-style descriptions are tolerated via a recovery pass (matches Claude Code's permissive parsing). Malformed YAML still throws — see `tests/parseFrontmatter.test.ts` for examples.

## Development

```bash
git clone https://github.com/PettHa/mcp-skill-search
cd mcp-skill-search
npm install      # `prepare` script auto-runs `npm run build`
npm test         # Vitest, 80+ tests
npm run dev      # rebuild on change
```

## Provenance

The scoring algorithm is a 1:1 port of Claude Code's `ToolSearchTool.searchToolsWithKeywords` (v2.1.88). The names-only env var (`SLASH_COMMAND_TOOL_CHAR_BUDGET`) is from `SkillTool/prompt.ts:31` — undocumented, may change in future Claude Code versions. License: MIT.

## Status

Private/local repo as of writing. Public release pending.
