# The heatmap's cells are text, and a day is chosen with j / k only

- Status: superseded by 0027 (choosing a day with j / k); the cells stay text
- Date: 2026-10-14

subagent-dispatch 0.5.0 drew each cell of the stats heatmap as a `plain` Button, so a click chose that day. At 53 weeks that is 371 buttons, laid out again on every redraw: a resize settled in about 40–66 ms even after the store read was cached, and Tab had to step through every cell before it reached the period and the rows. Each row of the heatmap is now one `Text` with a colored glyph a day, and `j` / `k` (beside the period) are the only way to choose a day.

Considered:
- Keeping the buttons: a click is the quickest way to a day far back, but the cost lands on every redraw, and the Tab order stays broken.
- A single `Client` region taking pointer events over the grid: clicks without the buttons, but a second way of drawing the heatmap for one gesture.

Consequences: a resize settles in about 27–44 ms. A day 100 days back takes 100 presses of `j`. Nested `Text` keys do not reach the drawn tree, so tests find a cell by its row and week.
