# cc-mod-trimtab

English | [繁體中文](README.zh-TW.md)

**Small mods that keep Claude Code from losing your work, your secrets and your tokens.**

A trim tab is the small flap on a rudder that steers the whole ship. These mods do the same for Claude Code: each one is a few hooks that sit quietly in the session and step in only at the moment something would go wrong. Install the ones you want; none of them depends on another.

- **Fewer mistakes**: risky git and `rm` commands show what they would destroy before they run, and Claude is asked to verify before it calls edited code done.
- **Fewer tokens**: long command output is trimmed before the model reads it; turn on `session-keeper` and the prompt cache stays warm while you step away, and a large context is handed off to a fresh session instead of dragging on.
- **More fault tolerance**: interrupted background agents come back in one key press, open questions survive `/clear`, and with `project-memory` on, what you learn in one session is waiting in the next.
- **No extra services, no surprise spending**: no mod contacts a service of its own. The few features that call a model go through Claude Code's own model API with your account, and they are off until you turn them on.

## The mods

| Mod | What it does for you |
| --- | --- |
| [`secret-scrub`](docs/mods/secret-scrub.md) | Masks API keys, tokens and private keys in your prompt before it is sent, so they stay out of the transcript and the prompt cache. |
| [`tool-guard`](docs/mods/tool-guard.md) | Holds `git reset --hard`, force pushes, `rm -rf` and migrations, lists exactly which files or commits they would lose (or which migrations would run), and lets you decide. Harmless runs pass straight through. |
| [`output-trimmer`](docs/mods/output-trimmer.md) | When a Bash command prints thousands of lines, the model reads only the head, the tail and the errors; the full output is saved to a file. |
| [`subagent-dispatch`](docs/mods/subagent-dispatch.md) | Brings interrupted background agents back with one key, and shows where your tokens went: main session, subagents, models, every spawn. |
| [`open-items`](docs/mods/open-items.md) | Keeps undecided questions and deferred items outside the context, counts them above the prompt box, and quotes one back in a key press. |
| [`session-keeper`](docs/mods/session-keeper.md) | Shows the prompt cache state on desktop, and, once turned on, keeps a 1h cache warm while you are away and offers a handoff to a fresh session when the context gets expensive. |
| [`self-check`](docs/mods/self-check.md) | Asks Claude to find the cause when the same tool fails twice the same way, and to verify before it says "done" after editing code. |
| [`project-memory`](docs/mods/project-memory.md) | Once turned on, distills each conversation in the background into Claude Code's own memory and a progress file; rules confirmed across sessions are proposed for CLAUDE.md. |

## Quick start

Requires Claude Code 2.1.296 or later, in the CLI or desktop app (cloud sessions cannot load mods yet).

```bash
claude plugin marketplace add wen-hsiu-hsu/cc-mod-trimtab
```

Then, in Claude Code, install the mods you want. Install `secret-scrub` first so that it sees every prompt before other mods do:

```
/plugin install secret-scrub@cc-mod-trimtab
/plugin install tool-guard@cc-mod-trimtab
/plugin install output-trimmer@cc-mod-trimtab
/plugin install subagent-dispatch@cc-mod-trimtab
/plugin install open-items@cc-mod-trimtab
/plugin install session-keeper@cc-mod-trimtab
/plugin install self-check@cc-mod-trimtab
/plugin install project-memory@cc-mod-trimtab
```

The mods work right after install, with safe defaults. Features that call a model (in `session-keeper` and `project-memory`) stay off until you run `/<mod> on` or turn them on in `/config`. Run `/<mod> status` to see what a mod is set to.

## Documentation

- [Install and update](docs/install.md): versions, updating, the install order, cloud sessions.
- [Settings](docs/settings.md): the setting layers, interface language, turning model features on and off, what a committed repo file may change.
- Each mod's page (linked in the table above): every behaviour, command, setting, cost and known limitation.
- [Changelog](CHANGELOG.md) and [security](SECURITY.md).
- Contributing: [development guide](docs/development.md), [architecture decisions](docs/adr/README.md), [UI rules](DESIGN.md) and the [roadmap](ROADMAP.md) (these are in Chinese).

## License

[MIT](LICENSE). Some code is adapted from [cablate/ctx-handoff-mod](https://github.com/cablate/ctx-handoff-mod) (MIT). See [NOTICE](NOTICE).
