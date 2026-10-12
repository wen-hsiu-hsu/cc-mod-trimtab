# Changelog

Each mod keeps its own version in `mods/<mod>/.claude-plugin/plugin.json`.
Repository releases are tagged `vX.Y.Z` and list the mod versions they ship.

## [Unreleased]

| Mod | Version |
| --- | --- |
| `agent-dispatch` | 0.2.0 |
| `open-items` | 0.3.2 |

- Added: `agent-dispatch` records each spawn and the main session's token use
  in a local ledger, one key per session (repo, start time, first prompt, and
  per spawn the description, type, named and resolved model, fork, background,
  tokens, steps and duration; the latest 500 spawns per session).
  `/agent-dispatch stats [days]` opens a pane with a summary and rows grouped by
  repo, session, model or agent type down to each spawn, over 7, 30 or 90 days.
  `--text`, a `-p` run, or a pane that cannot be placed prints it as text. The
  `ledger` setting (default on) turns recording off. Ledgers not written to for
  90 days are deleted at session start.
- Changed: `agent-dispatch` no longer lists running background agents above the
  input box; it shows only interrupted ones, with `[Redispatch]` and `[Dismiss]`.
- The stats pane lays its rows out by the body's columns (one line from 80
  columns, two below), draws terminal bars as colored cells, opens a row by its
  name with `‹ Back` to return, and writes dates as `Oct 12` / `10/12`. A session
  is named after its first prompt that is not a slash command, and after
  `/clear` gets its own start and name; an agent that outlives `/clear` keeps
  its steps on its spawn.
- The stats pane opens on two cards, tokens split into the main session and
  subagents, and spawns split into named model, default model and fork, three
  kinds that add up (a fork is no longer counted as taking the default; the
  `--text` summary says the same). An opened row heads with its own cards and
  lists its spawns as a table, most tokens first (or newest, or longest run),
  ten at a time; a spawn opens in place to its type, model, run and session.
  The cards sit side by side from 60 body columns; an opened session splits its
  token card by the main session's models; a wide pane puts the period and
  grouping on its top line and names the table columns. Period, grouping and
  sort switch in place (one cycling button with `p`, `g`, `s` in the terminal,
  segments on desktop), so nothing below them moves. `N more` has the hotkey
  `m`, and the cache read line is shorter.
- The stats pane follows `DESIGN.md`: a switch's current value is bold rather
  than yellow (yellow now only means something waits on you), `N more` is no
  longer yellow, and desktop bars take the subagent cyan of the terminal. The
  interrupted-agents toast stays 8 seconds, and the command's argument hint
  follows the interface language.
- `open-items` follows `DESIGN.md`: the pane is titled `open-items`, takes the
  focus and closes with `Esc`, lists its keys on its last line, and copies with
  `c`. A `/open-items` that cannot be registered says so in a toast.

## [0.1.1] - 2026-10-11

| Mod | Version |
| --- | --- |
| `agent-dispatch` | 0.1.1 |
| `open-items` | 0.3.1 |
| `output-trimmer` | 0.1.1 |
| `project-memory` | 0.1.1 |
| `secret-scrub` | 0.2.1 |
| `self-check` | 0.1.1 |
| `session-keeper` | 0.3.1 |
| `tool-guard` | 0.2.1 |

- Fixed: session values (`/<mod> set --session`, `/<mod> on`, `/<mod> off`)
  set in one session were overwritten when another session changed a session
  value of the same mod. They are now stored per session id; a session's values
  are dropped once nothing wrote them for a week. Session values set before the
  update are not carried over.
- Fixed: the first-use notice could show again in a session after another
  session of the same mod showed its own.

## [0.1.0] - 2026-10-11

First public release.

| Mod | Version |
| --- | --- |
| `agent-dispatch` | 0.1.0 |
| `open-items` | 0.3.0 |
| `output-trimmer` | 0.1.0 |
| `project-memory` | 0.1.0 |
| `secret-scrub` | 0.2.0 |
| `self-check` | 0.1.0 |
| `session-keeper` | 0.3.0 |
| `tool-guard` | 0.2.0 |

- Layered settings (session, `.claude/cc-mod-trimtab.local.json`,
  `.claude/cc-mod-trimtab.json`, user, default), with `/<mod> status`, `set`
  and `unset`. The committed repo file can only make protection stricter or
  spending lower.
- Features that call a model are off by default. `/<mod> on [feature] [time]`
  turns one on for the current session (default 2h, up to 24h); `off` turns it
  off.
- UI language: English by default, Traditional Chinese with `"*": { "language": "zh-TW" }`
  in `~/.claude/cc-mod-trimtab.json`. Manifests and `/config` titles are English.
- Personal habits (commit title format and similar checks) are settings, off by
  default.
