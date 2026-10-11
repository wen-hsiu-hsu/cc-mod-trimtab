# Security

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/wen-hsiu-hsu/cc-mod-trimtab/security/advisories/new)
instead of opening a public issue. Include the mod name, its version (from
`/plugin`), your Claude Code version and the steps to reproduce.

## What the mods do and do not protect

- **`secret-scrub` is best effort.** It masks secrets that match known formats
  (`token=`, `Bearer`, `sk-…`, `ghp_…`, JWTs, private keys, `*_TOKEN=` and the
  like) before a prompt is sent. Secrets in other formats pass through
  unchanged. Do not rely on it as your only protection against pasting
  credentials.
- `secret-scrub` only sees prompts. Files Claude reads, tool output and
  anything sent by mods ordered before it in `enabledPlugins` are not masked.
- `secret-scrub` rewrites this session's entries in `history.jsonl` a few
  seconds after masking. Until then, and in the CLI's in-memory history, the
  original text may remain.
- **`tool-guard` is not a sandbox.** It parses shell commands with regular
  expressions and simple tokenizing, so `eval`, `bash -c "…"`, `xargs rm`,
  `find -delete` and calls inside script files are not detected.
- Features that call a model (`session-keeper`'s `keep_warm`, `away_handoff`
  and `handoff_gate`, `project-memory`'s `distill`) go through Claude Code's
  own model API with your account; no mod contacts any other service.
  `project-memory` masks the conversation with the `secret-scrub` rules before
  sending it. These features are off by default.

When a check itself fails, `secret-scrub` and `tool-guard` block rather than
let the input through.
