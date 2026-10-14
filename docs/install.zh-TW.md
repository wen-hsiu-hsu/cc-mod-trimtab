# 安裝與更新

[English](install.md) | 繁體中文 · [回到 README](../README.zh-TW.md)

- **需求**：Claude Code 2.1.296 以上（實測版本）。mod API 仍是 early access，Claude Code 更新後可能需要跟著改。
- **在哪裡跑**：CLI 與 desktop。雲端 session 無法載入（見[雲端](#雲端claudeaicode目前無法載入)）。

## CLI 與 desktop

### 一次裝全部

```bash
claude plugin install all --marketplace wen-hsiu-hsu/cc-mod-trimtab
```

這行會加好 marketplace，再安裝 `all`。`all` 本身沒有 hook，只把每個 mod 列成依賴，`secret-scrub` 排第一，所以全部 mod 會照正確的順序裝好（見[安裝順序](#安裝順序)）。在 Claude Code 裡則是先 `/plugin marketplace add wen-hsiu-hsu/cc-mod-trimtab`，再 `/plugin install all@cc-mod-trimtab`。

之後想拿掉某個 mod，先移除 `all`（`/plugin uninstall all@cc-mod-trimtab`，它帶進來的 mod 會留著），再移除那個 mod。`all` 還在時直接移除 mod 也可以，但 `all` 會顯示載入失敗。要移除全部 mod，移除 `all` 後執行 `claude plugin prune`。

### 只裝部分

```bash
claude plugin marketplace add wen-hsiu-hsu/cc-mod-trimtab
```

要固定在某個版本時在後面加 tag，例如 `wen-hsiu-hsu/cc-mod-trimtab#v0.2.0`。

然後在 Claude Code 中安裝要用的 mod（user scope）。`secret-scrub` 要第一個安裝（見[安裝順序](#安裝順序)）：

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

安裝時 CLI 若提示「userConfig options not yet set」不用處理：沒設定的值用預設。

也可以在 shell 用 `claude plugin install <mod>@cc-mod-trimtab` 安裝。安裝後當下的 session 就會載入 mod，不需要 `/reload-plugins`。

## 安裝順序

同一事件的 hook 依 `~/.claude/settings.json` 的 `enabledPlugins` 順序一層包一層，跟安裝順序無關，`/plugin install` 會把新的 plugin 加在最後。每個 mod 的功能都不依賴這個順序，只有一個例外：排在 `secret-scrub` 外層的 `prompt.submit` hook 一定會先看到還沒遮蔽的 prompt。所以 `secret-scrub` 要固定排在 `enabledPlugins` 的第一個，新增或重排 plugin 後要檢查。實際順序用 `claude -p "ok" --debug-file <檔案>` 的 `$ built for …` 那行確認。

## 更新

每個 mod 在 `plugin.json` 固定了 `version`，所以只有版本號改變時才會更新，中間的 commit 不會。第三方 marketplace 預設不自動更新，可以選一種方式更新：

- **自動更新**：在 `/plugin` 的 Marketplaces 分頁選 `cc-mod-trimtab`，再選 Enable auto-update。
- **手動更新一個 mod**：`claude plugin update <mod>@cc-mod-trimtab`。
- **手動一次更新全部**：在 Marketplaces 分頁選 Update marketplace。

更新後，執行中的 session 要 `/reload-plugins` 才會用新版本；新開的 session 會直接載入。mod 改名這類破壞性變更會在[變更紀錄](../CHANGELOG.md)標明，並寫出要做什麼。

## 雲端（claude.ai/code）：目前無法載入

官方文件（[plugins/loading](https://code.claude.com/docs/en/plugins/loading#plugins-shared-through-a-repository)）寫明：雲端 session 不會加入 repo 在 `extraKnownMarketplaces` 列出的 marketplace，因為那需要通過 workspace trust 對話框，而雲端 session 不會顯示它。放在專案 `.claude/skills/` 的 plugin 也一樣要先通過 trust。所以在專案的 `.claude/settings.json` 宣告這個 marketplace 不會生效，這些 mod 目前只在 CLI 與 desktop 有用。

## 接下來

- [設定](settings.zh-TW.md)：依 session、依 repo 或對所有 repo 改變 mod 的行為。
- 各 mod 的頁面：[secret-scrub](mods/secret-scrub.zh-TW.md)、[tool-guard](mods/tool-guard.zh-TW.md)、[output-trimmer](mods/output-trimmer.zh-TW.md)、[subagent-dispatch](mods/subagent-dispatch.zh-TW.md)、[open-items](mods/open-items.zh-TW.md)、[session-keeper](mods/session-keeper.zh-TW.md)、[self-check](mods/self-check.zh-TW.md)、[project-memory](mods/project-memory.zh-TW.md)。
