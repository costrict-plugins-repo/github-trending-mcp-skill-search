---
name: optimize-skill-context
description: Free up Claude Code's skill-description budget by setting SLASH_COMMAND_TOOL_CHAR_BUDGET=1. Skills become names-only in system prompt; descriptions are fetched on-demand via skill_search. Slash-commands keep working.
whenToUse: Run once after `/plugin install mcp-skill-search`. Best when you have many skills (50+) or long descriptions and want to reclaim that ~1% of context window.
---

# optimize-skill-context

This skill sets the `SLASH_COMMAND_TOOL_CHAR_BUDGET` environment variable to `1`, which forces Claude Code's `SkillTool` into `'names_only'` mode. After a Claude Code restart, skill descriptions stop loading into the system prompt — you save ~1% of the context window. The `skill_search` MCP tool from this plugin remains available to fetch any skill's full description on demand.

## What stays working

- `/<skill-name>` slash-commands — unaffected, descriptions are not required for invocation
- The `skill_search` tool — finds skills by keyword, exact name, or required-term filter
- Bundled (built-in) Claude Code skills — they always keep their descriptions

## What changes

- Skills appear in system prompt as `- skill-name` instead of `- skill-name: description`
- Claude must use `skill_search` (or rely on memory) to recall what a skill does

## Run this skill

Detect the user's platform and apply the appropriate change. **Always show the user what you're about to do and ask for confirmation before running shell commands** — this modifies persistent shell state.

### Step 1 — show the impact

Use the `skill_search` tool with `query="select:nonexistent"` and `max_results=1` to retrieve `total_skills`. Estimate the budget impact:

```
You have N skills. Setting SLASH_COMMAND_TOOL_CHAR_BUDGET=1 will free roughly N × 150 chars from your system prompt on every turn.
Slash-commands continue to work; skill_search serves descriptions on demand.
```

### Step 2 — apply per platform

**Windows (PowerShell):**

```powershell
setx SLASH_COMMAND_TOOL_CHAR_BUDGET 1
```

(`setx` writes to the user's persistent environment via `HKCU\Environment`. New processes pick it up; the *current* shell does not — Claude Code must be restarted.)

**macOS (zsh, default since Catalina):**

Append to `~/.zshrc`:

```bash
echo 'export SLASH_COMMAND_TOOL_CHAR_BUDGET=1' >> ~/.zshrc
```

**Linux (bash):**

Append to `~/.bashrc`:

```bash
echo 'export SLASH_COMMAND_TOOL_CHAR_BUDGET=1' >> ~/.bashrc
```

For other shells (fish, nu, ksh, etc.), advise the user to add the equivalent export to their shell's rc file manually.

### Step 3 — confirm registry write

Confirm the variable was written to the registry / shell config:
- Windows: `[Environment]::GetEnvironmentVariable("SLASH_COMMAND_TOOL_CHAR_BUDGET", "User")` — must return `1`
- Unix: re-source the rc file or open a new shell, then `echo $SLASH_COMMAND_TOOL_CHAR_BUDGET` — must return `1`

### Step 4 — restart instructions (READ THIS CAREFULLY — common pitfall)

**On Windows:** `setx` writes to the registry but only affects processes launched *after* the command. The currently-running Claude Code / IDE process inherited its environment block at startup and will NOT pick up the new variable from a "Reload Window" or "Restart Extension Host" — those only restart the renderer / extension host, not the root `Code.exe` process. The root process keeps its old environment block and passes it down to every new child it spawns.

The user MUST do a **full exit**:

1. Close all VSCode / Claude Code windows (every workspace, every monitor, every virtual desktop).
2. Check the system tray (bottom-right on Windows). VSCode often leaves a quick-launch icon — right-click → Quit.
3. Verify in an *external* PowerShell (Win+R → `powershell`, NOT a terminal inside VSCode):
   ```powershell
   Get-Process Code -ErrorAction SilentlyContinue
   ```
   This must return nothing. If a `Code.exe` is still alive, kill it: `Get-Process Code | Stop-Process -Force`.
4. Re-launch Claude Code / VSCode from the Start Menu (NOT from an existing terminal — that terminal still has the old environment).
5. Open a new chat session and verify the variable propagated to the *process* scope:
   ```powershell
   [Environment]::GetEnvironmentVariable("SLASH_COMMAND_TOOL_CHAR_BUDGET", "Process")
   ```
   Must return `1`. The User scope being `1` is not sufficient — the running process must see it too.

**On macOS / Linux:** the env var is written to the rc file. New shells pick it up; existing ones don\'t. If Claude Code was launched from a terminal, you need to:
1. Quit Claude Code / your IDE entirely (not just close the window).
2. Open a new terminal (so it sources the updated rc file).
3. Re-launch Claude Code from that new terminal — or from the OS launcher, since the OS launcher reads login-shell env which now includes the new export.

### Step 5 — confirm names-only mode is active

After restart, in a new chat session:
1. The system-prompt skill list should now show entries as `- skill-name` (without `: description`). If descriptions are still inline, the variable did NOT propagate — go back to Step 4.
2. Call `skill_search` with any query. The response\'s `setup_hint` field should be **absent** (when present, it means the server still doesn\'t see the variable).
3. Run `/mcp` to confirm `skill-search` is still loaded.

### Step 6 — reverse instructions (always show)

Mention how to undo:

- Windows: `setx SLASH_COMMAND_TOOL_CHAR_BUDGET ""` (clears the persistent var) or run `/restore-skill-descriptions` from this plugin.
- Unix: remove the `export SLASH_COMMAND_TOOL_CHAR_BUDGET=1` line from the rc file, or run `/restore-skill-descriptions`.

## Notes

- `SLASH_COMMAND_TOOL_CHAR_BUDGET` is an undocumented Claude Code env var (as of v2.1.x). Behavior may change in future versions.
- This skill does not affect MCP tool budgets, only the SkillTool's description listing.
- Already-running Claude Code processes are unaffected until *full* restart. On Windows, "Reload Window" is NOT enough — the root `Code.exe` keeps its old environment block. Diagnostic: if `[Environment]::GetEnvironmentVariable(...)` returns `1` for User scope but empty for Process scope, the running process predates the `setx` call.
