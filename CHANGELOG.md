# Changelog

Each mod keeps its own version in `mods/<mod>/.claude-plugin/plugin.json`.
Repository releases are tagged `vX.Y.Z` and list the mod versions they ship.

## [0.1.0] - 2026-10-11

First public release.

| Mod | Version |
| --- | --- |
| `agent-dispatch` | 0.1.0 |
| `open-items` | 0.3.0 |
| `output-trimmer` | 0.1.0 |
| `project-memory` | 0.1.0 |
| `secret-scrub` | 0.2.0 |
| `self-check` | 0.1.0 |
| `session-keeper` | 0.3.0 |
| `tool-guard` | 0.2.0 |

- Layered settings (session, `.claude/cc-mod-trimtab.local.json`,
  `.claude/cc-mod-trimtab.json`, user, default), with `/<mod> status`, `set`
  and `unset`. The committed repo file can only make protection stricter or
  spending lower.
- Features that call a model are off by default. `/<mod> on [feature] [time]`
  turns one on for the current session (default 2h, up to 24h); `off` turns it
  off.
- UI language: English by default, Traditional Chinese with `"*": { "language": "zh-TW" }`
  in `~/.claude/cc-mod-trimtab.json`. Manifests and `/config` titles are English.
- Personal habits (commit title format and similar checks) are settings, off by
  default.
