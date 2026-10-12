# self-check looks only at Edit / Write and an explicit "done"

- Status: accepted
- Date: 2026-10-09

"Done without verifying" follows upstream: it blocks only when the reply says something like 「完成了」 (done); files edited by subagents and doc-only edits do not count. Upstream counts only Edit / Write and misses edits made through Bash (that waits for bash-edit-snapshot's write detection, deferred in ROADMAP). The reply-language reminder was not ported. Upstream: `loops.ts`; `classic.Stop` and `tool.call` in `register.ts`.
