# Changelog

Each mod keeps its own version in `mods/<mod>/.claude-plugin/plugin.json`.
Repository releases are tagged `vX.Y.Z` and list the mod versions they ship.

## [0.9.3] - 2026-10-15

| Mod | Version |
| --- | --- |
| `open-items` | 0.6.1 |
| `subagent-dispatch` | 0.6.3 |
- `open-items` 0.6.1:
  - Changed: the pane's count bar is drawn in `▆` in each kind's color instead
    of colored spaces, as every bar is now.
- `subagent-dispatch` 0.6.3:
  - Changed: the stats summary's token and spawn bars are drawn in `▆` like
    the list's, instead of colored spaces.

## [0.9.2] - 2026-10-14

| Mod | Version |
| --- | --- |
| `subagent-dispatch` | 0.6.2 |
- `subagent-dispatch` 0.6.2:
  - Changed: the per-session usage record is called "usage details" in the
    messages and docs (「用量明細」 in Chinese, was 「帳本」), paired with the
    day rows. The `ledger` setting and the stored data keep their names.

## [0.9.1] - 2026-10-14

| Mod | Version |
| --- | --- |
| `subagent-dispatch` | 0.6.1 |
- `subagent-dispatch` 0.6.1:
  - Fixed: `/subagent-dispatch stats 14` (or any length other than 1, 7, 30 or
    90 days) showed its period length as `1 day`. It now shows `14 days`, and
    `p` goes on to 30.

## [0.9.0] - 2026-10-14

| Mod | Version |
| --- | --- |
| `subagent-dispatch` | 0.6.0 |
- `subagent-dispatch` 0.6.0:
  - Changed: the stats period is a window you move. `p` changes its length and
    keeps its last day, `h` / `l` move it back and forth by that length, and
    `t` jumps to today alone. `j` / `k` and choosing a single day are gone:
    a day is a 1-day period, its cell orange on the heatmap.
  - Changed: the summary drops its card frames: the tokens and the spawns are
    two lines each, the total with its parts at the right over a bar across the
    pane. `Updated` moves to the title line.
  - Changed: the overview lists one row a line under column names: tokens,
    share, a bar, sub share, spawns, the three kinds, two columns of the
    grouping's own (such as `Last`, the last day the row used tokens) and cache
    read. Columns that do not fit are dropped, least important first. The list
    shows ten rows and `m` ten more.
  - Changed: an opened row shows the period to read only and the same summary;
    bars in rows above and below each other are drawn in `▆`.
  - Changed: the heatmap legend shares the line under the grid with the
    period's mark, item by item as far as it fits. The `Selected` item is
    gone; a 1-day period on today reads `Today, Wed Oct 14`.
  - Changed: the Chinese cache line reads `快取讀取 182M 另計`.
  - Fixed: an opened row's spawn names are cut to the width by cells, so mixed
    Chinese and English names no longer wrap.

## [0.8.2] - 2026-10-14

| Mod | Version |
| --- | --- |
| `subagent-dispatch` | 0.5.2 |
- `subagent-dispatch` 0.5.2:
  - Changed: the heatmap's cells are no longer buttons; choose a day with
    `j` / `k`. Resizing redraws faster, and Tab no longer steps through every
    cell.

## [0.8.1] - 2026-10-14

| Mod | Version |
| --- | --- |
| `subagent-dispatch` | 0.5.1 |
- `subagent-dispatch` 0.5.1:
  - Fixed: the stats pane redraws slowly while the terminal is resized. A
    redraw within 30 seconds of the last read of the ledgers reuses it instead
    of reading every key again; this session's own writes and opening the pane
    read them afresh.

## [0.8.0] - 2026-10-14

| Mod | Version |
| --- | --- |
| `subagent-dispatch` | 0.5.0 |
- `subagent-dispatch` 0.5.0:
  - Added: a calendar heatmap of tokens per day heads the stats pane, as many
    weeks as the pane is wide (up to 53). Click a cell, or press `j` / `k`, to
    make the period that day; `p` lets the day go.
  - Added: each settled day is summed into a day row kept 366 days, so the
    heatmap outlives the 90-day ledgers.
  - Added: the first session after installing or updating rebuilds a ledger
    from the local transcripts of each session that has none, in the
    background, with a toast saying how many it added;
    `/subagent-dispatch backfill` runs it again.

## [0.7.0] - 2026-10-13

| Mod | Version |
| --- | --- |
| `subagent-dispatch` | 0.4.0 |
- `subagent-dispatch` 0.4.0:
  - Changed: the ledger keeps the main session's tokens per day, so a period
    counts only the main session's tokens of its own days. Ledgers written
    before 0.4.0 count their main session tokens on the day of their last write.
  - Added: `Period` in the stats pane has 1 day (today) before 7, 30 and 90.

## [0.6.3] - 2026-10-13

| Mod | Version |
| --- | --- |
| `subagent-dispatch` | 0.3.3 |
- `subagent-dispatch` 0.3.3:
  - Changed: where the cache read line and its time do not fit on one line,
    the time goes on the next line, at the left.

## [0.6.2] - 2026-10-13

| Mod | Version |
| --- | --- |
| `subagent-dispatch` | 0.3.2 |
- `subagent-dispatch` 0.3.2:
  - Added: the cache read line under the cards ends with when the pane last
    read the ledgers (`Updated 19:04:05`).

## [0.6.1] - 2026-10-13

| Mod | Version |
| --- | --- |
| `subagent-dispatch` | 0.3.1 |
- `subagent-dispatch` 0.3.1:
  - Changed: an open stats pane is drawn again a second after a step or a
    spawn is recorded, instead of only when one of its buttons is pressed.

## [0.6.0] - 2026-10-13

| Mod | Version |
| --- | --- |
| `subagent-dispatch` | 0.3.0 |
- `subagent-dispatch` 0.3.0:
  - Added: the stats pane's top line names it, `subagent-dispatch stats`,
    over a rule, as in open-items.
  - Changed: the hint line sits at the bottom of a docked pane and no longer
    lists `p`, `g`, `s` or `m`, which the buttons already show.
  - Changed: the period leads its line, with the days it covers after it; the
    grouping heads the list, under a rule.
  - Changed: at any width each row is a card: its name on one line (cut by
    width, so Chinese never wraps it or the count) with its spawns at the
    right, then its bar with the tokens and share at the right. Grouped by
    session, a row is named by its prompt, with its time and repo below.
  - Changed: an opened row's back button shows its key (`b`), the crumb no
    longer wraps under a long name, and a rule parts the cards from the list.
  - Changed: a row with no spawns (a model only the main session used, or the
    main session row) lists its sessions in the spawns' table, with their
    start dates, sorted by tokens or by time.

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
