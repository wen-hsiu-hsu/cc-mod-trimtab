# Shared code is copied into each mod and checked by a script

- Status: accepted
- Date: 2026-10-11

A mod cannot import files outside its own folder (symlinks do not work either), and an install from GitHub does not copy files outside the plugin folder. So shared code is copied into every mod; all copies change together, and `scripts/check-copies.sh` (also run by CI) checks they match. The list of copies is in the [development guide](../development.md#共用程式).

`config.ts` needs `$` to read and write files, and the validator lets `$` be passed only to functions declared at the top level of the same file, not across an import. So each register file has the same `configIO` block that wraps it as a `ConfigIO` and passes it in.
