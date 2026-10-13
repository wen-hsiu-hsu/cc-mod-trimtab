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
| `/subagent-dispatch status`, `set`, `unset` | See and change settings |

## Usage ledger

Each session keeps its own ledger in the plugin's `$.store` (one key per session, shared across repos). It records:

- The session: its repo (the main working tree, so worktrees group together), its start time and the first 40 characters of its first prompt that is not a slash command, which together name it (`Oct 12 02:11 review the diff…`), and the main session's tokens per model. After `/clear` the new session gets its own start and name; mods cannot read the session's own title.
- Each spawn (the latest 500 per session): description, agent type, the model the call named (or the default) and the model it resolved to, whether it was a fork or ran in the background, input / cache write / cache read / output tokens, steps and duration. Steps of an agent the ledger never saw spawn (one spawned before a hot reload) are listed as `unknown`.

Ledgers no session has written to for 90 days are deleted when a session starts.

`/subagent-dispatch stats [days]` (1-90, default 30, today included) opens a pane over every session:

- The top line is `subagent-dispatch stats` with a rule across the rest of it. The hint line sits at the foot of a docked pane and lists only the keys the buttons do not show (`Tab`, `Enter`, `‹ Back (b)`, `Esc`).
- Two cards, side by side from 60 body columns and stacked when narrower. **Tokens** (input + cache write + output) with a bar split into the main session (purple) and subagents (cyan) and the subagent share. **Spawns** by where the model came from, three kinds that add up to the total: named a model (yellow, with how many named Opus), the default model (gray), and forks (green, which run on the main session's model). Cache read (not counted) is a short line under the cards.
- Rows grouped by repo (by folder name), session, model or agent type (`Group by`), each with a bar (Svg on desktop, colored cells in the terminal), its tokens, share and spawns. From 80 body columns a row is one line under a line naming the columns, and the period and grouping share the top line; narrower, a row's bar goes on a second line. A list's column names (or, when narrower, the grouping) sit under a rule and above a blank line; grouped by session, a blank line also parts the rows, since a session's name runs long.
- `Period`, `Group by` and `Sort` switch in place, so nothing below them moves: in the terminal each is one button showing `‹ value ›` that steps to the next value and wraps (`p`, `g`, `s`), on desktop a segment per value, the same key on the segment after the current one.
- Press a row's name to open it: the same two cards for that row, then its spawns as a table (a dot in the color of where the model came from, description, bar, tokens, date), most tokens first; `Sort` switches to newest or longest run first. An opened session splits its token card by the main session's models. Ten are listed, and `N more` (`m`) lists ten more. Press a spawn to open it in place to its type, model, run (background, steps, duration) and session; one at a time. A row with no spawns (the main session row of the type grouping, or a model only the main session used) lists instead the sessions its tokens came from, most first, each with a bar. `‹ Back` (`b`) returns.
- `Period` is 7, 30 or 90 days.

In a narrow terminal the pane opens above the input box instead of beside the conversation. `/subagent-dispatch stats --text [days]` prints the same report as text. `stats` prints it too in a `-p` run, or when no pane can be placed.

Not included: the mods' own model calls (`$.model.fork` / `$.model.complete`), cloud sessions (they do not load mods), and anything before the mod was installed.

## Settings

| Key | Default | Repo file | Meaning |
| --- | --- | --- | --- |
| `ledger` | on | Cannot be set | Record spawns and token use. Off records nothing; `stats` still reads what exists |

`ledger` is not shown in `/config`; set it with `/subagent-dispatch set ledger false --local` or in `~/.claude/cc-mod-trimtab.json`. For the layers, see [Settings](../settings.md).

## Known limitations

- "Background" is what Claude Code reports for each spawn. Where every Agent call runs in the background (the Agent tool returns at once), every spawn is listed as background.
