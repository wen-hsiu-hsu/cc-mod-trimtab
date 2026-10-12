# cc-mod-trimtab

A set of Claude Code mods (function-hook plugins). Each mod lives in `mods/<mod>/` and installs on its own.

Before changing anything, read [docs/development.md](docs/development.md) (in Chinese). It has the docs map, the check commands, the rules for writing a mod, the rules for mods running together, and the release steps.

- **Work in a worktree**: sessions that load this clone pick up half-done code at once. Merge back to master only after the checks pass.
- **Checks**: `claude plugin validate mods/<mod>`, `claude plugin test mods/<mod>`, `claude plugin validate .`, `scripts/check-copies.sh`, `scripts/check-docs.sh`.
- **Update the docs when you finish** (the full table is under「改完之後」in development.md):
  - Behaviour users can see: change `docs/mods/<mod>.md` and `.zh-TW.md` together. The README only introduces; no details there.
  - A decision made between real alternatives: add `docs/adr/NNNN-<slug>.md` and list it in the index.
  - Test results: the「查證結果」section of `ROADMAP.md`.
  - Screens: change `DESIGN.md` first.
- **Commit check**: a hook in `.claude/settings.json` runs `scripts/check-docs.sh --commit` before `git commit` and `git push`; a push is blocked while a mod changed since the last tag lacks a version bump, a CHANGELOG entry or a new tag (`# Release: n/a <reason>` skips it). A commit that changes a mod's code without its docs or an ADR is blocked; when neither is needed, end the message with `Docs: n/a <reason>` and `ADR: n/a <reason>`.
- **Languages**: this file and the ADRs are in English; development.md, DESIGN.md and ROADMAP.md are in Chinese; user docs (README and the rest of `docs/`) have one English and one Chinese file each.
