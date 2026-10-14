# Install and update

English | [繁體中文](install.zh-TW.md) · [Back to README](../README.md)

- **Requirements**: Claude Code 2.1.296 or later (the tested version). The mod API is still early access, so mods may need changes after a Claude Code update.
- **Where they run**: the CLI and desktop. Cloud sessions cannot load the mods (see [Cloud](#cloud-claudeaicode-cannot-load-for-now)).

## CLI and desktop

### Every mod at once

```bash
claude plugin install all --marketplace wen-hsiu-hsu/cc-mod-trimtab
```

This adds the marketplace and installs `all`, which has no hooks of its own: it lists every mod as a dependency, `secret-scrub` first, so they are all installed in the right order (see [Install order](#install-order)). Inside Claude Code, the same is `/plugin marketplace add wen-hsiu-hsu/cc-mod-trimtab` followed by `/plugin install all@cc-mod-trimtab`.

To drop a mod later, uninstall `all` first (`/plugin uninstall all@cc-mod-trimtab`; the mods it brought in stay installed), then uninstall that mod. Uninstalling a mod while `all` is still installed works, but `all` then shows as failed to load. To remove every mod, uninstall `all` and run `claude plugin prune`.

### Only some mods

```bash
claude plugin marketplace add wen-hsiu-hsu/cc-mod-trimtab
```

To pin a version, add a tag, for example `wen-hsiu-hsu/cc-mod-trimtab#v0.2.0`.

Then install the mods you want in Claude Code (user scope). Install `secret-scrub` first (see [Install order](#install-order)):

```
/plugin install secret-scrub@cc-mod-trimtab
/plugin install session-keeper@cc-mod-trimtab
/plugin install tool-guard@cc-mod-trimtab
/plugin install output-trimmer@cc-mod-trimtab
/plugin install subagent-dispatch@cc-mod-trimtab
/plugin install open-items@cc-mod-trimtab
/plugin install self-check@cc-mod-trimtab
/plugin install project-memory@cc-mod-trimtab
```

If the CLI says "userConfig options not yet set" during install, nothing is wrong: settings you have not set use their defaults.

You can also install from a shell with `claude plugin install <mod>@cc-mod-trimtab`. The current session loads the mod right after install. You do not need `/reload-plugins`.

## Install order

Hooks for the same event nest in the order of `enabledPlugins` in `~/.claude/settings.json`, not the install order; `/plugin install` adds a new plugin at the end. Every mod is written so that its features do not depend on that order, with one exception: a `prompt.submit` hook placed outside `secret-scrub` always sees the prompt before it is masked. So keep `secret-scrub` first in `enabledPlugins`, and check it after you add or reorder plugins. To see the actual order, run `claude -p "ok" --debug-file <file>` and look at the `$ built for …` line.

## Update

Each mod pins a `version` in `plugin.json`, so it updates only when the version number changes. Commits in between do not trigger an update. Third-party marketplaces do not update automatically by default. Pick one way to update:

- **Auto-update**: in the Marketplaces tab of `/plugin`, select `cc-mod-trimtab`, then select Enable auto-update.
- **Update one mod manually**: `claude plugin update <mod>@cc-mod-trimtab`.
- **Update everything manually**: in the Marketplaces tab, select Update marketplace.

After an update, running sessions need `/reload-plugins` to use the new version. New sessions load it directly. Breaking changes, such as a renamed mod, are marked in the [changelog](../CHANGELOG.md) with what to do.

## Cloud (claude.ai/code): cannot load for now

The official docs ([plugins/loading](https://code.claude.com/docs/en/plugins/loading#plugins-shared-through-a-repository)) state that cloud sessions do not add marketplaces that a repo lists in `extraKnownMarketplaces`, because that requires passing the workspace trust dialog, which cloud sessions do not show. A plugin placed in the project's `.claude/skills/` also needs to pass trust first. So declaring this marketplace in the project's `.claude/settings.json` has no effect. For now these mods work only in the CLI and desktop.

## Next

- [Settings](settings.md): change what a mod does, per session, per repo or for every repo.
- Each mod's page: [secret-scrub](mods/secret-scrub.md), [tool-guard](mods/tool-guard.md), [output-trimmer](mods/output-trimmer.md), [subagent-dispatch](mods/subagent-dispatch.md), [open-items](mods/open-items.md), [session-keeper](mods/session-keeper.md), [self-check](mods/self-check.md), [project-memory](mods/project-memory.md).
