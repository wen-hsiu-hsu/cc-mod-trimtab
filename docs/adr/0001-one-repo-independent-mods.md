# One repo, one marketplace, mods that do not depend on each other

- Status: accepted
- Date: 2026-10-09

All mods live in one repo. The root `.claude-plugin/marketplace.json` turns it into one marketplace, `cc-mod-trimtab`, and each mod installs on its own with `/plugin install <mod>@cc-mod-trimtab`.

No mod depends on another, and there is no central mod, so users install only what they want. The cost is that shared code is copied into every mod ([0011](0011-shared-code-copied-per-mod.md)), and mods share data through files instead of reading each other's `$.store` (progress, [0016](0016-memory-in-built-in-memory.md)).
