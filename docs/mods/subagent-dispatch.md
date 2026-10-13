# subagent-dispatch

English | [繁體中文](subagent-dispatch.zh-TW.md) · [All mods](../../README.md#the-mods)

Brings interrupted background agents back in one key press, and shows where your tokens went: the main session against subagents, by repo, session, model and agent type, down to each spawn.

| Uses a model | CLI | Desktop | Cloud |
| --- | --- | --- | --- |
| No | Yes (phone: status line only) | Yes | No |

## Redispatch

When a background agent is interrupted, it is shown above the input box: press `[Redispatch]` (`r`) or run `/subagent-dispatch redispatch` to put a redispatch instruction into the input box (each agent's original prompt, type and model), or `[Dismiss]` (`d`). Nothing is shown while agents run.

## Commands

| Command | What it does |
| --- | --- |
| `/subagent-dispatch redispatch` | Put the redispatch instruction for interrupted agents into the input box |
| `/subagent-dispatch stats [--text] [days]` | Open the usage pane (see below) |
| `/subagent-dispatch backfill` | Read the transcripts of sessions with no ledger into ledgers again (see [Backfill](#backfill)) |
| `/subagent-dispatch status`, `set`, `unset` | See and change settings |

## Usage ledger

Each session keeps its own ledger in the plugin's `$.store` (one key per session, shared across repos). It records:

- The session: its repo (the main working tree, so worktrees group together), its start time and the first 40 characters of its first prompt that is not a slash command, which together name it (`Oct 12 02:11 review the diff…`), and the main session's tokens per model for each day (local date). After `/clear` the new session gets its own start and name; mods cannot read the session's own title.
- Each spawn (the latest 500 per session): description, agent type, the model the call named (or the default) and the model it resolved to, whether it was a fork or ran in the background, input / cache write / cache read / output tokens, steps and duration. Steps of an agent the ledger never saw spawn (one spawned before a hot reload) are listed as `unknown`.

Ledgers no session has written to for 90 days are deleted when a session starts. A ledger from before 0.4.0 has no days: its main session tokens all count on the day it was last written.

Before that, the same session start sums each settled day (the day before yesterday or earlier) into a day row: the main session's tokens by model, the spawns' tokens by model and the spawn counts, all sessions together. A row is computed whole from the ledgers and written once; rows are kept 366 days, so the heatmap reaches back a year after the ledgers are gone.

`/subagent-dispatch stats [days]` (1-90 calendar days, default 30, today included) opens a pane over every session. The main session counts only its tokens of those days; a spawn counts on the day of its last step, so one that runs past midnight counts whole on the later day.

- The top line is `subagent-dispatch stats` with a rule across the rest of it. The hint line sits at the foot of a docked pane and lists only the keys the buttons do not show (`Tab`, `Enter`, `Esc`). Under the heatmap, `Period` and then the days it covers, with `j: ‹ Prev day` and `k: Next day ›` at the right (on the next line where they do not fit).
- A calendar heatmap heads the overview, one cell a day, a column a week, Monday at the top and today in the last column: as many weeks as the pane is wide, up to 53 (38 in 80 columns, 53 from 110; none below 12 columns), whatever the period. Each cell is the day's tokens (main session and subagents, cache read not counted): a gray `·` for a day with no record (before the backfill, a deleted transcript, another machine), a gray `■` for a recorded day with no use, and four shades of cyan by quartile of the days drawn. Months label the top, `Mon` / `Wed` / `Fri` the left; under the grid a bracket marks the weeks the period covers, then the legend and the day with the most tokens. The last 89 days come from the ledgers, as the rest of the pane counts them; days before from the day rows. On desktop it is one Svg.
- Press `j` / `k` to choose a day (the cells are not clickable): `j` chooses today first and then steps back a day at a time, to the first column; `k` steps forward to today. The period becomes that day (`‹ Fri Oct 2 ›`, `1 day · p back to 30 days`), the chosen cell turns orange with `▲ Fri Oct 2` under its column, and the cards, cache read and rows count that day alone. A day with no use or no record says so in place of the cards; a day only a day row still holds shows its cards and says its sessions are gone. `p` lets the day go first, and then steps the period as before.
- Two cards, side by side from 60 body columns and stacked when narrower. **Tokens** (input + cache write + output) with a bar split into the main session (purple) and subagents (cyan) and the subagent share. **Spawns** by where the model came from, three kinds that add up to the total: named a model (yellow, with how many named Opus), the default model (gray), and forks (green, which run on the main session's model). Cache read (not counted) is a short line under the cards, with the time the pane last read the ledgers at its right (`Updated 19:04:05`), or on the next line at the left where both do not fit.
- Rows grouped by repo (by folder name), session, model or agent type, under a rule headed by the `Group by` switch. At any width a row is a card: its name on one line (cut short when long, Chinese included) with its spawns at the right, then its bar (Svg on desktop, colored cells in the terminal) with its tokens and share at the right. Grouped by session, the name is the first prompt, and the session's time and repo go on a line between.
- `Period`, `Group by` and `Sort` switch in place, so nothing below them moves: in the terminal each is one button showing `‹ value ›` that steps to the next value and wraps (`p`, `g`, `s`), on desktop a segment per value, the same key on the segment after the current one.
- Press a row's name to open it: `b: ‹ Back` and the crumb (`model ›` and the row's name, only the name cut short), the same two cards for that row, then under a rule `Sort` and its spawns as a table (a dot in the color of where the model came from, description, bar, tokens, date), most tokens first; `Sort` switches to newest or longest run first. An opened session splits its token card by the main session's models. Ten are listed, and `N more` (`m`) lists ten more. Press a spawn to open it in place to its type, model, run (background, steps, duration) and session; one at a time. A row with no spawns (the main session row of the type grouping, or a model only the main session used) lists instead the sessions its tokens came from in the same table (prompt, bar, tokens, start date), sorted by tokens or by time. `b` returns.
- `Period` is 1 day (today), 7, 30 or 90 days.
- While the pane is open it follows new use: a second after a step or spawn is recorded, it is drawn again from the ledgers. Other redraws (a resize, a key) within 30 seconds of the last read reuse it, so `Updated` is when the ledgers were last read; another session's use shows at the next read.

In a narrow terminal the pane opens above the input box instead of beside the conversation. `/subagent-dispatch stats --text [days]` prints the same report as text. `stats` prints it too in a `-p` run, or when no pane can be placed.

Not included: the mods' own model calls (`$.model.fork` / `$.model.complete`), cloud sessions (they do not load mods), and sessions older than the transcripts this machine kept when the mod was installed.

## Backfill

Claude Code has no install event, so the first session (not a `-p` run) to start without a `backfill` mark in the store reads the local transcripts in the background, and the session does not wait for it. Each session under the config directory's `projects/` (`$CLAUDE_CONFIG_DIR`, or `~/.claude`) that has no ledger yet gets one rebuilt from its transcript and its subagents' (`<session>/subagents/agent-*.jsonl` with their `.meta.json`): its start, last write, first prompt and repo, the main session's tokens per day and model (a reply split over several lines counts once), and each spawn with its type, the model it named, fork, background, tokens and steps. A session that already has a ledger, and the current session, are left as recorded live. One file at a time; a file over 4 MiB is read through `cat` (skipped where no process can be run, such as desktop); a file that fails is skipped and logged to the debug log. Then the day rows are computed, and a toast says how many sessions were added (`subagent-dispatch: added 221 session(s) from the transcripts (since Sep 15)`); nothing is shown when none were.

While one session runs it, the mark says `running` and other sessions leave it alone for 10 minutes. `/subagent-dispatch backfill` runs it again whatever the mark says, for a run that stopped or a new machine. Nothing runs while `ledger` is off.

## Settings

| Key | Default | Repo file | Meaning |
| --- | --- | --- | --- |
| `ledger` | on | Cannot be set | Record spawns and token use. Off records nothing; `stats` still reads what exists |

`ledger` is not shown in `/config`; set it with `/subagent-dispatch set ledger false --local` or in `~/.claude/cc-mod-trimtab.json`. For the layers, see [Settings](../settings.md).

## Known limitations

- The backfill reads only this machine's transcripts, and Claude Code deletes transcripts after 30 days by default (`cleanupPeriodDays`): older days stay `No data`.
- `■` is an East Asian Ambiguous character: in a terminal set to draw ambiguous characters wide, the heatmap's cells fall out of line.
- "Background" is what Claude Code reports for each spawn. Where every Agent call runs in the background (the Agent tool returns at once), every spawn is listed as background.
