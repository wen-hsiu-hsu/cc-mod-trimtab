# Settings

English | [繁體中文](settings.zh-TW.md) · [Back to README](../README.md)

## Layers

Each mod reads its settings from these layers, from highest to lowest, and takes the first one that has a value:

1. **session**: `/<mod> set <key> <value>`. It applies to this session only.
2. **local**: `.claude/cc-mod-trimtab.local.json`. It is not committed (added to `.git/info/exclude` on the first write). Use this file in repos you forked from someone else.
3. **repo**: `.claude/cc-mod-trimtab.json`. It is committed to the project and shared by the team, but it can only make protection stricter or spending lower (see [What a repo file may change](#what-a-repo-file-may-change)).
4. **user**: single values go in `/config` (stored in `pluginConfigs` in `~/.claude/settings.json`). List values (`custom_rules`, `allow`, `rm_skip_paths`) go in `~/.claude/cc-mod-trimtab.json`, because `/config` cannot store lists.
5. **default**.

The three files have the same format: `{ "<mod>": { "<key>": value } }`.

## Language

The text the mods show is in English (`en`) by default; Traditional Chinese (`zh-TW`) is also available. Set it once for every mod in `~/.claude/cc-mod-trimtab.json` (or `.claude/cc-mod-trimtab.local.json` for one project), under `"*"`:

```json
{ "*": { "language": "zh-TW" } }
```

- A mod's own section overrides `"*"` in the same file, and `/<mod> set language zh-TW` changes one mod. The committed repo file cannot set `language`.
- Content the model writes for you (`project-memory` memories and `.claude/progress.md`, `session-keeper` handoff summaries) follows the same setting. Instructions sent to the model are always in English.
- `/config` does not show `language`, and the `/config` titles are in English only.

## Commands

Every mod registers `/<mod>` with the same subcommands:

```
/<mod> status                                  # current value of each setting, which layer it comes from, how the repo may change it, and ignored values
/<mod> set <key> <value> [--session|--local|--repo]   # default --session; write lists as a JSON array, otherwise the whole text counts as one item
/<mod> unset <key> [--session|--local|--repo]
/<mod> on [feature] [duration]                 # temporarily turn on a model-using feature; default 2h, at most 24h (2h, 90m, 1h30m)
/<mod> off [feature]                           # turn off in this session
```

## Features that use a model

Features that use a model (`keep_warm`, `away_handoff` and `handoff_gate` of `session-keeper`, and `distill` of `project-memory`) are **off by default**. For costs, see "Cost" on the [session-keeper](mods/session-keeper.md#cost) and [project-memory](mods/project-memory.md#cost) pages:

- **Temporary on**: `/<mod> on`. It turns off by itself when the time is up or the session ends (including `/clear`), and writes no file. While it is on, one gray line above the input box shows it, for example `session-keeper on · keep_warm 1h42m`. When a mod has more than one such feature, name the feature (`/session-keeper on keep_warm 2h`). A feature that is already always on through settings does not change.
- **Always on**: `/config`, `.claude/cc-mod-trimtab.local.json` or the user-level file. The committed `.claude/cc-mod-trimtab.json` in the repo cannot turn them on.
- **Off**: `/<mod> off` turns the feature off for this session only. Always-on settings return in the next session.
- The first time each feature uses a model in a session, a toast reminds you once.

## What a repo file may change

What the repo file may do depends on the kind of setting. Values that break the rule are not used, and `/<mod> status` lists the reason. `set --repo` does not write values that would be ignored:

| Category | Setting | Repo file |
| --- | --- | --- |
| Protection | `commit_format` of `tool-guard` | Can only turn it on |
| Protection | `allow` and `bypass_marker` of `secret-scrub`; `rm_skip_paths` of `tool-guard` | Cannot be set (they would loosen protection) |
| Protection | `custom_rules` of `secret-scrub` | Cannot be set: JavaScript regular expressions have no timeout, and a rule that backtracks forever would hang every prompt |
| Cost | `keep_warm`, `away_handoff`, `max_keeps`, `idle_minutes`, `handoff_gate` of `session-keeper`; `distill`, `distill_every`, `min_context_k`, `idle_minutes` of `project-memory` | Can only turn off or lower the spending; `handoff_gate` and `idle_minutes` of `project-memory` cannot be set |
| General | Others (for example the thresholds of `output-trimmer`, `commit_pattern` and `strip_attribution` of `tool-guard`) | Can be set freely, except `language` and the `ledger` of `subagent-dispatch`, which cannot be set |

After you change a file, `/<mod> status` rereads it. At other times the files are read once when the session starts.

Each mod's own settings, with defaults and ranges, are listed on its page: [secret-scrub](mods/secret-scrub.md#settings), [tool-guard](mods/tool-guard.md#settings), [output-trimmer](mods/output-trimmer.md#settings), [subagent-dispatch](mods/subagent-dispatch.md#settings), [session-keeper](mods/session-keeper.md#settings), [self-check](mods/self-check.md#settings), [project-memory](mods/project-memory.md#settings). `open-items` has no settings besides `language`.
