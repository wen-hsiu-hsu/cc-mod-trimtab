# Related files in project-memory carry an anchor string, checked by plain text search

- Status: accepted
- Date: 2026-10-12

A memory's related files used to be checked only for existence, so a renamed function or key left the memory looking valid. Each related file now carries an optional `anchor`, a string copied from that file which the memory relies on, and every distill checks with `$.fs` that the string is still in it. A missing string is flagged to the model the same way as a missing file. This is a simplified version of GitHub Copilot Memory's citation check, without a model call.

Considered:

- **Line numbers or a hash of a span**: break on any edit nearby, so nearly every memory would be flagged.
- **Asking the model to re-read the files**: costs a request per distill and reads whole files.
- **Rejecting a memory whose anchor is too short or a bare keyword**: loses the memory over its weakest part; only the anchor is dropped, the path is kept.

Consequences:

- Memory files write a related file as `` `path` → `anchor` ``; files without anchors keep the old form and are still read.
- An anchor must be 6 to 80 characters, not a bare language keyword, with no backtick.
