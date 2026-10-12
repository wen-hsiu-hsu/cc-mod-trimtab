# Memory goes into Claude Code's built-in memory; progress and the handoff summary share one file

- Status: accepted
- Date: 2026-10-09

- **Notes go into the built-in memory**: one file per entry plus the `MEMORY.md` index, so there is one memory, loaded by Claude Code itself with no mod injecting it. Occurrence counts live in `project-memory`'s `$.store`; once a rule is in CLAUDE.md its memory file is deleted, to avoid duplicates.
- **Progress and the handoff summary are one file**: `project-memory` updates progress when it distills, `session-keeper` overwrites it with a handoff summary, and only `session-keeper` reads it and attaches it to a new session. No mod has to read another's `$.store`. The file is temporary, so it is not in the `memory/` folder.

Decided after comparing Mem0, Letta sleep-time, Zep / Graphiti, Copilot Memory and Claude Code's official memory docs:

- Ask the user before writing a rule into CLAUDE.md (officially CLAUDE.md is written by people); procedures become skills without asking.
- `session.end` gets only about 1.5 seconds on exit, too short to distill; not worked around.
- Counts are "confirmed by how many different sessions"; expiry counts working days (days with a session in the repo); deletion becomes marking invalid (`invalidated`, `superseded_by`), with the file deleted after 90 days.
- Memories record related file paths, and a missing file is flagged to the model (a simplified version of Copilot's source verification).
- No distilling before a handoff: mods cannot call each other, so `session-keeper` writes the handoff summary itself from `$.session.messages()`.
- Upstream: `distill.ts`, `notes.ts`, `promote.ts`, `transcript.ts`, `progress.ts`.
