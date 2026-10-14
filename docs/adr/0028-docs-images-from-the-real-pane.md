# The mod docs show the real pane, captured as SVG

- Status: accepted
- Date: 2026-10-14

The mod docs had no pictures. `scripts/capture-pane.py` opens the pane in a real `claude --plugin-dir` session inside a pty, reads every cell's character and color with the pyte terminal emulator, and writes the pane's box as an SVG under `docs/images/<mod>/`, which the English and Chinese pages share. The session runs in an empty, onboarded config dir that is not logged in, with the mod's store filled by `scripts/pane-shots/<mod>.py`: made-up data dated from the day it runs, never the user's own store or transcripts. Each mod lists one or two representative shots and the keys that reach them.

Considered:
- Screenshots of the design canvas: a `.dc.html` page only draws inside the canvas (it needs the canvas's `support.js`), so it cannot be rendered offline, and the finalized pages drift from the code (the 0.6.0 page still dimmed cells outside the period after the code stopped).
- Rendering the test harness's element tree: deterministic, but the tree has no layout; drawing it would mean writing a second layout engine that could disagree with the terminal.
- PNG screenshots of a real terminal: need a GUI terminal and a fixed font, and are larger and blurry when scaled; SVG stays text and diffs show what moved.

Consequences: regenerating needs `claude` and Python with pyte. The images carry the capture day's dates and clock, so a rerun always changes them; they are rerun only when a release changes the screen. The SVG uses the viewer's monospace font, so box drawing and block characters can look slightly different from the user's terminal. Only the dark theme is captured.
