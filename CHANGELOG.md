# Changelog

Each mod keeps its own version in `mods/<mod>/.claude-plugin/plugin.json`.
Repository releases are tagged `vX.Y.Z` and list the mod versions they ship.

## [Unreleased]

- `subagent-dispatch` 0.3.0:
  - Added: the stats pane's top line names it, `subagent-dispatch stats`,
    over a rule, as in open-items.
  - Changed: the hint line sits at the bottom of a docked pane and no longer
    lists `p`, `g`, `s` or `m`, which the buttons already show.
  - Changed: a list's column names sit under a rule and above a blank line;
    grouped by session, a blank line parts the rows.
  - Changed: a row with no spawns (a model only the main session used, or the
    main session row) lists its sessions with a bar each, most tokens first.

## [0.5.0] - 2026-10-13

| Mod | Version |
| --- | --- |
| `open-items` | 0.6.0 |
- `open-items` 0.6.0:
  - Changed: the pane groups items by kind, each group framed by a line in its
    color; `g` switches to no groups or to groups by branch, `s` sorts oldest
    or newest first. The Deferred group starts folded (`m` shows it) when
    other groups are listed.
  - Changed: every item shows its whole text with its age and branch below,
    not only the focused one.
  - Added: a bold count on top, with a bar split by kind and a legend.
  - Changed: `v` lists what the repo resolved in the last 7 days, from any
    session, instead of this session's last 5; decisions and drops show their
    reason. The empty pane says how many were resolved in that time.
  - Changed: the copy button reads `Copy all`.
  - Added: the pane's name and a rule along its top line.
  - Changed: the action keys sit two lines below the list, and with the hint
    line at the bottom of a docked pane.

## [0.4.0] - 2026-10-13

| Mod | Version |
| --- | --- |
| `open-items` | 0.5.0 |
| `session-keeper` | 0.3.3 |
| `subagent-dispatch` | 0.2.1 |
| `tool-guard` | 0.2.3 |
- `open-items` 0.5.0:
  - Changed: the pane shows one line per item (id, kind, text) instead of
    each item's buttons. Tab or ↑↓ moves between items and opens the one you
    are on to its whole text, age and branch; `d` marks it done, `x` won't do,
    `q` quotes it. A closed item stays in place, struck through, and the same
    key opens it again. Kinds are colored: Decide yellow, Bug red, Question
    cyan, Deferred dim.
  - Added: `v` switches the pane to the recently resolved items, where `d`
    reopens one.
  - Changed: the copy button reads `Copy whole list`.
- `session-keeper` 0.3.3, `subagent-dispatch` 0.2.1, `tool-guard` 0.2.3:
  - Changed: a pane's hint line draws each key in the default color and what
    it does dimmed.

## [0.3.0] - 2026-10-13

| Mod | Version |
| --- | --- |
| `open-items` | 0.4.0 |
| `project-memory` | 0.2.0 |

- `open-items` 0.4.0:
  - Changed: `/open-items stats` decides a miss at the next prompt. An answer
    that ends on a question without a `track` call counts only when you reply
    with more than 14 characters; a short reply ("ok", "commit") or a prompt you
    did not type is not a miss. It shows the questions, the untracked ones and
    the misses. The earlier counts are reset, as most of their misses were
    confirmations.
  - Changed: the `track` tool asks a deferred item to say when to come back
    to it.
- `project-memory` 0.2.0:
  - Added: automatic distilling is skipped while the 5-hour or 7-day usage
    limit is used past `max_rate_used` (default 80)%. `status` shows why;
    a conversation `/clear` ended meanwhile is dropped. `run` is not limited,
    and without a subscription nothing changes.
  - Added: `/project-memory list`, one line per memory and rule with the
    sessions that confirmed it, the last confirmed date and its status.
  - Added: a related file can carry an anchor string; each distill checks the
    string is still in the file and flags it to the model when it is not.
    Memory files write it as `` `path` → `anchor` ``; older files still read.
- Docs: the README is now a short overview. Each mod's behaviour, commands,
  settings, cost and known limitations moved to `docs/mods/<mod>.md` (and
  `.zh-TW.md`); install and settings moved to `docs/install.md` and
  `docs/settings.md`. Corrected: the `open-items` decision log keeps the latest
  300 entries; documented the ranges of the `output-trimmer` thresholds, the
  built-in `commit_pattern` format, and that `ledger` is not in `/config`.

## [0.2.0] - 2026-10-12

| Mod | Version |
| --- | --- |
| `open-items` | 0.3.2 |
| `session-keeper` | 0.3.2 |
| `subagent-dispatch` | 0.2.0 |
| `tool-guard` | 0.2.2 |

- Changed (breaking): `agent-dispatch` is renamed `subagent-dispatch`, and its
  command `/subagent-dispatch`. The typeahead drew `/agent-dispatch` as an
  agent suggestion (`* /agent-dispatch – …` on one line), because Claude Code
  treats a suggestion whose id starts with `agent-` as one. Install it again
  with `/plugin install subagent-dispatch@cc-mod-trimtab`, and move its
  settings from `agent-dispatch` to `subagent-dispatch` (in
  `~/.claude/cc-mod-trimtab.json`, repo files and `pluginConfigs`).
- Added: `subagent-dispatch` records each spawn and the main session's token use
  in a local ledger, one key per session (repo, start time, first prompt, and
  per spawn the description, type, named and resolved model, fork, background,
  tokens, steps and duration; the latest 500 spawns per session).
  `/subagent-dispatch stats [days]` opens a pane with a summary and rows grouped by
  repo, session, model or agent type down to each spawn, over 7, 30 or 90 days.
  `--text`, a `-p` run, or a pane that cannot be placed prints it as text. The
  `ledger` setting (default on) turns recording off. Ledgers not written to for
  90 days are deleted at session start.
- Changed: `subagent-dispatch` no longer lists running background agents above the
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
- `tool-guard` follows `DESIGN.md`: the confirm pane is titled
  `tool-guard confirm`, and a block toast reads `tool-guard: blocked …` like
  every other toast's `<mod>: ` start.
- `session-keeper`'s handoff toasts start with `session-keeper: ` like its
  other toasts.

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
