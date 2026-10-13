# Day rows are computed whole from the ledgers and written once

- Status: accepted
- Date: 2026-10-14

subagent-dispatch's stats heatmap reaches back up to 53 weeks, but ledgers are deleted 90 days after their last write. Each session start now writes a row per settled day (the day before yesterday or earlier) under `day:YYYY-MM-DD`, kept 366 days: the main session's and the spawns' tokens by model and the spawn counts. A row is always computed whole from every ledger that day and written once, never added to. Several sessions share the store, and a read–add–write from two of them at once would lose one's addition; two sessions that compute the same row from the same ledgers write the same value, so whichever lands last does no harm. Yesterday is left out because a session may still be writing to it.

Considered:
- Adding each step to its day's row as it is recorded: concurrent sessions overwrite each other's additions, and `$.store` has no transaction.
- Keeping the ledgers for a year instead: every session's spawns and prompts for a year, about four times the store for what the heatmap needs as one number a day.

Consequences: a backfill that adds sessions to days already summed rewrites the rows of those days the ledgers still hold whole, the one case a row changes. A spawn that keeps running across two midnights counts on both of its last days once the ledgers are gone. The heatmap and a chosen day read the ledgers for the last 89 days and the rows before, one day short of the retention because a ledger last written on the 90th day back is pruned partway through it.
