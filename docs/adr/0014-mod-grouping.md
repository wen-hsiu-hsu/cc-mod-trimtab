# Group features into mods by shared data or a shared event

- Status: accepted
- Date: 2026-10-09

| Mod | Contains | Why |
| --- | ---- | ---- |
| `self-check` (renamed from nudges) | Repeated failure, done without verifying | Its audience is Claude, not the user; it looks at results after running and `classic.Stop`, sharing no code with the guards; on error it just skips; "done without verifying" shows as a Stop hook error, so it must be separate to be disabled on its own in `/plugin` |
| `session-keeper` | Cache state, keep warm, new-task gate, handoff, reading and attaching progress | Shares usage, TTL and idle timing; the keep-warm fork must move the cache expiry |
| `project-memory` | Project notes, writing progress | Upstream produces both in one request; its rules feed the guards |
| `tool-guard` (renamed from shell-guard) | Fixed rules (cmd-rewrite, learned guards, bash-edit-snapshot deferred) | All act before a tool runs and share command parsing, impact preview and the confirm panel; learned guards look beyond Bash, so `shell-guard` was the wrong name |
| `subagent-dispatch` (renamed from agent-watch, agent-dispatch) | Watching and redispatching background agents, usage ledger, dispatch reminders | All about dispatching agents, sharing the Agent call and `agent.spawn` data (type, model, description). session-keeper also listens to `turn.step`, but it cannot see the agent type the ledger needs |
| Separate | secret-scrub, output-trimmer, open-items | secret-scrub must be first, and anything merged into it would also see unmasked text; output-trimmer and open-items share no data with others. open-items attaches its own list to Claude after loading, so handoff and progress need not carry open items |

Each feature in a merged mod has its own switch, and one failing feature must not take down the whole mod.
