# project-memory

[English](project-memory.md) | 繁體中文 · [所有 mod](../../README.zh-TW.md#mods)

在背景把對話整理進 Claude Code 內建的 memory 與進度檔，下個 session 一開始就知道這個 session 學到什麼。被多個 session 證實的規則先問你再寫進 CLAUDE.md，流程做成專案 skill。

| 用模型 | CLI | Desktop | 雲端 |
| --- | --- | --- | --- |
| 整理時用 Sonnet（effort low）。自動整理預設關 | 是 | 是 | 否 |

## 指令

| 指令 | 做什麼 |
| --- | --- |
| `/project-memory run` | 立即整理並顯示狀態 |
| `/project-memory on [時長]`、`off` | 臨時開啟自動整理，或在這個 session 關閉 |
| `/project-memory status`、`set`、`unset` | 查看狀態與修改設定 |

## 費用

自動整理預設關；`/project-memory run` 是你自己下的指令，不受開關限制。

| 功能 | 模型 | 何時呼叫 | 每次的量 | 送出的內容 |
| --- | --- | --- | --- | --- |
| `distill` 自動整理 | Sonnet（effort low） | 每 `distill_every`（30）則且 context 至少 `min_context_k`（30）k、閒置 `idle_minutes`（10）分鐘、`/clear` 時（各有門檻，見下方「整理」）；`MEMORY.md` 超過上限時多一次合併請求 | 輸入 ≈ 上次整理後新增的對話（工具輸入截到 300 字、結果截到 500 字）＋現有記憶清單，通常數千到數萬 token；輸出最多 4000 token | 遮蔽過金鑰的新增對話、現有記憶、進度檔 |

- **怎麼估**：輸入 token × Sonnet 輸入價＋輸出 token × 輸出價。這不是 fork，不讀主對話的快取。
- **送去哪**：經由 Claude Code 的 `$.model` 送到主對話使用的同一個 API 供應商。
- **訂閱制**：不依 token 計費，但算進用量額度；上面的換算是依 API 價格估算。
- **開啟**：`/project-memory on [時長]`，或用 `/config` 常開 `distill`。

## 整理

- **何時**：三種時機，都在背景跑。
  - 主對話回答完、距離上次整理有 `distill_every`（預設 30）則使用者訊息、且 context 至少 `min_context_k`（預設 30）k。
  - 最後一次回答後閒置 `idle_minutes`（預設 10）分鐘，且有 5 則以上新訊息（不看 context 大小）；設成 0 時閒置不整理。
  - `/clear` 時有 5 則以上新訊息：先在 `session.end` 抓下對話，換到新 session 後再整理。直接退出（`/exit`、ctrl+c）時 hook 只有約 1.5 秒，來不及整理。
  - `/project-memory run` 立即整理並顯示狀態，`/project-memory status` 看狀態與設定。自動整理失敗後隔 5 則再試。
- **送什麼**：上次整理到的那則使用者訊息之後的對話（找不到時送整段，但不准增加出現次數），工具輸入截到 300 字、結果截到 500 字，再用 `secret-scrub` 的規則遮蔽；模型輸出的動作裡有像金鑰的值整行丟掉。user、feedback 類記憶要附使用者原話，比對不到就丟掉。
- **寫到哪**：記憶資料夾優先用 context 載入 `MEMORY.md` 的位置，找不到時用 `~/.claude/projects/<repo 根目錄編碼>/memory/`（worktree 共用主工作樹的）。每條記憶與規則一個 `pm-<類型>-<標題中的英數字>-<雜湊>.md`，frontmatter 有 `name`、`description`、`type`，內文是做法、理由、相關檔案與最近 3 筆根據；主 session 改過這些檔案，下次整理以檔案內容為準，認不得的段落原樣保留。整理期間檔案被改過時這次不寫，下次重新整理同一段。
- **你會看到**：有變動時 toast，變動清單附在下一則 prompt。`MEMORY.md` 只改連到 `pm-` 檔的行。
- **相關檔案**：記憶講的是特定檔案時，記下 repo 裡的相對路徑（最多 3 個）。每次整理檢查檔案還在不在，不在的在清單上標給模型：只是改名就改路徑，講的事不成立了就標記失效，看不出來就不動。
- **失效**：模型刪除記憶或規則時不刪檔，而是在 frontmatter 加 `invalidated`（日期）與 `superseded_by`（取代它的那條），從 `MEMORY.md` 與之後的整理中拿掉；90 天後才刪檔。流程只存在 `$.store`，刪除就是刪除。
- **過期**：project、reference 類超過 30 個工作日（這個 repo 有開 session 的日子，記在 `$.store`）沒被證實，從 `MEMORY.md` 拿掉、檔案保留，再被證實就放回。停工一段時間回來不會一次全部過期。
- **上限**：`MEMORY.md` 只自動載入前 200 行，和主 session 自己的記憶共用，所以 `pm-` 的行最多 60 條。整理後超過時，再送一次只能合併與標記失效的請求；仍超過（或請求失敗）就只列最近被證實的 60 條，其餘檔案保留。
- **進度**：有實際進展才更新 `.claude/progress.md`（加進 `.git/info/exclude`），整份取代；`session-keeper` 交接時會用交接摘要覆蓋它，並由它帶入新 session（見「session-keeper」的「交接」）。

## 寫進 repo

規則與流程被 3 個不同 session 證實、還沒放進 repo 的，每個 session 的第一則 prompt 附上交代（一次最多 3 條，同一條最多 2 次、間隔 6 小時）。同一個 session 再證實只加根據、不加次數。

- **規則**：CLAUDE.md 由使用者決定，Claude 不直接改，而是在回覆最後列出要加的文字和位置，問你要不要加；同意後才寫入，再呼叫 `mark_in_project` 回報位置，規則的 memory 檔隨之刪掉、只在 `$.store` 留紀錄。不同意時標記「不放」，規則照舊留在 memory。
- **流程**：直接做成 `.claude/skills/<名稱>/SKILL.md`（新檔案，你看 diff 決定留不留），回報後不再交代。

都不 commit。

## 設定

| key | 預設 | 範圍 | repo 檔案 | 意思 |
| --- | --- | --- | --- | --- |
| `distill` | 關 | | 只能關閉 | 自動整理。關閉時閒置與 `/clear` 也不整理；臨時開啟用 `/project-memory on` |
| `distill_every` | 30 | 5–200 | 只能調高 | 距上次整理的使用者訊息達到這個數量時整理 |
| `min_context_k` | 30 | 0–1000 | 只能調高 | context 少於幾 k 不做「每幾則」的整理（只影響這一種） |
| `idle_minutes` | 10 | 0–120 | 不能設定 | 閒置幾分鐘後整理；0 表示閒置不整理 |
| `promote` | 開 | | 可設定 | 交代把證實過的規則與流程寫進 repo |

`/config` 的值存在使用者層級 `~/.claude/settings.json` 的 `pluginConfigs`，所有 repo 共用；2026-10-09 在 2.1.295 實測，repo 的 `.claude/settings.json`、`.claude/settings.local.json` 裡的 `pluginConfigs` 不會生效，所以依 repo 調整要用[設定](../settings.zh-TW.md)的 repo 或 local 檔案。

## 已知限制

- `project-memory` 刪檔用 `rm`（`$.fs` 沒有刪除），只支援 macOS／Linux。記憶資料夾的預設路徑依 Claude Code 的命名推算，設定了其他位置（例如 `autoMemoryDirectory`）且 context 沒載入 `MEMORY.md` 時會寫錯地方。整理只看主對話，subagent 的內容不算。
