# Docs layout: the README introduces, `docs/` holds the details, decisions go in ADRs

- Status: accepted
- Date: 2026-10-12

The README used to hold every detail of every mod in one table and long sections (300+ lines). Prospective users could not see the highlights, and agents working on the repo could not tell where the rules were. Now:

- **The README (English and Chinese) only introduces**: the highlights, one line per mod, a quick start and links. It changes only when a mod is added or renamed.
- **User docs live in `docs/`, one English and one Chinese file each**: `install`, `settings` and `docs/mods/<mod>`. Each mod's page is the single source for its behaviour, commands, settings, cost and known limitations. The English file is `<name>.md`, the Chinese one `<name>.zh-TW.md`, and both change together.
- **Developer docs**: `CLAUDE.md` (the entry point for agents) and the ADRs are in English; `docs/development.md`, `DESIGN.md` and `ROADMAP.md` are in Chinese. Their readers are the maintainer and the agents working on the repo, so they are not kept in two languages.
- **Decisions are ADRs**: the "decisions" and "design records" that used to be in ROADMAP moved to `docs/adr/`, one decision per file. ROADMAP keeps only work not done yet, deferred and rejected proposals, known issues and verification results.

To keep the docs in step with the code, `scripts/check-docs.sh` checks before a commit (a Claude Code PreToolUse hook runs it before `git commit`; CI runs its structure checks). A commit that changes a mod's code must also change that mod's docs and add or change an ADR, or say why not with `Docs: n/a <reason>` and `ADR: n/a <reason>` lines in the message. English and Chinese docs must change together.

Considered:

- **A Stop hook at the end of every reply**: it would block every turn during development; a commit is the point where a change takes shape.
- **A git pre-commit hook**: each clone must set `core.hooksPath` itself, and worktrees and new clones miss it. The Claude Code hook lives in the committed `.claude/settings.json`, which every development session loads.
- **Only a rule in CLAUDE.md**: agents do not always follow it; test results were already left out of the docs before.
- **Deciding automatically whether an ADR is needed**: telling a decision from a change needs a model. Requiring an explicit `ADR: n/a` makes whoever writes the commit think about it every time.
