# Interface language: English by default, Traditional Chinese available

- Status: accepted
- Date: 2026-10-11

- The default is `en`. One shared value, `"*": { "language": … }`, in the settings files; within one layer a mod's own section wins. Repo files cannot set it. The user file accepts this single value as an exception (`/config` cannot store a value shared by all mods), so it is not in `userConfig` in `plugin.json`.
- Text on screen follows the setting, including the reasons a Stop hook block or tool-guard denial gives. Instructions to the model are always English; content the model writes for the user (memories, `progress.md`, handoff summaries, text promoted to CLAUDE.md or a skill) follows the setting. Parsing what the user or Claude said accepts both languages.
- The cache line (`cache warm … left`, `hit`, `miss`) and the gray "temporarily on" line stay English, as technical terms.
- The `plugin.json` and marketplace descriptions are English only (a manifest cannot switch language), so `/config` titles are English.
- Known small gaps: after switching language, the command menu descriptions update in the next session; distilling with the default `en` rewrites existing Chinese memory files with English labels (the content is unchanged).
