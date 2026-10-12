# When a check itself fails, the guards block and self-check skips

- Status: accepted
- Date: 2026-10-12 (recorded; the behaviour shipped in v0.1.0)

The mods do not all react the same way when their own check throws:

- `secret-scrub` fails closed: the prompt is not sent and the original text goes back into the input box. `#noscrub` (or `bypass_marker`) sends it anyway.
- `tool-guard` fails closed only for the commands it guards: commands containing `git`, `rm` or `migrate` are blocked, other commands run. `/tool-guard allow` allows one.
- `self-check` fails open: it skips and does not affect tool calls or stops.

Why it was decided this way was not written down at the time and cannot be traced in the repo or in earlier sessions. Revisit this record, and write the reason down, before changing any of the three, or before adding a mod that also needs to choose.
