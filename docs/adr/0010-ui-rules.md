# UI rules live in DESIGN.md, and each mod with a screen has its own copy of the drawing code

- Status: accepted
- Date: 2026-10-12

Colors, layout, controls, hotkeys and wording are in [DESIGN.md](../../DESIGN.md); change the rules there first, then the code. Reasons:

- **Each mod with a screen has its own `hooks/ui.tsx`**: mods cannot import across folders; mods that show only toasts do not need it.
- **`yellow` means only "needs you"**: it was also used for a switch's current value, the same color as a question in the band; the current value is `bold` now.
- **The confirm panel uses `1` / `2`**: the same as Claude Code's own permission prompt; letters everywhere else.
