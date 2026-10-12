# secret-scrub

[English](secret-scrub.md) | 繁體中文 · [所有 mod](../../README.zh-TW.md#mods)

送出 prompt 前遮蔽 token、API key 等密鑰，不進 transcript，也不進 prompt cache。

| 用模型 | CLI | Desktop | 雲端 |
| --- | --- | --- | --- |
| 否 | 是 | 是 | 否 |

## 做什麼

- **送出前遮蔽**：`token=`、`Bearer`、`sk-…`、`ghp_…`、JWT、私鑰、`*_TOKEN=` 等密鑰在 prompt 離開輸入框前就被取代。
- **略過**：prompt 含 `#noscrub`（`bypass_marker` 可改）時原樣送出。
- **自訂規則**：用 `custom_rules` 加規則、`allow` 加例外（例外要整段符合）。
- **歷史**：輸入框歷史（`history.jsonl`）也改寫成遮蔽後的內容，`/secret-scrub history` 清理所有 session 的舊紀錄。
- **出錯時不放行**：檢查本身出錯時不送出 prompt，把原文放回輸入框。確定沒有密鑰時加 `#noscrub`（或設定的 `bypass_marker`）再送。

`secret-scrub` 要固定排在 `enabledPlugins` 的第一個，其他 mod 才不會在遮蔽前看到 prompt（見[安裝順序](../install.zh-TW.md#安裝順序)）。保護範圍見 [SECURITY.md](../../SECURITY.md)。

## 指令

| 指令 | 做什麼 |
| --- | --- |
| `/secret-scrub history` | 清掉所有 session 舊的 `history.jsonl` 紀錄裡的密鑰 |
| `/secret-scrub status`、`set`、`unset` | 查看與修改設定（見[設定](../settings.zh-TW.md#指令)） |

## 設定

| key | 預設 | repo 檔案 | 意思 |
| --- | --- | --- | --- |
| `custom_rules` | `[]` | 不能設定 | 額外要遮蔽的規則（清單，放在 `~/.claude/cc-mod-trimtab.json`） |
| `allow` | `[]` | 不能設定 | 永遠不遮蔽的文字（清單） |
| `bypass_marker` | `#noscrub` | 不能設定 | prompt 含它時原樣送出 |

repo 檔案都不能設定：`allow` 與 `bypass_marker` 會放寬保護；`custom_rules` 一條會無止盡回溯的規則會讓每個 prompt 卡住（JavaScript 的正規表示式沒有逾時）。分層見[設定](../settings.zh-TW.md)。

## 已知限制

- 在遮蔽後約 3 秒與 session 結束時改寫 `history.jsonl` 中本 session 的紀錄（含 `paste-cache`），只有 CLI 會寫這個檔；改寫前 CLI 已載入記憶體的上方向鍵歷史可能仍是原文。檔案超過 4 MiB 時無法讀取，會提示失敗。
- 只看得到 prompt。Claude 讀的檔案、工具輸出、排在它前面的 mod 送出的內容都不會遮蔽。
