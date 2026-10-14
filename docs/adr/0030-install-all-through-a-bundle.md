# Every mod is installed at once through a bundle plugin with dependencies

- Status: accepted
- Date: 2026-10-15

`/plugin install` takes one plugin, so a new user who wanted every mod had to type eight commands. The marketplace now has `all`, a plugin with no hooks whose `plugin.json` lists every mod in `dependencies`, `secret-scrub` first. `claude plugin install all --marketplace wen-hsiu-hsu/cc-mod-trimtab` adds the marketplace and installs them all; tested in an empty config folder, `enabledPlugins` came out as `all`, then the mods in the listed order, so `secret-scrub` stays the outermost hook (ADR 0012).

Considered: a shell loop over `claude plugin install` in the README. It needs no new plugin, but the line is long, works only in a shell, and its list lives in prose that no check keeps in step with the mods.

Consequences:

- `all` lives in `bundles/all/`, not `mods/`, so the per-mod checks (docs pages, shared-code copies, tests) do not apply to it.
- Adding, renaming or removing a mod also changes `all`'s `dependencies` and bumps its `version`.
- Uninstalling a single mod while `all` is installed works, but `all` then fails to load; the install docs say to uninstall `all` first. Uninstalling `all` keeps the mods until `claude plugin prune`.
