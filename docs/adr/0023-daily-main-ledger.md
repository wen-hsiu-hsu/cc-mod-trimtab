# The usage ledger keeps the main session's tokens per local day

- Status: accepted
- Date: 2026-10-13

subagent-dispatch's ledger kept the main session's tokens as one total per model, so a session counted whole in any period it was written in, and a short period or a calendar view could not be drawn. The ledger now keeps them as local day → model → tally. A day is fine enough for the periods (1, 7, 30, 90 calendar days) and for a later calendar heatmap, and keeps a session's ledger to one entry per model per day.

Considered:
- Per hour: finer than any view needs, and up to 24 times the entries in a long session's key.
- Following the account's own 5-hour and 7-day windows: `$.session.usage()` gives only the current window's percentage, which covers the whole account and is weighted, so it does not add up with local tokens.

Consequences: ledgers written before 0.4.0 have no days; their main session tokens count on the day of their last write. Spawns still count on the day of their last step.
