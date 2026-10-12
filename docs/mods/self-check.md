# self-check

English | [繁體中文](self-check.zh-TW.md) · [All mods](../../README.md#the-mods)

Guard-rail reminders for Claude. They never block you: they catch Claude retrying a failing call unchanged, and Claude saying "done" about code it never verified.

| Uses a model | CLI | Desktop | Cloud |
| --- | --- | --- | --- |
| No | Yes | Yes | No |

## What it does

- **Repeated failure** (`retry_nudge`): when the same tool fails twice in a row for the same reason (the error text is identical after paths and numbers are removed), it asks Claude, after the second result, to find the cause first and not retry unchanged.
- **Done without verifying** (`done_check`): when Claude edited code files this turn (Edit / Write, not documents such as `.md` or `.txt`, and not edits by subagents), did not run tests, a build or a check afterward, and the reply says the work is done, it blocks that stop once and asks Claude to verify. It does not block if the reply says it did not verify.
- If it hits an error, it skips and does not affect tool calls or stops.

## Settings

| Key | Default | Repo file | Meaning |
| --- | --- | --- | --- |
| `retry_nudge` | on | Can be set | The repeated-failure reminder |
| `done_check` | on | Can be set | The done-without-verifying check |

`/self-check status`, `set` and `unset` see and change them. For the layers, see [Settings](../settings.md).

## Known limitations

- When it blocks a stop, the screen shows it as a Stop hook error (how Claude Code presents a Stop hook `block`), and Claude then goes on to verify.
- Editing files with Bash (`sed -i`, `python3`) does not yet count as editing code files.
- The "done" judgment looks only at the start and end of the reply for phrases such as 「完成了」 (done), 「已修好」 (fixed) and "all done". A different wording is missed.
