# Architecture decision records

A decision gets an ADR when it is hard to reverse, surprising without its context, and the result of a real trade-off between alternatives. How to write one is in the [development guide](../development.md#adr).

| No. | Decision | Date |
| --- | --- | --- |
| [0001](0001-one-repo-independent-mods.md) | One repo, one marketplace, mods that do not depend on each other | 2026-10-09 |
| [0002](0002-names.md) | Names: `cc-mod-trimtab`, and mods are not renamed once public | 2026-10-11 |
| [0003](0003-versions-and-release.md) | Each mod has its own version; the repo gets a tag | 2026-10-11 |
| [0004](0004-support-range.md) | Support only Claude Code 2.1.296 or later, in the CLI and desktop | 2026-10-11 |
| [0005](0005-docs-layout.md) | Docs layout: the README introduces, `docs/` holds the details, decisions go in ADRs | 2026-10-12 |
| [0006](0006-interface-language.md) | Interface language: English by default, Traditional Chinese available | 2026-10-11 |
| [0007](0007-settings-layers.md) | Settings layers: mods read the repo layer themselves, and it can only tighten protection or lower spending | 2026-10-11 |
| [0008](0008-commands.md) | Commands: one `/<mod>` per mod, with the same subcommands | 2026-10-12 |
| [0009](0009-model-features-off-by-default.md) | Features that call a model are off by default and can be turned on for a while | 2026-10-11 |
| [0010](0010-ui-rules.md) | UI rules live in DESIGN.md, and each mod with a screen has its own copy of the drawing code | 2026-10-12 |
| [0011](0011-shared-code-copied-per-mod.md) | Shared code is copied into each mod and checked by a script | 2026-10-11 |
| [0012](0012-order-independent-hooks.md) | Mods do not depend on hook order; only secret-scrub must be first | 2026-10-10 |
| [0013](0013-adapt-ctx-handoff-mod.md) | Adapt parts of ctx-handoff-mod instead of forking it | 2026-10-09 |
| [0014](0014-mod-grouping.md) | Group features into mods by shared data or a shared event | 2026-10-09 |
| [0015](0015-handoff-suggests-only.md) | Handoff only suggests, it never clears by itself | 2026-10-09 |
| [0016](0016-memory-in-built-in-memory.md) | Memory goes into Claude Code's built-in memory; progress and the handoff summary share one file | 2026-10-09 |
| [0017](0017-keep-warm.md) | When session-keeper keeps the cache warm | 2026-10-09 |
| [0018](0018-self-check.md) | self-check looks only at Edit / Write and an explicit "done" | 2026-10-09 |
| [0019](0019-failure-behaviour.md) | When a check itself fails, the guards block and self-check skips | 2026-10-12 |
| [0020](0020-memory-file-anchors.md) | Related files in project-memory carry an anchor string, checked by plain text search | 2026-10-12 |
| [0021](0021-focused-row-actions.md) | The open-items pane acts on the focused row; only the row's id is a button | 2026-10-13 |
| [0022](0022-resolved-items-in-tombstones.md) | open-items keeps a resolved item inside its tombstone for 7 days | 2026-10-13 |
| [0023](0023-daily-main-ledger.md) | The usage ledger keeps the main session's tokens per local day | 2026-10-13 |
| [0024](0024-day-rows-recomputed-whole.md) | Day rows are computed whole from the ledgers and written once | 2026-10-14 |
| [0025](0025-backfill-at-session-start.md) | The ledger is backfilled from transcripts at session start, behind a mark in the store | 2026-10-14 |
