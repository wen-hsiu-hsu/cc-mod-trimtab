# tool-guard

English | [繁體中文](tool-guard.zh-TW.md) · [All mods](../../README.md#the-mods)

Holds commands that would lose work, measures exactly what they would lose, and lets you decide. Commands that lose nothing pass straight through. It can also check the commit subject format and remove the Claude attribution trailer.

| Uses a model | CLI | Desktop | Cloud |
| --- | --- | --- | --- |
| No | Yes | Yes | No |

## What it holds

Each rule measures the impact before asking:

| Command | What it measures |
| --- | --- |
| `git reset --hard`, `checkout --`, `restore` | Uncommitted files that would be lost |
| `git clean -f` | Untracked files that would be deleted |
| Force push | Remote commits that would be overwritten (as of the last fetch) |
| `git stash drop` / `clear` | The stash entries |
| `--no-verify` | Skipped hooks |
| `rm -r` / `rm -f` | Number and size of files to delete. Files under `$TMPDIR`, `/tmp`, `/var/folders` and `rm_skip_paths` are not counted |
| Database migrations | Pending migrations |

Commands that cause no loss run without asking: a clean working tree, a force push that drops no commits and is not to main/master, an `rm` with no matching files, no pending migrations.

## How you decide

- **Confirm panel**: lists the impact. Press `1` to run, `2` to cancel. While it waits, Claude pauses. If there is no answer for 10 minutes, or Esc interrupts the turn, the command does not run.
- **Narrow terminal**: if the panel does not fit, it uses the built-in question dialog instead. It lists the same impact; choose "Run" or "Cancel", or type a reply to Claude.
- **Non-interactive** (such as `-p`): nobody can answer, so it blocks the command and writes the impact into the reason. Type `/tool-guard allow` to allow the next command of the same kind once (within 10 minutes).
- **Fails closed**: if the check itself fails, it blocks commands that contain `git`, `rm` or `migrate` (other commands run as usual). `/tool-guard allow` allows one.

## Commits

- `commit_format` (off by default) checks the commit subject against a format; `commit_pattern` sets your own regular expression.
- `strip_attribution` (on by default) removes Claude's `Co-Authored-By` trailer from commit messages.

## Commands

| Command | What it does |
| --- | --- |
| `/tool-guard allow` | Allow the next blocked command of the same kind once, for 10 minutes |
| `/tool-guard status`, `set`, `unset` | See and change settings (see [Settings](../settings.md#commands)) |

## Settings

| Key | Default | Repo file | Meaning |
| --- | --- | --- | --- |
| `commit_format` | off | Can only turn it on | Check the commit subject format |
| `commit_pattern` | empty | Can be set | Your own subject format, as a regular expression. Empty means the built-in format `<emoji> <type>(<scope>)!: <description>` (Conventional Commits; emoji and scope optional). An invalid pattern falls back to it with a notice |
| `strip_attribution` | on | Can be set | Remove Claude's `Co-Authored-By` trailer |
| `rm_skip_paths` | `[]` | Cannot be set | Paths whose files `rm` does not count (a list, set in `~/.claude/cc-mod-trimtab.json`) |

For the layers, see [Settings](../settings.md).

## Known limitations

- It is not a sandbox. It parses commands with regular expressions and a simple tokenizer, so it cannot detect `eval`, `bash -c "…"`, `xargs rm`, `find -delete`, or calls inside script files.
- The force-push list depends on the remote state as of the last fetch.
- For migrations such as Django's, the list needs the project's own status command (for example `python3 manage.py showmigrations`), which loads the project's code before you press run.
- The confirm panel is opened by a Claude tool call, which makes it a pane "not requested by the user". The terminal needs 144 columns or more (110 after it has been opened once) to fit it; otherwise it uses the question dialog. The reason it was not placed is written to the debug log (`tool-guard: pane not placed`).
