# Support only Claude Code 2.1.296 or later, in the CLI and desktop

- Status: accepted
- Date: 2026-10-11

2.1.296 is the tested version. The mod API is still early access, so older versions are not claimed, and CI installs exactly this version. Cloud sessions are not supported: they do not add a marketplace a repo declares, because that needs workspace trust and the cloud shows no trust dialog ([plugins/loading](https://code.claude.com/docs/en/plugins/loading#plugins-shared-through-a-repository)).
