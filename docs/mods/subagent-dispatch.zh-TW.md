# subagent-dispatch

[English](subagent-dispatch.md) | 繁體中文 · [所有 mod](../../README.zh-TW.md#mods)

被中斷的背景 agent 按一個鍵就重派，並列出 token 花在哪：主 session 與 subagent 的比例，依 repo、session、模型、agent 種類，一路到每一次派出。

| 用模型 | CLI | Desktop | 雲端 |
| --- | --- | --- | --- |
| 否 | 是（手機只有狀態列） | 是 | 否 |

## 重派

背景 agent 被中斷時在輸入框上方顯示：按 `[重派]`（`r`）或 `/subagent-dispatch redispatch` 把重派指示（各 agent 原本的 prompt、種類與模型）放進輸入框，或按 `[略過]`（`d`）。agent 執行中不顯示。

## 指令

| 指令 | 做什麼 |
| --- | --- |
| `/subagent-dispatch redispatch` | 把被中斷 agent 的重派指示放進輸入框 |
| `/subagent-dispatch stats [--text] [天數]` | 開用量 pane（見下方） |
| `/subagent-dispatch status`、`set`、`unset` | 查看與修改設定 |

## 用量帳本

每個 session 在 plugin 自己的 `$.store` 寫自己的帳本（每個 session 一個 key，跨 repo 共用），記下：

- session：所屬 repo（用主工作樹，同 repo 的 worktree 歸在一起）、開始時間與第一則非 `/` 指令 prompt 的前 40 字（兩者合起來當 session 名稱，例如 `10/12 02:11 檢查 diff…`），以及主 session 各模型的 token。`/clear` 後的新 session 有自己的開始時間與名稱；mod 讀不到 session 本身的標題。
- 每次派出（每個 session 保留最近 500 筆）：description、agent 種類、呼叫指定的模型（或預設）與實際的模型、是不是 fork、是不是背景、input／cache write／cache read／output token、步數與耗時。帳本沒看到派出的 agent（例如熱重載前派的）列為 `unknown`。

90 天沒有寫入的帳本在 session 開始時刪除。

`/subagent-dispatch stats [天數]`（1–90，預設 30，含今天）開 pane，涵蓋所有 session：

- 最上面一行是 `subagent-dispatch stats`，後面一條橫線填滿這一行。提示列在 dock 的 pane 置底，只列按鈕上沒畫出的鍵（`Tab`、`Enter`、`‹ 返回（b）`、`Esc`）。
- 兩張卡，內容寬 60 欄以上時並排，較窄時上下排。**總 token**（input + cache write + output）附一條分成主 session（紫）與 subagent（青）的長條，以及 subagent 佔比。**派出**依模型怎麼來分成三類，相加等於總數：指定模型（黃，含指定 Opus 的次數）、沿用預設（灰）、fork（綠，用主 session 的模型）。快取讀取（不計入）在卡片下方另列一短行。
- 依 repo（顯示資料夾名稱）、session、模型或 agent 種類分組（`分組`），每列有長條（desktop 用 Svg，終端機用有底色的格子）、token、佔比與派出次數。pane 內容寬 80 欄以上時一列一行，上方有一行欄名，期間與分組放在同一行標題列；較窄時長條換到第二行。清單的欄名（較窄時是分組切換鈕）上方有一條橫線、下方空一行；依 session 分組時名稱很長，列與列之間也空一行。
- `期間`、`分組`、`排序` 都在原地切換，下方內容不會位移：終端機是一個顯示 `‹ 值 ›` 的按鈕，按下換到下一個值、到尾端繞回（快捷鍵 `p`、`g`、`s`）；desktop 是一個值一顆的分段按鈕，同一個快捷鍵放在目前值的下一顆上。
- 按一列的名稱打開它：上方是這一列自己的兩張卡，下面用表格列出每次派出（圓點顏色表示模型怎麼來、description、長條、token、日期），預設 token 多的在前，`排序` 可改成時間新的在前或耗時長的在前。打開一個 session 時，Token 卡依主 session 用到的各模型拆開。先列 10 筆，按 `還有 N 筆`（`m`）再列 10 筆。按一筆派出會在原地展開它的種類、模型、執行（背景、步數、耗時）與 session，一次展開一筆。沒有派出的列（種類分組的「主 session」，或只有主 session 用過的模型）改列這些 token 來自哪些 session，多的在前，每列附長條。`‹ 返回`（`b`）回總覽。
- `期間` 有 7、30、90 天。

終端機較窄時 pane 會改放在輸入框上方。`/subagent-dispatch stats --text [天數]` 印出同樣內容的文字版；`-p` 執行或無處放 pane 時，`stats` 也改印文字版。

不含：各 mod 自己呼叫模型（`$.model.fork` / `$.model.complete`）的用量、雲端 session（不載入 mod）、安裝之前的紀錄。

## 設定

| key | 預設 | repo 檔案 | 意思 |
| --- | --- | --- | --- |
| `ledger` | 開 | 不能設定 | 記錄派出與 token 用量。關閉後不再記錄，`stats` 仍讀得到已有的紀錄 |

`/config` 看不到 `ledger`，用 `/subagent-dispatch set ledger false --local` 或寫在 `~/.claude/cc-mod-trimtab.json`。分層見[設定](../settings.zh-TW.md)。

## 已知限制

- 「背景」是 Claude Code 對每次派出回報的值。所有 Agent 呼叫都在背景執行的環境（Agent 工具立刻返回）裡，每次派出都會列為背景。
