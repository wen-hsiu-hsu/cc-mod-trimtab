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
| `/subagent-dispatch backfill` | Read the transcripts of sessions with no usage details into usage details again (see [Backfill](#backfill)) |
| `/subagent-dispatch status`, `set`, `unset` | See and change settings |

## Usage details

Each session keeps its own usage details in the plugin's `$.store` (one key per session, shared across repos). It records:

- The session: its repo (the main working tree, so worktrees group together), its start time and the first 40 characters of its first prompt that is not a slash command, which together name it (`Oct 12 02:11 review the diff…`), and the main session's tokens per model for each day (local date). After `/clear` the new session gets its own start and name; mods cannot read the session's own title.
- Each spawn (the latest 500 per session): description, agent type, the model the call named (or the default) and the model it resolved to, whether it was a fork or ran in the background, input / cache write / cache read / output tokens, steps and duration. Steps of an agent whose spawn was never recorded (one spawned before a hot reload) are listed as `unknown`.

Usage details no session has written to for 90 days are deleted when a session starts. Usage details from before 0.4.0 have no days: their main session tokens all count on the day it was last written.

Before that, the same session start sums each settled day (the day before yesterday or earlier) into a day row: the main session's tokens by model, the spawns' tokens by model and the spawn counts, all sessions together. A row is computed whole from the usage details and written once; rows are kept 366 days, so the heatmap reaches back a year after the usage details are gone.

`/subagent-dispatch stats [days]` (1-90 calendar days, default 30, today included) opens a pane over every session. The main session counts only its tokens of those days; a spawn counts on the day of its last step, so one that runs past midnight counts whole on the later day.

![The stats pane at 80 columns: the heatmap, the period, the summary and the repos](../images/subagent-dispatch/stats-80.svg)

![A repo opened: its summary and its spawns by tokens](../images/subagent-dispatch/stats-row-80.svg)

The pictures are the real pane over made-up data, captured with `scripts/capture-pane.py`.

- The top line is `subagent-dispatch stats` with a rule across it and, at its right, when the pane last read the usage details (`Updated 19:04:05`, the time alone where that does not fit). The hint line sits at the foot of a docked pane and lists only the keys the buttons do not show (`Tab`, `Enter`, `Esc`).
- A calendar heatmap heads the overview, one cell a day, a column a week, Monday at the top and today in the last column: as many weeks as the pane is wide, up to 53 (38 in 80 columns, 53 from 110; none below 12 columns). Each cell is the day's tokens (main session and subagents, cache read not counted): a gray `·` for a day with no record (before the backfill, a deleted transcript, another machine), a gray `■` for a recorded day with no use, and four shades of cyan by quartile of the days drawn. A cell's color shows only its use, whatever the period. Months label the top, `Mon` / `Wed` / `Fri` the left. On the line under the grid a bracket `└── 30 days ──┘` marks the weeks the period covers; a 1-day period turns its cell orange with `▲ Fri Oct 2` under it. As much of the legend as fits shares that line: `Less ■■■■ More`, `None ■`, `No data ·`, and the day with the most tokens (`Most Oct 2 1.2M`), moving right of the bracket where the bracket is in the way. The last 89 days come from the usage details, as the rest of the pane counts them; days before from the day rows. On desktop it is one Svg, the bracket and `▲` drawn in it and the legend on a line below.
- Under the heatmap, the period: `Period p: ‹ 30 days ›  h: ‹ Sep 13 – Oct 12 l: ›`, with `t: Today` at the right. `p` steps through 1, 7, 30 and 90 days and keeps the period's last day (another length given to `stats`, such as 14, shows as it is and `p` goes on to the next longer one); `h` / `l` move it back / forward by its own length (a day for 1 day, a week for 7), `l` no later than today and `h` no earlier than 366 days back; `t` jumps to today alone. The cells are not clickable. Where it is narrow, the word `Period` goes first, then the days close up to `Sep 13–Oct 12`.
- The summary has no card frames, two lines each for the tokens and the spawns: the total at the left (`12M token`, `46 spawns`) and what it is made of at the right (`main 8.4M  sub 4.0M`; `named 14  default 24  fork 8`: a model named in the call, the default model, or a fork on the main session's model), then a bar across the line. Under them, `Cache read 182M, not counted`. Tokens are input + cache write + output. With no spawns the spawn lines are left out.
- A period with no use or no record says so in place of the summary (`Sun Oct 11: no usage.`, `Sep 20 – Sep 26: no data.`) and lists no rows. A period wholly before the 90 days of usage details shows its summary from the day rows and says the details were deleted in place of the rows. With nothing recorded at all, the longer sentence on how recording starts shows instead.
- The rows are grouped by repo (by folder name), session, model or agent type, one a line. The column names come first, the `g: ‹ by repo ›` switch at their left, over a rule. The columns are the name, tokens, share, a bar (main session purple, subagents cyan), sub share, spawns, named/default/fork, the grouping's own two, and cache read; the grouping's own two are sessions and `Last` by repo, the repo and start time by session, and the average tokens per spawn and `Last` by model or type. `Last` is the last day in the period the row used tokens. Where the width runs short the least important columns go first (cache read, named/default/fork, the grouping's two, sub, share, the bar, leaving tokens and spawns), and the name keeps at least 16 columns; about 110 columns hold them all when grouped by repo. Grouped by session, the name is the first prompt. Ten rows are listed, and `N more` (`m`) lists ten more.
- `Period`, `Group by` and `Sort` switch in place, so nothing below them moves: in the terminal each is one button showing `‹ value ›` that steps to the next value and wraps (`p`, `g`, `s`), on desktop a segment per value, the same key on the segment after the current one.
- Press a row's name to open it; the heatmap is not drawn while a row is open. At the top are `b: ‹ Back` and the crumb (`model ›` and the row's name, only the name cut short), a line with the period to read only (`Period 30 days · Sep 13 – Oct 12`), and that row's own summary, as in the overview; an opened session names the main session's models on its token line. Under a rule come `Sort` and its spawns as a table (a dot in the color of where the model came from, description, bar, tokens, date), most tokens first; `Sort` switches to newest or longest run first. Ten are listed, and `N more` (`m`) lists ten more. Press a spawn to open it in place to its type, model, run (background, steps, duration) and session; one at a time. A row with no spawns (the main session row of the type grouping, or a model only the main session used) lists instead the sessions its tokens came from in the same table (prompt, bar, tokens, start date), sorted by tokens or by time. `b` returns.
- Bars in rows above and below each other are drawn in `▆`, leaving a gap between rows.
- While the pane is open it follows new use: a second after a step or spawn is recorded, it is drawn again from the usage details. Other redraws (a resize, a key) within 30 seconds of the last read reuse it, so `Updated` is when the usage details were last read; another session's use shows at the next read.

In a narrow terminal the pane opens above the input box instead of beside the conversation. `/subagent-dispatch stats --text [days]` prints the same report as text. `stats` prints it too in a `-p` run, or when no pane can be placed.

Not included: the mods' own model calls (`$.model.fork` / `$.model.complete`), cloud sessions (they do not load mods), and sessions older than the transcripts this machine kept when the mod was installed.

## Backfill

Claude Code has no install event, so the first session (not a `-p` run) to start without a `backfill` mark in the store reads the local transcripts in the background, and the session does not wait for it. Each session under the config directory's `projects/` (`$CLAUDE_CONFIG_DIR`, or `~/.claude`) that has no usage details yet gets them rebuilt from its transcript and its subagents' (`<session>/subagents/agent-*.jsonl` with their `.meta.json`): its start, last write, first prompt and repo, the main session's tokens per day and model (a reply split over several lines counts once), and each spawn with its type, the model it named, fork, background, tokens and steps. A session that already has usage details, and the current session, are left as recorded live. One file at a time; a file over 4 MiB is read through `cat` (skipped where no process can be run, such as desktop); a file that fails is skipped and logged to the debug log. Then the day rows are computed, and a toast says how many sessions were added (`subagent-dispatch: added 221 session(s) from the transcripts (since Sep 15)`); nothing is shown when none were.

While one session runs it, the mark says `running` and other sessions leave it alone for 10 minutes. `/subagent-dispatch backfill` runs it again whatever the mark says, for a run that stopped or a new machine. Nothing runs while `ledger` is off.

## Settings

| Key | Default | Repo file | Meaning |
| --- | --- | --- | --- |
| `ledger` | on | Cannot be set | Record spawns and token use. Off records nothing; `stats` still reads what exists |

`ledger` is not shown in `/config`; set it with `/subagent-dispatch set ledger false --local` or in `~/.claude/cc-mod-trimtab.json`. For the layers, see [Settings](../settings.md).

## Known limitations

- The backfill reads only this machine's transcripts, and Claude Code deletes transcripts after 30 days by default (`cleanupPeriodDays`): older days stay `No data`.
- `■` and `▆` are East Asian Ambiguous characters: in a terminal set to draw ambiguous characters wide, the heatmap's cells and the list's bars fall out of line.
- "Background" is what Claude Code reports for each spawn. Where every Agent call runs in the background (the Agent tool returns at once), every spawn is listed as background.
