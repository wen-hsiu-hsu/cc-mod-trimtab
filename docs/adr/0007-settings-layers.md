# Settings layers: mods read the repo layer themselves, and it can only tighten protection or lower spending

- Status: accepted
- Date: 2026-10-11

Usage is in [Settings](../settings.md).

- **Mods read the repo-layer file themselves**: `pluginConfigs` is read only from user or managed settings; there is no project layer (ROADMAP, verification result 1). The code that reads settings (`hooks/config.ts`) is copied into every mod, and `check-copies.sh` checks the copies match.
- **A committed repo file can only tighten protection or lower spending**: a cloned repo must not turn off `secret-scrub` or `tool-guard`, nor turn on token-spending features for the user. Each key has a category (protection, cost, general) and a repo rule; values that break the rule are not used, and `/<mod> status` lists why. A `never` key is rejected even when it equals the lower layer, so `set --repo` never writes it into the repo file.
- **`.local.json`**: for a repo forked from someone else, so the other project gets no extra file; it is added to `.git/info/exclude` on the first write.
- **Lists live in the user-layer file**: `/config` stores only strings, numbers and booleans.
- **The repo file cannot set `custom_rules` of `secret-scrub`**: JavaScript regular expressions have no timeout, and a committed rule that backtracks forever would hang every prompt. `allow` must match the whole text.
- **Personal habits are off by default**: the commit subject check is off (the maintainer turns it on in `pluginConfigs`); removing the Claude attribution is on.
- **Guard and rewrite rules go in the repo layer** (future features): approved guard rules and cmd-rewrite rules follow the layers; committed ones go in `.claude/cc-mod-trimtab.json`, and ones for a forked repo in `.claude/cc-mod-trimtab.local.json`.
- **Committed cmd-rewrite rules need approval first** (future feature): rewriting a command does not "tighten protection"; a cloned repo could rewrite `npm test` into any command in `.claude/cc-mod-trimtab.json`. So a committed rewrite rule needs the user's approval before it first applies, the rule's hash is recorded, and a changed rule needs approval again. Rules in `.local.json` do not.
