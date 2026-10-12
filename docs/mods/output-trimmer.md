# output-trimmer

English | [繁體中文](output-trimmer.zh-TW.md) · [All mods](../../README.md#the-mods)

When a Bash command prints too much, the model gets only the head, the tail and the error lines. The full output is saved to a file, so nothing is lost and no context is wasted on build logs.

| Uses a model | CLI | Desktop | Cloud |
| --- | --- | --- | --- |
| No | Yes | Yes | No |

## What it does

- When Bash output exceeds 150 lines or 15k characters (`max_lines`, `max_chars`), the model gets only the beginning, the end and the error lines.
- The full output is saved to `$TMPDIR/claude-output-trimmer/`, and the trimmed result says where. A toast says how many lines were left out.
- File-reading commands are left alone.
- Add `# notrim` to a command to get the full output.

## Settings

| Key | Default | Range | Repo file | Meaning |
| --- | --- | --- | --- | --- |
| `max_lines` | 150 | 50-5000 | Can be set | Trim when Bash output has more lines than this |
| `max_chars` | 15000 | 2000-200000 | Can be set | The same when it has more characters than this |

`/output-trimmer status`, `set` and `unset` see and change them. For the layers, see [Settings](../settings.md).

## Known limitations

- It changes only what the model reads. The screen still shows the full output.
