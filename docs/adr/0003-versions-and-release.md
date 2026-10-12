# Each mod has its own version; the repo gets a tag

- Status: accepted
- Date: 2026-10-11

- Each mod has its own `version` in `plugin.json`. Users who installed from GitHub get an update only when the version changes, not with the commits in between, so every change to a mod raises its version.
- The repo is tagged `vX.Y.Z`, and the CHANGELOG lists the mod versions each tag ships.
- v0.1.0 was released on 2026-10-11 and the repo is public: `github.com/wen-hsiu-hsu/cc-mod-trimtab`. Before release the git history was squashed into one initial commit (the old history held a personal email address and the raw text of fake secrets).
- The license is MIT. Files adapted from ctx-handoff-mod are listed in `NOTICE` ([0013](0013-adapt-ctx-handoff-mod.md)).

The release steps are in the [development guide](../development.md#發佈).
