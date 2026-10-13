# The ledger is backfilled from transcripts at session start, behind a mark in the store

- Status: accepted
- Date: 2026-10-14

A new install of subagent-dispatch has an empty ledger, so the heatmap and stats start blank although the machine holds a month of transcripts. The hook API has no install or update event (2.1.288 types). So `session.start` checks the store for a `backfill` key: without one, it marks `running` and reads, in the background and without holding up the session, the transcripts of every session that has no ledger yet, then marks `done`. That covers a fresh install and an update from a version without the backfill alike. Another session that finds `running` less than 10 minutes old leaves it alone; `/subagent-dispatch backfill` runs it again whatever the mark says. A session that already has a ledger keeps it: the live record has what a transcript lacks (the model a spawn resolved to as Claude Code reported it), and the two must not be added together.

Considered:
- A command the user runs once: most would never learn of it, and the pane would look broken until they did.
- Reading the transcripts each time the pane opens: hundreds of files on every open, and the ledger's 90-day pruning would no longer hold.
- Backfilling in `-p` runs too: the process may end partway and leave a stale `running` mark, so only interactive sessions start it.

Consequences: only this machine's transcripts are read, and Claude Code deletes them after 30 days by default, so the backfill reaches about a month back. The projects folder is found from `CLAUDE_CONFIG_DIR` (or `~/.claude`), since `session.start` carries no transcript path. A ledger rebuilt this way carries `source: 'transcript'`.
