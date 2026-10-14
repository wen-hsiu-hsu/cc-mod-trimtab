# The stats period is a window moved with h / l, and the list drops columns by priority

- Status: accepted
- Date: 2026-10-14

subagent-dispatch 0.5 showed a period that always ended today and chose a single day with `j` / `k` in place of it (ADR 0026), and drew each row of the overview as a card that took three lines. From 0.6.0 the period is a window of 1, 7, 30 or 90 days with its own last day: `p` changes the length and keeps the last day, `h` / `l` move the window by its own length, and `t` jumps to today alone. Choosing a day is a 1-day window, so there is one way to look back instead of two. The overview lists one row a line, with columns laid out by how much they matter: the name keeps at least 16 columns, the rest go in by priority (tokens, spawns, bar, share, sub share, the grouping's two own columns, the three kinds, cache read), and the first that does not fit stops the rest.

Considered:
- Keeping `j` / `k` beside a period that ends today: two ways of looking back, and `p` had to let the day go before it stepped the length.
- Fixed breakpoints (a column set per width band): simpler, but a width just under a breakpoint wasted columns, and every new column needed every band redone.
- Skipping a column that does not fit to place a narrower one after it: denser, but which columns show then jumps around as the pane is resized.

Consequences: a day 100 days back is `t` and then `h` 100 times, or 14 presses of `h` at 7 days. `j` and `k` are free again in the pane. A window wholly before the ledgers' 90 days shows its totals from the day rows, with no rows to list.
