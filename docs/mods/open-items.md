# open-items

English | [繁體中文](open-items.zh-TW.md) · [All mods](../../README.md#the-mods)

Keeps undecided questions, unresolved bugs and deferred items outside the context, so they survive `/clear`, compaction and new sessions. A count sits above the input box, and one key press quotes an item back to Claude.

| Uses a model | CLI | Desktop | Cloud |
| --- | --- | --- | --- |
| No | Yes (phone: status line only) | Yes | No |

## What it does

- **Claude registers items** with the `track` tool (kinds: decision, question, deferred, bug). Text that is the same as, or contained in, an open item is not added again.
- **Unpicked options are deferred**: when you pick only some options (for example "A + B, write C down as an observation"), the unpicked ones are deferred automatically, and a toast shows what was deferred. Before the next prompt, press `[Undo deferral]` (`u`) or run `/open-items undo` to cancel it. Only an option list at the end of the answer, or followed by a question, is parsed.
- **Count above the input box**: press `[Open]` (`o`) or run `/open-items` to open the pane.
- **The pane**: mark items done or won't do, quote one into the input box, or copy the list as markdown (`c`). It lists each item's creation time and branch; items older than 7 days are dimmed. Esc closes it. Items you close in the pane are reported to Claude with the next prompt.
- **Decision log**: items completed with a reasoned decision, or marked won't do, also go to a log of the latest 300 entries. Query it with `/open-items log [keyword]` or the `history` action of `track`.
- **Per repo, across sessions**: items are saved per repo (worktrees of the same repo share them). Every change is merged into the file, so concurrent sessions do not overwrite each other.
- **On load**: the first prompt after loading attaches the list for Claude, and a toast says how many items are on other branches and how many are older than 7 days.

## Commands

| Command | What it does |
| --- | --- |
| `/open-items` | Open the pane |
| `/open-items undo` | Cancel the last automatic deferral |
| `/open-items copy` | Copy the list as markdown |
| `/open-items log [keyword]` | Search the decision log |
| `/open-items stats` | The miss rate: the share of answers that end with a question but did not call `track` (each case is written to the debug log) |

## Settings

None besides `language` (see [Settings](../settings.md#language)).
