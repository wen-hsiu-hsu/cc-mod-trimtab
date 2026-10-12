# open-items

[English](open-items.md) | 繁體中文 · [所有 mod](../../README.zh-TW.md#mods)

把待決定的問題、未解決的 bug 與延後的項目存在 context 之外，撐過 `/clear`、compact 與新 session。輸入框上方顯示數量，按一個鍵就把項目引用回給 Claude。

| 用模型 | CLI | Desktop | 雲端 |
| --- | --- | --- | --- |
| 否 | 是（手機只有狀態列） | 是 | 否 |

## 做什麼

- **Claude 登記項目**：用 `track` 工具（種類：決定、問題、延後、bug）。與未完成項目相同或互相包含的文字不重複新增。
- **沒選的選項自動延後**：你只選部分選項時（「A＋B，C 先寫成觀察項」），沒選的自動列為延後，toast 顯示延後了哪些。下一則 prompt 前可按 `[復原延後]`（`u`）或 `/open-items undo` 取消。只解析回答結尾、或後面接問句的選項清單。
- **輸入框上方顯示計數**：按 `[開啟]`（`o`）或 `/open-items` 開面板。
- **面板**：標成完成或不做、引用到輸入框、複製成 markdown（`c`）。列出建立時間與 branch，超過 7 天變淡；Esc 關閉。在面板關掉的項目會隨下一則 prompt 告知 Claude。
- **決策紀錄**：決策帶理由完成、或標為不做的項目另存到最近 300 筆的紀錄，`/open-items log [關鍵字]` 或 `track` 的 `history` 可查。
- **依 repo 跨 session 保存**：同 repo 的 worktree 共用。每次變動就合併寫入，並行的 session 不會互相覆寫。
- **載入時**：載入後的第一則 prompt 會把清單附給 Claude，toast 註明幾個在其他 branch、幾個超過 7 天。

## 指令

| 指令 | 做什麼 |
| --- | --- |
| `/open-items` | 開面板 |
| `/open-items undo` | 取消上一次的自動延後 |
| `/open-items copy` | 把清單複製成 markdown |
| `/open-items log [關鍵字]` | 查決策紀錄 |
| `/open-items stats` | 漏抓率：回答以問句結尾卻沒呼叫 `track` 的比例（逐筆記在 debug log） |

## 設定

除了 `language` 沒有其他設定（見[設定](../settings.zh-TW.md#語言)）。
