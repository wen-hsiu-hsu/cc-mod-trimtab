# The open-items pane acts on the focused row; only the row's id is a button

- Status: accepted
- Date: 2026-10-13

Three plain buttons on every row (done, won't do, quote) made each item take two lines and a dozen buttons outweigh the items. The pane now draws one line per item and a single row of actions under the list, acting on the row the focus ring last landed on (read from `ui.focus`). Only the id is a button, so Tab and ↑↓ step through the rows; the focused row wraps its own text to `bodyColumns` so each line can carry the kind's side line.

Considered:

- Making the whole line one button: a Button cannot hold a `Box`, so the focused row's wrapped lines could not line up under the text column, and a cut-off start was drawn twice. Rejected by the user after the prototype.
- Moving the focus to the next row with `$.ui.focus` after closing one: in the prototype the ring landed on the action just pressed, or skipped a row. Closed rows stay in place instead (struck through), so the focus never has to move.
- ←→ to switch lists: the pane does not trap them; they switch to another session. `v` switches instead.

Consequences: an action does nothing until a row has been focused. Reopening an item gives it a new uid, since the resolved one's tombstone stays in the store and in other sessions.
