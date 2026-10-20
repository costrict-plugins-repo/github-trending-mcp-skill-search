---
name: restore-skill-descriptions
description: Reverse `/optimize-skill-context` — clear SLASH_COMMAND_TOOL_CHAR_BUDGET so Claude Code resumes loading full skill descriptions in the system prompt.
whenToUse: When you've previously run `/optimize-skill-context` and now want descriptions back (e.g. you've pruned skills and the budget cost is gone, or you're debugging skill discovery).
---

# restore-skill-descriptions

This skill reverses the env-var change made by `/optimize-skill-context`. After running, Claude Code resumes its default behavior: skill descriptions are loaded into the system prompt up to ~1% of context-window budget, with `'description_trimmed'` or `'names_only'` fallback when over.

## Run this skill

Detect platform. Always show the user what you're about to run and ask for confirmation.

### Windows (PowerShell)

Clear the persistent env var:

```powershell
setx SLASH_COMMAND_TOOL_CHAR_BUDGET ""
```

(Empty string removes the value from `HKCU\Environment` for new processes. The current shell session keeps its old value until restart.)

### macOS (zsh) / Linux (bash)

Remove the line that `/optimize-skill-context` appended. Use `sed` for both:

```bash
# zsh (macOS)
sed -i.bak '/SLASH_COMMAND_TOOL_CHAR_BUDGET/d' ~/.zshrc

# bash (Linux)
sed -i.bak '/SLASH_COMMAND_TOOL_CHAR_BUDGET/d' ~/.bashrc
```

The `.bak` flag creates a backup (`~/.zshrc.bak` / `~/.bashrc.bak`) in case the user wants to revert.

For other shells, instruct the user to remove the export line manually from their rc file.

### Confirm + restart

After the command succeeds, tell the user: **"Restart Claude Code (or your IDE) to pick up the change. Skill descriptions will reappear in the system prompt on the next session."**

## Notes

- This skill is idempotent — running it when the var isn't set is a no-op.
- It only removes the export line if it matches the pattern `/SLASH_COMMAND_TOOL_CHAR_BUDGET/`. If the user added unrelated lines containing that string, advise them to edit the rc file manually.
