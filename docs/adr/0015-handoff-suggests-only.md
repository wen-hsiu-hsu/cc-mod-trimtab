# Handoff only suggests, it never clears by itself

- Status: accepted
- Date: 2026-10-09

Upstream runs `/clear` automatically at 600k. That is not copied: it happens when nobody expects it, and at 600k the model's quality has long dropped. Instead two situations stop the prompt and let the user choose "hand off to a new session" or "keep working here", through one shared handoff flow:

- the context is over the threshold and the prompt is an unrelated new task (new-task gate);
- the cache has expired and the context is large: keep-warms ran out, or this is the first prompt after a long idle.

Decided after comparing Amp Handoff, Cline `new_task`, Anthropic's long-running harness and context engineering articles, Chroma's context rot, and papers on topic-shift detection:

- The handoff goes into the new session's input box as a draft, sent only after review (as Amp does).
- When judged a new task, the summary of the old work goes only to the progress file; the new session's draft holds only the new prompt.
- Start in suggest-only mode and record choices and ignores to measure the false-positive rate (judged new but stayed) before switching to blocking (`handoff_gate` in `/config`). When unsure, judge it related; after staying or ignoring, offer again only after another 50k of context.
- Writing the summary after the cache expired means the fork pays a full rewrite, so with a 1h TTL the last keep-warm writes the handoff summary instead.
- The threshold reuses `CLAUDE_CTX_GUARD_TOKENS` (default 150000), matching the status line.
- A fork writes the summary, not the main conversation (confirmed 2026-10-11 against mattpocock/skills' handoff skill): `$.model.fork` sends the exact prefix of the main conversation's last request, reads the same cache and costs the same as one main-conversation turn; the main conversation would need an extra tool call to write the file (another full cache read) and cannot cut in while answering.
- The summary has fixed sections plus a free-form "other": fixed sections make sure what a successor most often misses ("verified / not verified") is always there, and "none" tells an empty section from a forgotten one; "other" keeps the skill's free-form flexibility. Also taken from the skill: write only a path for what is already elsewhere, and never write secrets (the summary is saved as a file in the repo, outside secret-scrub's reach).
- Upstream: `handoff.ts`; `prompt.submit`, `classic.Stop` and `onIdle` in `register.ts`.
