# 設定

[English](settings.md) | 繁體中文 · [回到 README](../README.zh-TW.md)

## 分層

每個 mod 的設定由高到低讀這幾層，取第一個有值的：

1. **session**：`/<mod> set <key> <value>`，只在這個 session 有效。
2. **local**：`.claude/cc-mod-trimtab.local.json`，不 commit（第一次寫入時加進 `.git/info/exclude`）。fork 別人專案的 repo 用這個檔。
3. **repo**：`.claude/cc-mod-trimtab.json`，commit 進專案、團隊共用，但只能讓保護更嚴、花費更省（見[repo 檔案能改什麼](#repo-檔案能改什麼)）。
4. **使用者**：單一值在 `/config`（存在 `~/.claude/settings.json` 的 `pluginConfigs`）；清單類（`custom_rules`、`allow`、`rm_skip_paths`）放在 `~/.claude/cc-mod-trimtab.json`，因為 `/config` 存不了清單。
5. **預設值**。

三個檔案的格式相同：`{ "<mod>": { "<key>": value } }`。

## 語言

mod 顯示的文字預設是英文（`en`），可以改成繁體中文（`zh-TW`）。在 `~/.claude/cc-mod-trimtab.json`（只對一個專案時用 `.claude/cc-mod-trimtab.local.json`）的 `"*"` 設定一次，所有 mod 都會套用：

```json
{ "*": { "language": "zh-TW" } }
```

- 同一個檔案裡，mod 自己的區段優先於 `"*"`；`/<mod> set language zh-TW` 只改一個 mod。commit 進 repo 的檔案不能設定 `language`。
- 模型替你寫的內容（`project-memory` 的記憶與 `.claude/progress.md`、`session-keeper` 的交接摘要）也照這個設定；送給模型的指示一律是英文。
- `/config` 看不到 `language`，`/config` 裡的標題也只有英文。

## 指令

每個 mod 都註冊 `/<mod>`，子指令相同：

```
/<mod> status                                  # 每個設定目前的值、來自哪一層、repo 能怎麼改，以及被忽略的值
/<mod> set <key> <value> [--session|--local|--repo]   # 預設 --session；清單寫 JSON 陣列，否則整段算一項
/<mod> unset <key> [--session|--local|--repo]
/<mod> on [功能] [時長]                         # 用模型的功能臨時開啟，預設 2h，最多 24h（2h、90m、1h30m）
/<mod> off [功能]                               # 在這個 session 關閉
```

## 用模型的功能

用模型的功能（`session-keeper` 的 `keep_warm`、`away_handoff`、`handoff_gate`，`project-memory` 的 `distill`）**預設關**，費用見 [session-keeper](mods/session-keeper.zh-TW.md#費用) 與 [project-memory](mods/project-memory.zh-TW.md#費用) 的「費用」：

- **臨時開啟**：`/<mod> on`，到期或 session 結束（含 `/clear`）自動關，不寫入檔案；開啟期間輸入框上方顯示一行灰字，例如 `session-keeper on · keep_warm 1h42m`。一個 mod 有不只一個這類功能時要指定功能（`/session-keeper on keep_warm 2h`）；已經用設定常開的不會改變。
- **常開**：`/config`、`.claude/cc-mod-trimtab.local.json` 或使用者層的檔案；commit 進 repo 的 `.claude/cc-mod-trimtab.json` 不能開啟。
- **關閉**：`/<mod> off` 只關這個 session，常開的設定下個 session 恢復。
- 每個功能在一個 session 裡第一次用到模型時，toast 提醒一次。

## repo 檔案能改什麼

repo 檔案能做什麼依設定的性質而定，違反的值不採用，`/<mod> status` 列出原因；`set --repo` 不會寫入會被忽略的值：

| 類別 | 設定 | repo 檔案 |
| --- | --- | --- |
| 保護 | `tool-guard` 的 `commit_format` | 只能開啟 |
| 保護 | `secret-scrub` 的 `allow`、`bypass_marker`；`tool-guard` 的 `rm_skip_paths` | 不能設定（會放寬保護） |
| 保護 | `secret-scrub` 的 `custom_rules` | 不能設定：JavaScript 的正規表示式沒有逾時，一條會無止盡回溯的規則會讓每個 prompt 卡住 |
| 花費 | `session-keeper` 的 `keep_warm`、`away_handoff`、`max_keeps`、`idle_minutes`、`handoff_gate`；`project-memory` 的 `distill`、`distill_every`、`min_context_k`、`idle_minutes` | 只能關閉或調省；`handoff_gate` 與 `project-memory` 的 `idle_minutes` 不能設定 |
| 一般 | 其他（例如 `output-trimmer` 的門檻、`tool-guard` 的 `commit_pattern`、`strip_attribution`） | 可自由設定；`language` 與 `subagent-dispatch` 的 `ledger` 除外，不能設定 |

改了檔案後，`/<mod> status` 會重新讀取；其他時候在 session 開始時讀一次。

各 mod 自己的設定、預設值與範圍列在各自的頁面：[secret-scrub](mods/secret-scrub.zh-TW.md#設定)、[tool-guard](mods/tool-guard.zh-TW.md#設定)、[output-trimmer](mods/output-trimmer.zh-TW.md#設定)、[subagent-dispatch](mods/subagent-dispatch.zh-TW.md#設定)、[session-keeper](mods/session-keeper.zh-TW.md#設定)、[self-check](mods/self-check.zh-TW.md#設定)、[project-memory](mods/project-memory.zh-TW.md#設定)。`open-items` 除了 `language` 沒有其他設定。
