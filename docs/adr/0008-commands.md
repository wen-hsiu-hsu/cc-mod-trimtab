# Commands: one `/<mod>` per mod, with the same subcommands

- Status: accepted
- Date: 2026-10-12

- Each mod registers `/<mod>` with the same subcommands: `status`, `set`, `unset`, `on`, `off`. One-off actions are named subcommands (`/session-keeper handoff`, `/session-keeper stats`, `/project-memory run`).
- Renamed commands keep no alias (an alias runs into the same name clash again): `/redispatch` → `/subagent-dispatch redispatch`, `/guard-allow` → `/tool-guard allow`, `/scrub-history` → `/secret-scrub history`, `/project-memory` → `/project-memory run`.
- No command starts with `agent-` (2026-10-12): Claude Code's typeahead treats an id starting with `agent-`, `file-`, `mcp-resource-` or `mcp-template` as an agent, file or MCP resource suggestion and draws it on one line with an icon, so `/agent-dispatch` was drawn as `* /agent-dispatch – …`. The mod name is the command name, so `agent-dispatch` was renamed `subagent-dispatch` as a whole.
- No generic names such as `/handoff`: when the user has a command or skill of the same name, the mod's registration is refused (hit on 2026-10-11 with mattpocock/skills' `/handoff`). A failed registration shows a toast, not only a debug log line.
