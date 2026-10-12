# tool-guard

[English](tool-guard.md) | 繁體中文 · [所有 mod](../../README.zh-TW.md#mods)

攔下會丟失工作的指令，先量出確切會丟掉什麼，再讓你決定；不會造成損失的直接放行。另外可檢查 commit 標題格式，並移除 Claude 署名。

| 用模型 | CLI | Desktop | 雲端 |
| --- | --- | --- | --- |
| 否 | 是 | 是 | 否 |

## 攔下什麼

每條規則在詢問前先量出影響：

| 指令 | 量什麼 |
| --- | --- |
| `git reset --hard`、`checkout --`、`restore` | 會丟掉的未 commit 檔案 |
| `git clean -f` | 會刪的未追蹤檔案 |
| force push | 遠端會被蓋掉的 commit（依上次 fetch） |
| `git stash drop`／`clear` | 那些 stash 項目 |
| `--no-verify` | 被略過的 hook |
| `rm -r`／`rm -f` | 會刪的檔案數與大小，`$TMPDIR`、`/tmp`、`/var/folders` 與 `rm_skip_paths` 底下的不算 |
| 資料庫 migration | 待執行的項目 |

不會造成損失的直接執行、不詢問：工作區乾淨、force push 不丟 commit 且不是 main/master、rm 沒有符合的檔案、沒有待執行的 migration。

## 怎麼決定

- **確認面板**：列出影響，按 `1` 執行、`2` 取消。等待時 Claude 會停住；10 分鐘沒回應、或按 Esc 中斷回合，指令都不會執行。
- **終端機太窄**：放不下面板時改用內建的詢問對話框，同樣列出影響，選「執行」或「取消」，也可以打字回覆給 Claude。
- **非互動模式**（例如 `-p`）：無人可問，直接擋下並把影響寫進原因。輸入 `/tool-guard allow` 放行同類的下一個指令一次（10 分鐘內）。
- **出錯時不放行**：檢查本身出錯時，擋下含 `git`、`rm`、`migrate` 的指令（其他指令照常執行），`/tool-guard allow` 可放行一次。

## Commit

- `commit_format`（預設關）檢查 commit 標題格式；`commit_pattern` 自訂正規表示式。
- `strip_attribution`（預設開）從 commit 訊息移除 Claude 的 `Co-Authored-By` 署名。

## 指令

| 指令 | 做什麼 |
| --- | --- |
| `/tool-guard allow` | 放行同類被擋的下一個指令一次，10 分鐘內有效 |
| `/tool-guard status`、`set`、`unset` | 查看與修改設定（見[設定](../settings.zh-TW.md#指令)） |

## 設定

| key | 預設 | repo 檔案 | 意思 |
| --- | --- | --- | --- |
| `commit_format` | 關 | 只能開啟 | 檢查 commit 標題格式 |
| `commit_pattern` | 空 | 可設定 | 自訂標題格式（正規表示式）。空白時用內建格式 `<emoji> <type>(<scope>)!: <描述>`（Conventional Commits，emoji 與 scope 可省略）；無效的正規表示式會提示並改用內建格式 |
| `strip_attribution` | 開 | 可設定 | 移除 Claude 的 `Co-Authored-By` 署名 |
| `rm_skip_paths` | `[]` | 不能設定 | `rm` 不計算的路徑（清單，放在 `~/.claude/cc-mod-trimtab.json`） |

分層見[設定](../settings.zh-TW.md)。

## 已知限制

- 不是 sandbox。以正則與簡易斷詞解析指令，`eval`、`bash -c "…"`、`xargs rm`、`find -delete`、腳本檔內的呼叫偵測不到。
- force push 的清單依上次 fetch 的遠端狀態。
- Django 等 migration 的清單要執行專案自己的狀態指令（例如 `python3 manage.py showmigrations`），會在你按下執行前載入專案程式碼。
- 確認面板由 Claude 的工具呼叫開啟，算是「非使用者要求」的 pane，終端機要 144 欄以上（開過一次後 110 欄）才放得下，否則改用詢問對話框；沒放上的原因記在 debug log（`tool-guard: pane not placed`）。
