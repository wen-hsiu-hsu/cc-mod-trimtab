# session-keeper

English | [繁體中文](session-keeper.zh-TW.md) · [All mods](../../README.md#the-mods)

Keeps the prompt cache from costing you twice: shows its state on desktop, keeps a 1h cache warm while you are away, and offers a handoff to a fresh session when the context gets expensive.

| Uses a model | CLI | Desktop | Cloud |
| --- | --- | --- | --- |
| Main-model fork when keeping warm and handing off; Haiku when judging a new task. Off by default | Everything except the cache line (desktop only) | Yes | No |

## Commands

| Command | What it does |
| --- | --- |
| `/session-keeper handoff [goal]` | Hand off to a new session now |
| `/session-keeper stats [days]` | Share of prompts judged a new task with no handoff |
| `/session-keeper on <feature> [duration]`, `off [feature]` | Turn a model feature on for a while, or off for this session (see [Settings](../settings.md#features-that-use-a-model)) |
| `/session-keeper status`, `set`, `unset` | See and change settings |

## Cost

Keep warm and handoff are off by default. The cache state and loading progress cost no tokens.

| Feature | Model | When called | Amount each time | What is sent |
| --- | --- | --- | --- | --- |
| `keep_warm` keep the cache warm | Main conversation model (fork) | With a 1h cache and a context over 30k, after `idle_minutes` (55) idle minutes; at most `max_keeps` (3) times per idle period | One read of the whole cache (about the context size) plus about 1 output token | The exact prefix of the main conversation's last request (the whole conversation) |
| `away_handoff` offer a handoff when the cache has expired | Main conversation model (fork) | With a 1h cache, the last keep-warm call writes the handoff summary instead. If you choose handoff and no summary was prepared, it is written once more | One read of the whole cache plus about 1-2k output tokens for the summary. If the cache has expired, it is a full rewrite | Same as above |
| `handoff_gate` new-task judgment | Haiku | For each prompt after the context passes `CLAUDE_CTX_GUARD_TOKENS` (150k). After you stay, it judges again only after another 50k | About 1-3k input and at most 8 output tokens | The new prompt, the last 5 prompts, and the task and recently touched files from the progress file |

`/session-keeper handoff` is a command you run yourself. The switches do not limit it, and its cost is the same as the handoff summary.

- **How to estimate**: the cost of a fork is about the context token count times the cache read price (0.1 times the input price), plus output. When the cache has expired, use the cache write price instead (for 1h it is 2 times the input price). For example, one keep-warm call on a 150k context costs about the same as 15k input tokens. Haiku's judgment is counted in tokens, and the amount is small.
- **Where it goes**: everything goes through Claude Code's `$.model` to the same API provider the main conversation uses. Nothing goes anywhere else.
- **Subscriptions**: Pro / Max do not bill by token, but the calls count toward the usage quota. The conversions above are estimated at API prices.
- **Turn on**: `/session-keeper on <keep_warm|away_handoff|handoff_gate> [duration]`, or keep it on with `/config` (choose `suggest` or `block` for `handoff_gate`).

## Cache state

It uses no icons. Segments are separated by layout spacing (desktop uses a proportional font, where ` · ` would be crowded). A status line can read `prompt_cache`, which Claude Code computes, but a mod cannot get it, so it computes the values itself from the usage of each request.

| Field | How it is computed |
| ---- | -------- |
| `warm 1h [16:44] 23m left` | The time of the last response plus the TTL. The TTL is taken from the latest `ephemeral_5m/1h_input_tokens` entry in the transcript and reread every 10 minutes. Until it is known, only `warm` is shown |
| `cold, next +184.3k` | Expired. The amount to rewrite next = the last request's input + output |
| `hit 91%` | Cache reads of all requests in the main conversation / all input (subagents excluded) |
| `miss 2 +150.2k (ttl? +1)` | A miss counts when the cache read is at least 20% lower than what the previous request sent (and more than 2048 tokens). The rebuild after `/compact` does not count |

Miss reasons are all guesses, so they carry a `?`: `model?` (the model changed), `tools?` (the tool list changed, for example an MCP connected or disconnected), `ttl?` (idle longer than the TTL). If none fits, `unknown` is shown. Misses caused by changes to the system prompt, such as editing CLAUDE.md, fall under `unknown`.

Colors: warm is gray. It turns yellow with less than 5 minutes left (less than 1 minute for a 5m TTL). Cold is red. `miss` is yellow when there are misses.

It is drawn only on `desktop`. The CLI does not show it (the terminal already has a status line), but usage is still recorded as usual.

## Keep warm

A 1h cache expires 1 hour after it was last read or written. After that, the next prompt must rewrite the whole context (the write price of a 1h cache is 2 times the input price). One cache read costs only 0.1 times and restarts the expiry time. So while idle, it uses `$.model.fork({ prompt: 'Reply with OK only' })` to send the main conversation a request with no tools, which reads the cache once.

- **When it sends**: `idle_minutes` (default 55) minutes after the main conversation's last request (or the last keep). At most `max_keeps` (default 3) per idle period. After that, the cache expires as usual. A new request in the main conversation restarts the count.
- **When it does not send**: the TTL is not 1h (a 5m cache has long expired at 55 minutes; it also does not send while the TTL is not yet known from the transcript), the last request's input is under 30k, the cache has already expired, or the conversation changed after `/clear`.
- **Result**: on success, the cache expiry is counted from the send time, and the cache line on desktop shows `kept 1/3`. Success, failure and the reasons for not sending are written only to the debug log (`keep warm …`) and do not disturb the screen. The fork's usage does not count toward `hit`.
- **Hot reload**: the timer is cleared. `session.start` schedules again from the last request time in `$.state`. If the planned time has already passed but the cache has not expired, it sends immediately.
- **Settings**: the `keep_warm` switch, `idle_minutes` (5-59), `max_keeps` (1-10). When the context exceeds the handoff threshold, the last keep produces the handoff summary instead. See "Handoff" below.

The fork is the main conversation's last request plus one more message. The model, system prompt and tools are therefore the same, and it reads the main conversation's cache (type file: "the API serves that prefix from its cache"). After a model change (`/model`), the fork rewrites the whole context. The type file does not say whether a fork's cache read also restarts the 1h expiry. This page assumes the usual cache behavior (every hit restarts the timer). If the `read` amount in the debug log is close to 0 at the next keep, the cache was not extended.

## Handoff

When the context is large, working on an unrelated new task, or continuing after the cache expired, costs several times what a new session costs. Handoff only suggests, and never clears automatically. It makes an offer above the input box, and you choose.

- **Two kinds of offer**: both use the threshold `CLAUDE_CTX_GUARD_TOKENS` (default 150000, the same as when ctx turns yellow in the status line). The context is the input size of the main conversation's last request.
  - **New task** (`handoff_gate`): Haiku reads the new prompt, the last 5 prompts, and the task and recently touched files from the progress file, and judges whether it is an unrelated new task. When unsure, it judges the task as related. `suggest`: the prompt is sent as usual, the judgment runs in the background, and the offer is shown only if the prompt is judged a new task. `block`: the prompt is held back until the judgment is done (at most 8 seconds), and if it is judged a new task, it is stopped so you can choose. `off`: no judgment. After you press "Stay here", or ignore the offer and send the next prompt, the offer comes again only after the context grows another 50k.
  - **Cache expired** (`away_handoff`): when the cache TTL has passed and the context is over the threshold, it stops the prompt and offers a handoff or "Keep working here", which sends the prompt unchanged. Typing another message directly also counts as staying, and the two messages are sent together. Attachments cannot be carried over, so a prompt with attachments is not stopped.
- **What a handoff does**: a fork of the main conversation writes a handoff summary (goal, verified, not verified, approaches that failed, unfinished things, decisions and limits, related files and check commands, one next step, open questions, and a free-form "other"; content that is already in a spec, a commit or elsewhere is written as a path only, and no secrets) → writes it to `.claude/progress.md` (added to `.git/info/exclude`) → `/clear` → puts it in the new session's input box as a draft, which you read and may edit before sending.
  - New task: the draft contains only the new prompt. The summary of the old work stays only in the progress file, for coming back to it later. In `suggest` mode the new prompt has already been sent. Pressing handoff first interrupts its answer, and the summary does not cover it.
  - Cache expired, or `/session-keeper handoff [goal]`: the draft is the summary plus your prompt.
  - Messages you type during the handoff are held back first (identical content is recorded once) and are put into the draft together. If no summary is produced (3-minute timeout or failure), you stay in the original session, and the held-back prompts are put back into the input box.
- **Summary prepared in advance**: forking after the cache expired means paying for a full rewrite first. So with a 1h TTL, the last keep-warm call produces the handoff summary instead (it reads the same warm cache, with only the extra output). When you come back, if the cache has expired and the main conversation made no new request in the meantime, the summary is used directly and no fork is made.
- **Loading progress** (`progress_resume`): the first prompt of each session attaches `.claude/progress.md` (written by the distilling of `project-memory` or by a handoff). The conditions are: within 24 hours, not written by this session, and not already given to this session. The note states that it may be unrelated to this task. A new session after a handoff already has a draft (or is for something else), so it attaches nothing.
- **Record**: each judgment and your choice (hand off, stay, ignore) is stored in `$.store` (the latest 300 entries). `/session-keeper stats [days]` shows the share of prompts judged a new task with no handoff. Use it to decide whether to switch to `block`.

## Settings

| Key | Default | Range | Repo file | Meaning |
| --- | --- | --- | --- | --- |
| `keep_warm` | off | | Can only turn it off | Keep a 1h cache warm while idle |
| `idle_minutes` | 55 | 5-59 | Can only raise it | Idle minutes before a keep-warm is sent |
| `max_keeps` | 3 | 1-10 | Can only lower it | Most keep-warms in one idle stretch |
| `handoff_gate` | `off` | `suggest` / `block` / `off` | Cannot be set | Judge whether a prompt is an unrelated new task |
| `away_handoff` | off | | Can only turn it off | Offer a handoff when the cache has expired |
| `progress_resume` | on | | Can be set | Attach recent progress to a new session's first prompt |

`CLAUDE_CTX_GUARD_TOKENS` (an environment variable, default 150000) sets the handoff threshold. For the layers and `/session-keeper on` / `off`, see [Settings](../settings.md).

## Known limitations

- The handoff relies on putting the draft into the input box after `/clear`. If it cannot be put in (for example a dialog is in the way), a toast says so, and the summary is still in `.claude/progress.md`.
- When an offer appears in `suggest` mode, the new prompt has already paid for a round of large context.
