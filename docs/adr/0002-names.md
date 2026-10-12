# Names: `cc-mod-trimtab`, and mods are not renamed once public

- Status: accepted
- Date: 2026-10-11

- **The repo and the marketplace share the name `cc-mod-trimtab`**: the `cc-mod-` prefix tells people it is a Claude Code mod. Renamed from `trimtab` on 2026-10-11. `ballast` was not used because a similar Claude Code plugin already has it (`svy04/ballast`). A web search found no Claude Code, MCP or agent project with the same name (no GitHub-wide search was done).
- **Mod names do not change once public, as a rule**: a rename breaks users' `enabledPlugins` and `/config` values (keyed by `<mod>@cc-mod-trimtab`), and the `$.store` file does not move with it (the hash in its file name is per plugin). Rename only when the name itself causes a problem, mark it as a breaking change in the CHANGELOG, and say what users have to do.
- Before release, `shell-guard` became `tool-guard`, `agent-watch` became `agent-dispatch` and `nudges` became `self-check`. After release, `agent-dispatch` became `subagent-dispatch` ([0008](0008-commands.md)).
