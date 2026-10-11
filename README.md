# cc-mod-trimtab

English | [繁體中文](README.zh-TW.md)

Function-hook plugins (mods) for Claude Code that reduce mistakes, save tokens and improve fault tolerance. The `.claude-plugin/marketplace.json` at the repo root turns this repo into a marketplace named `cc-mod-trimtab`. Each mod can be installed separately.

- **Requirements**: Claude Code 2.1.296 or later (the tested version). The mod API is still early access, so mods may need changes after a Claude Code update. Only the CLI and desktop are supported. Cloud sessions cannot load the mods (see "Install").
- For the changelog, see [CHANGELOG.md](CHANGELOG.md). For how to report security issues and what each mod protects, see [SECURITY.md](SECURITY.md). For decisions and planned mods, see [ROADMAP.md](ROADMAP.md) (in Chinese).

## Mods

| Mod | Purpose | Uses a model | CLI | Cloud (see below) |
| --- | ---- | ------ | --- | ---- |
| `secret-scrub` | Masks secrets before a prompt is sent: `token=`, `Bearer`, `sk-…`, `ghp_…`, JWTs, private keys, `*_TOKEN=` and similar. A prompt that contains `#noscrub` (changeable with `bypass_marker`) is sent as is. You can add custom rules (`custom_rules`) and exceptions (`allow`). The input history (`history.jsonl`) is also rewritten with the masked content. `/secret-scrub history` cleans old records from all sessions | No | Yes | No |
| `tool-guard` | Blocks commands that lose work, after measuring the impact: `reset --hard`, `checkout --`, `restore` (uncommitted files that would be lost), `clean -f` (untracked files that would be deleted), force push (remote commits that would be overwritten), `stash drop/clear`, `--no-verify`, `rm -r/-f` (number and size of files to delete; files under `$TMPDIR`, `/tmp`, `/var/folders` and `rm_skip_paths` are not counted), database migrations (pending items). Commands that cause no loss pass straight through (clean working tree, a force push that drops no commits and is not to main/master, an rm with no matching files, no pending migrations). When confirmation is needed, it opens a panel that lists the impact: press `1` to run, `2` to cancel. If the terminal is too narrow for the panel, it uses the built-in question dialog instead (it lists the same impact; choose "Run" or "Cancel", or type a reply to Claude). In non-interactive modes such as `-p` nobody can answer, so it blocks the command and writes the impact into the reason. The user can type `/tool-guard allow` to allow it once (within 10 minutes). It can also check the commit title format (`commit_format`, off by default; `commit_pattern` sets a custom format) and remove Claude attribution (`strip_attribution`, on by default) | No | Yes | No |
| `output-trimmer` | When Bash output exceeds 150 lines or 15k characters (`max_lines`, `max_chars`), the model gets only the beginning, the end and the error lines. The full output is saved to `$TMPDIR/claude-output-trimmer/`. File-reading commands are left alone. Add `# notrim` to a command to get the full output | No | Yes | No |
| `agent-dispatch` | When a background agent is interrupted, shows it above the input box: press `[Redispatch]` (`r`) or run `/agent-dispatch redispatch` to put a redispatch instruction into the input box, or `[Dismiss]` (`d`). Nothing is shown while agents run. `/agent-dispatch stats [days]` opens a pane with each spawn and the token use of the main session, subagents and models from a local ledger (`--text` prints it instead) | No | Yes (phone: status line only) | No |
| `open-items` | Tracks items that are undecided, unresolved or deferred. Claude registers them with the `track` tool. Text that is the same as, or contained in, an open item is not added again. When you pick only some options (for example "A + B, write C down as an observation"), the unpicked ones are deferred automatically. A toast shows what was deferred. Before the next prompt, press `[Undo deferral]` (`u`) or run `/open-items undo` to cancel it (only an option list at the end of the answer, or followed by a question, is parsed). A count is shown above the input box. Press `[Open]` (`o`) or run `/open-items` to open the panel (done / won't do / quote / copy as markdown; it lists the creation time and branch, and items older than 7 days are dimmed). Items you close in the panel are reported to Claude with the next prompt. Items completed with a reasoned decision, or marked won't do, are also saved to a record that does not expire. Query it with `/open-items log [keyword]` or the `history` option of `track`. Items are saved per repo across sessions (worktrees of the same repo share them). Every change is merged into the file, so concurrent sessions do not overwrite each other. The first prompt after loading attaches the list for Claude, and a toast says how many items are on other branches and how many are older than 7 days. `/open-items copy` copies the list. `/open-items stats` shows the miss rate (the share of answers that end with a question but did not call `track`; each case is written to the debug log) | No | Yes (phone: status line only) | No |
| `session-keeper` | On desktop, shows one line above the input box with the prompt cache state (desktop does not run the status line): `cache  warm 1h [16:44] 23m left  ·  kept 1/3  ·  hit 91%  ·  miss 2 +150.2k (ttl? +1)`. It turns yellow when the cache is about to expire and red when it has expired, with the amount to rewrite next (`cold, next +184.3k`). Miss reasons are guesses. Keep warm: when the TTL is 1h and the context is over 30k, it sends a fork that replies only OK to read the cache, 55 minutes after the cache was last used. It sends at most 3 per idle period, and the CLI sends them too. Handoff: when the context exceeds the threshold (`CLAUDE_CTX_GUARD_TOKENS`, default 150k) and Haiku judges the prompt to be an unrelated new task, or the cache has expired, it offers `[Hand off to a new session]` (`h`) / `[Keep working here]` (`k`) above the input box. On handoff, the summary is written to `.claude/progress.md` and, after `/clear`, put into the input box as a draft. `/session-keeper handoff [goal]` hands off at any time. The first prompt of the new session attaches progress from the last 24 hours. See "session-keeper" below | When keeping warm and handing off (fork of the main conversation), when judging a new task (Haiku). Off by default; turn on with `/session-keeper on` | The cache state is shown only on desktop; everything else works in the CLI | No |
| `self-check` | Guard-rail reminders for Claude. They never block the user. When the same tool fails twice in a row for the same reason (the error text is identical after paths and numbers are removed), it asks Claude, after the second result, to find the cause first and not retry unchanged. When Claude edited code files this turn (Edit / Write, not documents such as `.md` or `.txt`, and not edits by subagents), did not run tests, a build or a check afterward, and the reply says the work is done, it blocks that stop once and asks Claude to verify (it does not block if the reply says it did not verify). Each of the two can be turned off (`retry_nudge`, `done_check`, see "Settings"). If it hits an error, it skips and does not affect tool calls or stops | No | Yes | No |
| `project-memory` | In the background, uses Sonnet (effort low) to distill the conversation since the last run into memories, rules and procedures. It runs every 30 messages (context 30k or more), after 10 idle minutes (adjustable) or on `/clear` (with 5 or more new messages). Memories and rules go into the built-in memory (one `pm-*.md` file each; `MEMORY.md` changes only the lines that link to `pm-` files, at most 60 entries). Overturned entries are marked invalid and their files are deleted after 90 days. When a related file that was recorded is missing, the model decides what to do. The same request updates the repo's `.claude/progress.md` (added to `.git/info/exclude`). A toast appears when something changes, and the list of changes is attached to the next prompt. A rule confirmed in 3 sessions is written to CLAUDE.md only after asking you. A procedure becomes a project skill (not committed). See "project-memory" below | When distilling (Sonnet). Automatic distilling is off by default; turn on with `/project-memory on` | Yes | No |

## Install

### CLI and desktop

```bash
claude plugin marketplace add wen-hsiu-hsu/cc-mod-trimtab
```

To pin a version, add a tag, for example `wen-hsiu-hsu/cc-mod-trimtab#v0.1.0`.

Then install the mods you want in Claude Code (user scope). Install `secret-scrub` first. For the reason, see "Development › Multiple mods together":

```
/plugin install secret-scrub@cc-mod-trimtab
/plugin install session-keeper@cc-mod-trimtab
/plugin install tool-guard@cc-mod-trimtab
/plugin install output-trimmer@cc-mod-trimtab
/plugin install agent-dispatch@cc-mod-trimtab
/plugin install open-items@cc-mod-trimtab
/plugin install self-check@cc-mod-trimtab
/plugin install project-memory@cc-mod-trimtab
```

You can also install from a shell with `claude plugin install <mod>@cc-mod-trimtab`. The current session loads the mod right after install. You do not need `/reload-plugins`.

### Update

Each mod pins a `version` in `plugin.json`, so it updates only when the version number changes. Commits in between do not trigger an update. Third-party marketplaces do not update automatically by default. Pick one way to update:

- **Auto-update**: in the Marketplaces tab of `/plugin`, select `cc-mod-trimtab`, then select Enable auto-update.
- **Update one mod manually**: `claude plugin update <mod>@cc-mod-trimtab`.
- **Update everything manually**: in the Marketplaces tab, select Update marketplace.

After an update, running sessions need `/reload-plugins` to use the new version. New sessions load it directly.

### Cloud (claude.ai/code): cannot load for now

The official docs ([plugins/loading](https://code.claude.com/docs/en/plugins/loading#plugins-shared-through-a-repository)) state that cloud sessions do not add marketplaces that a repo lists in `extraKnownMarketplaces`, because that requires passing the workspace trust dialog, which cloud sessions do not show. A plugin placed in the project's `.claude/skills/` also needs to pass trust first. So declaring this marketplace in the project's `.claude/settings.json` has no effect. For now these mods work only in the CLI.

## Settings

Each mod reads its settings from these layers, from highest to lowest, and takes the first one that has a value:

1. **session**: `/<mod> set <key> <value>`. It applies to this session only.
2. **local**: `.claude/cc-mod-trimtab.local.json`. It is not committed (added to `.git/info/exclude` on the first write). Use this file in repos you forked from someone else.
3. **repo**: `.claude/cc-mod-trimtab.json`. It is committed to the project and shared by the team, but it can only make protection stricter or spending lower (see the table below).
4. **user**: single values go in `/config` (stored in `pluginConfigs` in `~/.claude/settings.json`). List values (`custom_rules`, `allow`, `rm_skip_paths`) go in `~/.claude/cc-mod-trimtab.json`, because `/config` cannot store lists.
5. **default**.

The three files have the same format: `{ "<mod>": { "<key>": value } }`.

### Language

The text the mods show is in English (`en`) by default; Traditional Chinese (`zh-TW`) is also available. Set it once for every mod in `~/.claude/cc-mod-trimtab.json` (or `.claude/cc-mod-trimtab.local.json` for one project), under `"*"`:

```json
{ "*": { "language": "zh-TW" } }
```

- A mod's own section overrides `"*"` in the same file, and `/<mod> set language zh-TW` changes one mod. The committed repo file cannot set `language`.
- Content the model writes for you (`project-memory` memories and `.claude/progress.md`, `session-keeper` handoff summaries) follows the same setting. Instructions sent to the model are always in English.
- `/config` does not show `language`, and the `/config` titles are in English only.

```
/<mod> status                                  # current value of each setting, which layer it comes from, how the repo may change it, and ignored values
/<mod> set <key> <value> [--session|--local|--repo]   # default --session; write lists as a JSON array, otherwise the whole text counts as one item
/<mod> unset <key> [--session|--local|--repo]
/<mod> on [feature] [duration]                 # temporarily turn on a model-using feature; default 2h, at most 24h (2h, 90m, 1h30m)
/<mod> off [feature]                           # turn off in this session
```

Features that use a model (`keep_warm`, `away_handoff` and `handoff_gate` of `session-keeper`, and `distill` of `project-memory`) are **off by default**. For costs, see "Cost" in each mod's section:

- **Temporary on**: `/<mod> on`. It turns off by itself when the time is up or the session ends (including `/clear`), and writes no file. While it is on, one gray line above the input box shows it, for example `session-keeper on · keep_warm 1h42m`. When a mod has more than one such feature, name the feature (`/session-keeper on keep_warm 2h`). A feature that is already always on through settings does not change.
- **Always on**: `/config`, `.claude/cc-mod-trimtab.local.json` or the user-level file. The committed `.claude/cc-mod-trimtab.json` in the repo cannot turn them on.
- **Off**: `/<mod> off` turns the feature off for this session only. Always-on settings return in the next session.
- The first time each feature uses a model in a session, a toast reminds you once.

What the repo file may do depends on the kind of setting. Values that break the rule are not used, and `/<mod> status` lists the reason. `set --repo` does not write values that would be ignored:

| Category | Setting | Repo file |
| --- | --- | --- |
| Protection | `commit_format` of `tool-guard` | Can only turn it on |
| Protection | `allow` and `bypass_marker` of `secret-scrub`; `rm_skip_paths` of `tool-guard` | Cannot be set (they would loosen protection) |
| Protection | `custom_rules` of `secret-scrub` | Cannot be set: JavaScript regular expressions have no timeout, and a rule that backtracks forever would hang every prompt |
| Cost | `keep_warm`, `away_handoff`, `max_keeps`, `idle_minutes`, `handoff_gate` of `session-keeper`; `distill`, `distill_every`, `min_context_k`, `idle_minutes` of `project-memory` | Can only turn off or lower the spending; `handoff_gate` and `idle_minutes` of `project-memory` cannot be set |
| General | Others (for example the thresholds of `output-trimmer`, `commit_pattern` and `strip_attribution` of `tool-guard`) | Can be set freely |

After you change a file, `/<mod> status` rereads it. At other times the files are read once when the session starts.

## Development

Add your cloned folder as a marketplace to edit the mods in the repo directly:

```bash
claude plugin marketplace add ./cc-mod-trimtab
```

In a local-folder marketplace, mods with relative paths load straight from the repo, not from the copy in `~/.claude/plugins/cache/` (`Read from:` in `claude plugin list` shows the repo path). So after you change a mod, run `/reload-plugins` in each running session. You do not need to reinstall, change `version` or commit first. Only when you add or rename a mod (`marketplace.json` changed) do you need to run `claude plugin marketplace update cc-mod-trimtab` and install the new name.

When you publish, raise the `version` of the changed mods so that users who installed from GitHub get the update, and record the change in [CHANGELOG.md](CHANGELOG.md).

```bash
claude plugin validate mods/<mod>   # check the manifest and hooks module
claude plugin test mods/<mod>       # run hooks/*.test.ts(x)
claude plugin validate .            # check the marketplace
scripts/check-copies.sh             # check that the copies of shared code in each mod match
```

- `.claude-plugin/types/` is generated by Claude Code when it loads a mod (API types) and is listed in `.gitignore`. `tsconfig.json` extends it. After one load, you can type-check with `npx tsc -p mods/<mod>`.
- The validator only lets you pass `$` to functions declared at the **top level** of the same file. It cannot follow imports. Write helpers as `async function f($: EngineInterface, …)`.
- The validator does not type-check: an undefined variable also passes. Use `tsc` to catch it.
- In tests, the engine ops (`process.run`, `ui.toast`…) are answered by the test's `on` with `{ value }`.
- A mod cannot import files outside its own folder (symlinks do not work either). Shared code therefore lives in one copy per mod. When you change it, change all copies together, then run `scripts/check-copies.sh`:
  - `hooks/config.ts` (layered settings, see "Settings") exists in every mod.
  - In each mod's register file, the block from `// --- configIO:` to `// --- end configIO ---`. `config.ts` needs `$` to read and write files, and `$` cannot cross an import, so this block wraps it as a `ConfigIO` and passes it in.
  - `project-memory/hooks/scrub.ts` is a copy of `secret-scrub/hooks/scrub.ts`.
- To add a setting, add an entry to the mod's `SPECS` (category, type, default, repo rule, description). For a single value, also add a row to `userConfig` in `plugin.json` so that `/config` shows it.
- No emoji: not in text the mods show (band, status line, toast, panel), nor in code, tests or docs. Express state with text and color. The only exception is when emoji are explicitly required, for example the commit title format that `tool-guard` checks.

### Multiple mods together

Hooks for the same event nest in layers. The ones listed first are the outer layers: they get the input first and the result last, and they pass control to the next layer by calling `next(e)`. The order comes from `enabledPlugins` in `~/.claude/settings.json`, not from the install order. `/plugin install` adds a new plugin at the end. Right now a plugin cannot declare its own order (type file: "same-event hooks nest in this order and no other way"). So the rule is that **no feature of any mod may depend on the order**:

- **Hand off to `next`**: narrow the scope with a matcher (`{ tool: 'Bash' }`, `{ command }`, `{ component, requestId }`). After handling, always hand off to `next`. Do not answer on a shared event yourself.
- **Stack in shared places**: there is only one band above the input box (`AbovePrompt`), and all plugins share it. When you have something to draw, first do `const below = await next(e)` and put `below` under your own content. When you have nothing to draw, `return next(e)`. Returning your own tree directly makes the bands of inner plugins (including external plugins such as image-view) disappear. In tests, add a hook on the engine side that draws `band beneath`, and assert that it is still visible (see the tests of `session-keeper`, `agent-dispatch` and `open-items`). `$.ui.status`, toasts and panes with their own ids are separated per plugin by the engine, so you do not need to handle them.
- **Buttons in the band must not collide**: `key` and `hotkey` must not repeat across mods. Currently in use are `r` `d` for agent-dispatch, `o` `u` for open-items and `h` `k` for session-keeper.
- **Change state only after the send**: an inner layer may block the event (for example `prompt.submit` returns `drop`). So before calling `next`, only read state. Change it only after you know the event went through (see `prompt.submit` in `open-items`). Put the code after `next` inside a `try`, so that `.catch` is not triggered.

The one thing that cannot be order-independent is **who sees the original text first**: a `prompt.submit` hook placed outside `secret-scrub` always sees the prompt before it is masked. So `secret-scrub` is always first in `enabledPlugins`. Check this after adding or reordering plugins. To confirm the actual order, run `claude -p "ok" --debug-file <file>` and look at the `$ built for …` line.

The above is based on the type files and tests of Claude Code 2.1.294. The mod API is still early access. If a way to declare order is added later, this section will be updated.

## session-keeper

### Cost

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

### Cache state

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

### Keep warm

A 1h cache expires 1 hour after it was last read or written. After that, the next prompt must rewrite the whole context (the write price of a 1h cache is 2 times the input price). One cache read costs only 0.1 times and restarts the expiry time. So while idle, it uses `$.model.fork({ prompt: 'Reply with OK only' })` to send the main conversation a request with no tools, which reads the cache once.

- **When it sends**: `idle_minutes` (default 55) minutes after the main conversation's last request (or the last keep). At most `max_keeps` (default 3) per idle period. After that, the cache expires as usual. A new request in the main conversation restarts the count.
- **When it does not send**: the TTL is not 1h (a 5m cache has long expired at 55 minutes; it also does not send while the TTL is not yet known from the transcript), the last request's input is under 30k, the cache has already expired, or the conversation changed after `/clear`.
- **Result**: on success, the cache expiry is counted from the send time, and the cache line on desktop shows `kept 1/3`. Success, failure and the reasons for not sending are written only to the debug log (`keep warm …`) and do not disturb the screen. The fork's usage does not count toward `hit`.
- **Hot reload**: the timer is cleared. `session.start` schedules again from the last request time in `$.state`. If the planned time has already passed but the cache has not expired, it sends immediately.
- **Settings**: the `keep_warm` switch, `idle_minutes` (5-59), `max_keeps` (1-10). When the context exceeds the handoff threshold, the last keep produces the handoff summary instead. See "Handoff" below.

The fork is the main conversation's last request plus one more message. The model, system prompt and tools are therefore the same, and it reads the main conversation's cache (type file: "the API serves that prefix from its cache"). After a model change (`/model`), the fork rewrites the whole context. The type file does not say whether a fork's cache read also restarts the 1h expiry. This README assumes the usual cache behavior (every hit restarts the timer). If the `read` amount in the debug log is close to 0 at the next keep, the cache was not extended.

### Handoff

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

### Settings

`keep_warm` (off by default), `idle_minutes`, `max_keeps` (keep warm), `handoff_gate` (`suggest` / `block` / `off`, default `off`), `away_handoff` (off by default), `progress_resume` (handoff). For the layers, the limits on the repo file, and `/session-keeper on` / `off`, see "Settings" above.

## project-memory

### Cost

Automatic distilling is off by default. `/project-memory run` is a command you run yourself, and the switch does not limit it.

| Feature | Model | When called | Amount each time | What is sent |
| --- | --- | --- | --- | --- |
| `distill` automatic distilling | Sonnet (effort low) | Every `distill_every` (30) messages when the context is at least `min_context_k` (30) k; after `idle_minutes` (10) idle minutes; on `/clear` (each has a threshold, see "Distilling" below). When `MEMORY.md` exceeds the limit, one more merge request | Input is about the conversation added since the last run (tool input cut to 300 characters, results cut to 500) plus the list of existing memories, usually thousands to tens of thousands of tokens. Output is at most 4000 tokens | The new conversation with keys masked, the existing memories, the progress file |

- **How to estimate**: input tokens times the Sonnet input price plus output tokens times the output price. This is not a fork and does not read the main conversation's cache.
- **Where it goes**: through Claude Code's `$.model` to the same API provider the main conversation uses.
- **Subscriptions**: not billed by token, but it counts toward the usage quota. The conversion above is estimated at API prices.
- **Turn on**: `/project-memory on [duration]`, or keep `distill` on with `/config`.

### Distilling

- **When**: three triggers, all run in the background.
  - After the main conversation finishes an answer, when `distill_every` (default 30) user messages have passed since the last run and the context is at least `min_context_k` (default 30) k.
  - After `idle_minutes` (default 10) idle minutes since the last answer, with 5 or more new messages (context size is not checked). With 0, it does not distill when idle.
  - On `/clear` with 5 or more new messages: it captures the conversation in `session.end` first, then distills after switching to the new session. When you quit directly (`/exit`, ctrl+c), the hook has only about 1.5 seconds, which is not enough to distill.
  - `/project-memory run` distills immediately and shows the status. `/project-memory status` shows the status and settings. After an automatic run fails, it tries again after 5 more messages.
- **What is sent**: the conversation after the last user message that the previous run reached (if it is not found, the whole conversation is sent, but this run may not raise any occurrence count). Tool input is cut to 300 characters and results to 500, then masked with the rules of `secret-scrub`. If an action in the model's output contains a value that looks like a key, the whole line is dropped. Memories of the user and feedback types must carry the user's own words. If they cannot be matched, they are dropped.
- **Where it writes**: the memory folder is, first, the location from which the context loaded `MEMORY.md`. If it is not found, it uses `~/.claude/projects/<encoded repo root>/memory/` (worktrees share the main working tree's). Each memory and rule is one file named `pm-<type>-<alphanumerics from the title>-<hash>.md`. The frontmatter has `name`, `description` and `type`. The body has the approach, the reason, related files and the 3 latest pieces of evidence. If the main session edited these files, the next run takes the file content as the truth and keeps sections it does not recognize as they are. If a file was changed during distilling, this run does not write it, and the next run distills the same part again.
- **Related files**: when a memory is about specific files, it records their relative paths in the repo (at most 3). Each run checks whether the files still exist and marks the missing ones in the list for the model. If the file was only renamed, it changes the path. If what the memory says no longer holds, it marks it invalid. If it cannot tell, it leaves it alone.
- **Invalidation**: when the model removes a memory or rule, the file is not deleted. Instead it adds `invalidated` (date) and `superseded_by` (the entry that replaces it) to the frontmatter, and drops it from `MEMORY.md` and from later runs. The file is deleted after 90 days. Procedures exist only in `$.store`, so removing one is a real deletion.
- **Expiry**: project and reference entries that were not confirmed for more than 30 working days (days when a session was opened in this repo, recorded in `$.store`) are dropped from `MEMORY.md`. The file stays, and the entry is put back when confirmed again. After a break from work, entries do not all expire at once.
- **Limit**: only the first 200 lines of `MEMORY.md` load automatically, and it is shared with the main session's own memory, so `pm-` lines are limited to 60. If it exceeds that after a run, it sends one more request that may only merge and mark invalid. If it still exceeds the limit (or the request fails), it lists only the 60 most recently confirmed and keeps the other files.
- **Progress**: `.claude/progress.md` is updated only when there is real progress, and the whole file is replaced. When `session-keeper` hands off, it overwrites this file with the handoff summary and loads it into the new session (see "Handoff" in "session-keeper").

### Writing to the repo

For rules and procedures that 3 different sessions confirmed and that are not yet in the repo, the first prompt of each session attaches a notice (at most 3 at a time; the same one at most 2 times, 6 hours apart). A further confirmation in the same session adds only evidence, not a count.

- **Rules**: CLAUDE.md is the user's to decide, so Claude does not edit it directly. At the end of its reply, it lists the text to add and where, and asks whether you want it. Only after you agree does it write it, then call `mark_in_project` to report the location. The rule's memory file is then deleted, and only a record stays in `$.store`. If you decline, it is marked "do not put", and the rule stays in memory as before.
- **Procedures**: made directly into `.claude/skills/<name>/SKILL.md` (a new file; you read the diff and decide whether to keep it). After it is reported, there is no further notice.

Nothing is committed.

### Settings

`distill` is the automatic distilling switch (off by default; when off, it does not distill on idle or `/clear` either; for a temporary on, use `/project-memory on`). Others: `distill_every` (5-200), `min_context_k` (0-1000, affects only the every-N-messages run), `idle_minutes` (0-120, 0 means no distilling when idle), and `promote`, the switch for notices about writing to the repo.

Values from `/config` are stored in `pluginConfigs` in the user-level `~/.claude/settings.json` and shared by all repos. Tested on 2.1.295 on 2026-10-09: `pluginConfigs` in the repo's `.claude/settings.json` and `.claude/settings.local.json` do not take effect. To adjust per repo, use the repo or local file described in "Settings" above.

## agent-dispatch

### Usage ledger

Each session keeps its own ledger in the plugin's `$.store` (one key per session, shared across repos). It records:

- The session: its repo (the main working tree, so worktrees group together), its start time and the first 40 characters of its first prompt that is not a slash command, which together name it (`Oct 12 02:11 review the diff…`), and the main session's tokens per model. After `/clear` the new session gets its own start and name; mods cannot read the session's own title.
- Each spawn (the latest 500 per session): description, agent type, the model the call named (or the default) and the model it resolved to, whether it was a fork or ran in the background, input / cache write / cache read / output tokens, steps and duration. Steps of an agent the ledger never saw spawn (one spawned before a hot reload) are listed as `unknown`.

Ledgers no session has written to for 90 days are deleted when a session starts.

`/agent-dispatch stats [days]` (1-90, default 30, today included) opens a pane over every session:

- Two cards, side by side from 60 body columns and stacked when narrower. **Tokens** (input + cache write + output) with a bar split into the main session (purple) and subagents (cyan) and the subagent share. **Spawns** by where the model came from, three kinds that add up to the total: named a model (yellow, with how many named Opus), the default model (gray), and forks (green, which run on the main session's model). Cache read is a line of its own under the cards.
- Rows grouped by repo (by folder name), session, model or agent type (`Group by`), each with a bar (Svg on desktop, colored cells in the terminal), its tokens, share and spawns. From 80 body columns a row is one line; narrower, its bar goes on a second line.
- Press a row's name to open it: the same two cards for that row, then its spawns as a table (a dot in the color of where the model came from, description, bar, tokens, date), most tokens first; `Sort` switches to newest or longest run first. Ten are listed, and `N more` lists ten more. Press a spawn to open it in place to its type, model, run (background, steps, duration) and session; one at a time. The main session row of the type grouping lists each session's own tokens instead. `‹ Back` (`b`) returns.
- `Period` switches between 7, 30 and 90 days.

In a narrow terminal the pane opens above the input box instead of beside the conversation. `/agent-dispatch stats --text [days]` prints the same report as text. `stats` prints it too in a `-p` run, or when no pane can be placed.

Not included: the mods' own model calls (`$.model.fork` / `$.model.complete`), cloud sessions (they do not load mods), and anything before the mod was installed.

### Settings

`ledger` (default on) turns recording on or off; off records nothing, and `stats` still reads what exists. The repo file cannot set it.

## Known limitations

- `secret-scrub` rewrites this session's records in `history.jsonl` (including `paste-cache`) about 3 seconds after masking and when the session ends. Only the CLI writes this file. The up-arrow history that the CLI already loaded into memory before the rewrite may still show the original text. A file over 4 MiB cannot be read, and a failure notice is shown.
- `output-trimmer` changes only what the model reads. The screen still shows the full output.
- `tool-guard` parses commands with regular expressions and a simple tokenizer. It cannot detect `eval`, `bash -c "…"`, `xargs rm`, `find -delete`, or calls inside script files. The force-push list depends on the remote state as of the last fetch. For migrations such as Django's, the list needs the project's own status command (for example `python3 manage.py showmigrations`), which loads the project's code before you press run.
- The confirmation panel of `tool-guard` is opened by a Claude tool call, which makes it a pane "not requested by the user". The terminal needs 144 columns or more (110 after it has been opened once) to fit it. Otherwise it uses the question dialog. The reason it was not placed is recorded in the debug log (`tool-guard: pane not placed`). While the panel waits, Claude pauses. If there is no response for 10 minutes, or Esc interrupts the turn, the command does not run.
- When `self-check` blocks a stop, the screen shows it as a Stop hook error (how Claude Code presents a Stop hook `block`), and Claude then goes on to verify. Editing files with Bash (`sed -i`, `python3`) does not yet count as editing code files. The "done" judgment looks only at the start and end of the reply for phrases such as 「完成了」 (done), 「已修好」 (fixed) and "all done". A different wording is missed.
- The handoff of `session-keeper` relies on putting the draft into the input box after `/clear`. If it cannot be put in (for example a dialog is in the way), a toast says so, and the summary is still in `.claude/progress.md`. When an offer appears in `suggest` mode, the new prompt has already paid for a round of large context.
- `project-memory` deletes files with `rm` (`$.fs` has no delete), so it supports only macOS / Linux. The default memory folder path is derived from Claude Code's naming. If another location is set (for example `autoMemoryDirectory`) and the context did not load `MEMORY.md`, it writes to the wrong place. Distilling looks only at the main conversation. Subagent content does not count.
- When the check itself fails, both mods fail closed. `tool-guard` blocks commands that contain `git`, `rm` or `migrate` (other commands run as usual), and `/tool-guard allow` allows one. `secret-scrub` does not send the prompt and puts the original text back in the input box. When you are sure there are no secrets, add `#noscrub` (or the configured `bypass_marker`) and send again.

## License

[MIT](LICENSE). Some code is adapted from [cablate/ctx-handoff-mod](https://github.com/cablate/ctx-handoff-mod) (MIT). See [NOTICE](NOTICE).
