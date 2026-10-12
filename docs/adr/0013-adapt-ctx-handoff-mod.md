# Adapt parts of ctx-handoff-mod instead of forking it

- Status: accepted
- Date: 2026-10-09

Source: [cablate/ctx-handoff-mod](https://github.com/cablate/ctx-handoff-mod) v0.5.0 (MIT, commit `3a06bc8`). Not forked as a whole: its hooks are about 4,200 lines, upstream moves fast, and its automatic handoff (an automatic `/clear` at 600k) and reply-language reminder overlap with the plans here. Only five pieces were taken (keep warm, progress reminder, project notes, guards, guard-rail reminders) and rewritten to the coexistence rules and conventions of the [development guide](../development.md#多個-mod-共存). Two of its habits were not copied: its panel replaces `AbovePrompt` instead of stacking the result of `next(e)`, and its `prompt.submit` changes state before `next`. The 3 files that reuse its code (`self-check/hooks/loops.ts`, `project-memory/hooks/distill.ts`, `promote.ts`) are listed in `NOTICE`.
