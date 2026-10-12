# project-memory

English | [繁體中文](project-memory.zh-TW.md) · [All mods](../../README.md#the-mods)

Distills each conversation in the background into Claude Code's own memory and a progress file, so the next session starts knowing what this one learned. Rules confirmed across several sessions are proposed to you before they go into CLAUDE.md, and procedures become project skills.

| Uses a model | CLI | Desktop | Cloud |
| --- | --- | --- | --- |
| Sonnet (effort low) when distilling. Automatic distilling is off by default | Yes | Yes | No |

## Commands

| Command | What it does |
| --- | --- |
| `/project-memory run` | Distill now and show the status |
| `/project-memory list` | List every memory and rule of this repo, without calling the model (see "Listing memories" below) |
| `/project-memory on [duration]`, `off` | Turn automatic distilling on for a while, or off for this session |
| `/project-memory status`, `set`, `unset` | See the status and change settings |

## Cost

Automatic distilling is off by default. `/project-memory run` is a command you run yourself, and the switch does not limit it.

| Feature | Model | When called | Amount each time | What is sent |
| --- | --- | --- | --- | --- |
| `distill` automatic distilling | Sonnet (effort low) | Every `distill_every` (30) messages when the context is at least `min_context_k` (30) k; after `idle_minutes` (10) idle minutes; on `/clear` (each has a threshold, see "Distilling" below). When `MEMORY.md` exceeds the limit, one more merge request | Input is about the conversation added since the last run (tool input cut to 300 characters, results cut to 500) plus the list of existing memories, usually thousands to tens of thousands of tokens. Output is at most 4000 tokens | The new conversation with keys masked, the existing memories, the progress file |

- **How to estimate**: input tokens times the Sonnet input price plus output tokens times the output price. This is not a fork and does not read the main conversation's cache.
- **Where it goes**: through Claude Code's `$.model` to the same API provider the main conversation uses.
- **Subscriptions**: not billed by token, but it counts toward the usage quota. The conversion above is estimated at API prices. While the 5-hour or 7-day limit is used past `max_rate_used` (80)%, automatic distilling is skipped; see "Distilling" below.
- **Turn on**: `/project-memory on [duration]`, or keep `distill` on with `/config`.

## Distilling

- **When**: three triggers, all run in the background.
  - After the main conversation finishes an answer, when `distill_every` (default 30) user messages have passed since the last run and the context is at least `min_context_k` (default 30) k.
  - After `idle_minutes` (default 10) idle minutes since the last answer, with 5 or more new messages (context size is not checked). With 0, it does not distill when idle.
  - On `/clear` with 5 or more new messages: it captures the conversation in `session.end` first, then distills after switching to the new session. When you quit directly (`/exit`, ctrl+c), the hook has only about 1.5 seconds, which is not enough to distill.
  - `/project-memory run` distills immediately and shows the status. `/project-memory status` shows the status and settings. After an automatic run fails, it tries again after 5 more messages.
  - **Skipped near the usage limit**: before any of the three automatic runs above, it reads the usage from `$.session.usage()` (no tokens spent). If the 5-hour or 7-day limit is used past `max_rate_used` (default 80)%, the run is skipped. This is not a failure: `status` shows the reason for the latest skip, and the next trigger checks again. A conversation that `/clear` ended while skipping is dropped, not kept for later. `run` is not limited. With an API key instead of a subscription there is no usage to read, and it distills as usual.
- **What is sent**: the conversation after the last user message that the previous run reached (if it is not found, the whole conversation is sent, but this run may not raise any occurrence count). Tool input is cut to 300 characters and results to 500, then masked with the rules of `secret-scrub`. If an action in the model's output contains a value that looks like a key, the whole line is dropped. Memories of the user and feedback types must carry the user's own words. If they cannot be matched, they are dropped.
- **Where it writes**: the memory folder is, first, the location from which the context loaded `MEMORY.md`. If it is not found, it uses `~/.claude/projects/<encoded repo root>/memory/` (worktrees share the main working tree's). Each memory and rule is one file named `pm-<type>-<alphanumerics from the title>-<hash>.md`. The frontmatter has `name`, `description` and `type`. The body has the approach, the reason, related files and the 3 latest pieces of evidence. If the main session edited these files, the next run takes the file content as the truth and keeps sections it does not recognize as they are. If a file was changed during distilling, this run does not write it, and the next run distills the same part again.
- **What you see**: a toast appears when something changes, and the list of changes is attached to the next prompt. In `MEMORY.md` it changes only the lines that link to `pm-` files.
- **Related files**: when a memory is about specific files, it records their relative paths in the repo (at most 3). Each may carry an evidence string (`anchor`): a string copied exactly from that file that the memory relies on, such as a function name or a config key. It must be 6 to 80 characters, not a bare language keyword, with no backtick; otherwise only the anchor is dropped and the path is kept. Memory files write it as `` `path` → `anchor` ``. Each run checks whether the files still exist and still contain their anchors, and marks what is not found in the list for the model. If the file or the anchor was only renamed or moved, it changes the path and anchor. If what the memory says no longer holds, it marks it invalid. If it cannot tell, it leaves it alone. Older memories without anchors are checked for the file only.
- **Invalidation**: when the model removes a memory or rule, the file is not deleted. Instead it adds `invalidated` (date) and `superseded_by` (the entry that replaces it) to the frontmatter, and drops it from `MEMORY.md` and from later runs. The file is deleted after 90 days. Procedures exist only in `$.store`, so removing one is a real deletion.
- **Expiry**: project and reference entries that were not confirmed for more than 30 working days (days when a session was opened in this repo, recorded in `$.store`) are dropped from `MEMORY.md`. The file stays, and the entry is put back when confirmed again. After a break from work, entries do not all expire at once.
- **Limit**: only the first 200 lines of `MEMORY.md` load automatically, and it is shared with the main session's own memory, so `pm-` lines are limited to 60. If it exceeds that after a run, it sends one more request that may only merge and mark invalid. If it still exceeds the limit (or the request fails), it lists only the 60 most recently confirmed and keeps the other files.
- **Progress**: `.claude/progress.md` (added to `.git/info/exclude`) is updated only when there is real progress, and the whole file is replaced. When `session-keeper` hands off, it overwrites this file with the handoff summary and loads it into the new session (see "Handoff" in "session-keeper").

## Listing memories

`/project-memory list` shows one line per memory and rule: type, title, how many sessions confirmed it, the date it was last confirmed, and its status. It reads only the memory folder and `$.store`, and does not call the model.

- **Sessions**: a rule shows its count. A memory keeps only its 3 latest pieces of evidence, so it counts at most 3.
- **Status**: `listed`, `not listed (over 60)`, `stale` or `invalidated <date>`, possibly followed by `<path> is gone`, `<path> no longer contains "<anchor>"` or `waiting to go into CLAUDE.md` (a rule confirmed in 3 sessions and not yet in the repo).
- **Order**: valid entries first, invalidated ones last, each from the most recently confirmed.
## Writing to the repo

For rules and procedures that 3 different sessions confirmed and that are not yet in the repo, the first prompt of each session attaches a notice (at most 3 at a time; the same one at most 2 times, 6 hours apart). A further confirmation in the same session adds only evidence, not a count.

- **Rules**: CLAUDE.md is the user's to decide, so Claude does not edit it directly. At the end of its reply, it lists the text to add and where, and asks whether you want it. Only after you agree does it write it, then call `mark_in_project` to report the location. The rule's memory file is then deleted, and only a record stays in `$.store`. If you decline, it is marked "do not put", and the rule stays in memory as before.
- **Procedures**: made directly into `.claude/skills/<name>/SKILL.md` (a new file; you read the diff and decide whether to keep it). After it is reported, there is no further notice.

Nothing is committed.

## Settings

| Key | Default | Range | Repo file | Meaning |
| --- | --- | --- | --- | --- |
| `distill` | off | | Can only turn it off | Automatic distilling. When off, it does not distill on idle or `/clear` either; `/project-memory on` turns it on for a while |
| `distill_every` | 30 | 5-200 | Can only raise it | Distill after this many user messages since the last run |
| `min_context_k` | 30 | 0-1000 | Can only raise it | Below this many k of context, skip the every-N-messages run (only that one) |
| `idle_minutes` | 10 | 0-120 | Cannot be set | Distill after this many idle minutes; 0 means never on idle |
| `max_rate_used` | 80 | 0-100 | Can only lower it | Skip automatic distilling while the 5-hour or 7-day limit is used past this percent; 100 means never skip |
| `promote` | on | | Can be set | Notices about writing confirmed rules and procedures to the repo |

Values from `/config` are stored in `pluginConfigs` in the user-level `~/.claude/settings.json` and shared by all repos. Tested on 2.1.295 on 2026-10-09: `pluginConfigs` in the repo's `.claude/settings.json` and `.claude/settings.local.json` do not take effect. To adjust per repo, use the repo or local file described in [Settings](../settings.md).

## Known limitations

- `project-memory` deletes files with `rm` (`$.fs` has no delete), so it supports only macOS / Linux. The default memory folder path is derived from Claude Code's naming. If another location is set (for example `autoMemoryDirectory`) and the context did not load `MEMORY.md`, it writes to the wrong place. Distilling looks only at the main conversation. Subagent content does not count.
