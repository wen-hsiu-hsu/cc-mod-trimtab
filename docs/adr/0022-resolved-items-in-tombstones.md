# open-items keeps a resolved item inside its tombstone for 7 days

- Status: accepted
- Date: 2026-10-13

The pane's resolved list shows what the repo resolved in the last 7 days, from any session, so a fresh session (after `/clear`) does not start with an empty list. The store kept only `{ uid, doneAt }` for a resolved item, so the tombstone now also carries the item itself (`item`), dropped once it is older than 7 days while the uid stays for the full 30. On load, these items come into the session's list as resolved, so reopening works as for one resolved in this session; one reopened since (a uid that extends the old one with `:r`) is left out.

Considered: listing only this session's resolved items (empty after every `/clear`); reading the resolution log (it keeps only decisions, drops and items with a note, not plain completions); a separate key for recent resolutions (a third structure to merge between concurrent sessions, where the tombstones are already merged).

Consequences: the stored value grows by the resolved items of the last 7 days; older readers ignore the extra field.
