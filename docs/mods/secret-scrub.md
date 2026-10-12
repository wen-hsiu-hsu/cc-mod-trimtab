# secret-scrub

English | [繁體中文](secret-scrub.zh-TW.md) · [All mods](../../README.md#the-mods)

Masks tokens, API keys and other secrets in your prompt before it is sent, so they stay out of the transcript and the prompt cache.

| Uses a model | CLI | Desktop | Cloud |
| --- | --- | --- | --- |
| No | Yes | Yes | No |

## What it does

- **Masks before sending**: `token=`, `Bearer`, `sk-…`, `ghp_…`, JWTs, private keys, `*_TOKEN=` and similar are replaced before the prompt leaves the input box.
- **Bypass**: a prompt that contains `#noscrub` (changeable with `bypass_marker`) is sent as is.
- **Your own rules**: add patterns with `custom_rules` and exceptions with `allow` (an exception must match the whole masked text).
- **History**: the input history (`history.jsonl`) is also rewritten with the masked content. `/secret-scrub history` cleans old records from all sessions.
- **Fails closed**: if the check itself fails, the prompt is not sent and the original text goes back into the input box. When you are sure there are no secrets, add `#noscrub` (or the configured `bypass_marker`) and send again.

Keep `secret-scrub` first in `enabledPlugins` so that no other mod sees the prompt before it is masked (see [Install order](../install.md#install-order)). For what it does and does not protect, see [SECURITY.md](../../SECURITY.md).

## Commands

| Command | What it does |
| --- | --- |
| `/secret-scrub history` | Clean secrets out of old `history.jsonl` records of every session |
| `/secret-scrub status`, `set`, `unset` | See and change settings (see [Settings](../settings.md#commands)) |

## Settings

| Key | Default | Repo file | Meaning |
| --- | --- | --- | --- |
| `custom_rules` | `[]` | Cannot be set | Extra patterns to mask (a list, set in `~/.claude/cc-mod-trimtab.json`) |
| `allow` | `[]` | Cannot be set | Text that is never masked (a list) |
| `bypass_marker` | `#noscrub` | Cannot be set | A prompt that contains it is sent as is |

The repo file cannot set any of them: `allow` and `bypass_marker` would loosen protection, and a `custom_rules` pattern that backtracks forever would hang every prompt (JavaScript regular expressions have no timeout). For the layers, see [Settings](../settings.md).

## Known limitations

- It rewrites this session's records in `history.jsonl` (including `paste-cache`) about 3 seconds after masking and when the session ends. Only the CLI writes this file. The up-arrow history that the CLI already loaded into memory before the rewrite may still show the original text. A file over 4 MiB cannot be read, and a failure notice is shown.
- It sees only prompts. Files Claude reads, tool output, and anything sent by mods ordered before it are not masked.
