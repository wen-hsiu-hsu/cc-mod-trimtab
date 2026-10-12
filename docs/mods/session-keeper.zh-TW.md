# session-keeper

[English](session-keeper.md) | 繁體中文 · [所有 mod](../../README.zh-TW.md#mods)

讓 prompt cache 不害你付兩次錢：在 desktop 顯示快取狀態，離開時讓 1h 快取保持溫熱，context 變貴時提議交接到新 session。

| 用模型 | CLI | Desktop | 雲端 |
| --- | --- | --- | --- |
| 保持快取與交接時 fork 主對話模型；判斷新任務時用 Haiku。預設關 | cache 狀態列以外都有（那行只在 desktop） | 是 | 否 |

## 指令

| 指令 | 做什麼 |
| --- | --- |
| `/session-keeper handoff [目標]` | 立刻交接到新 session |
| `/session-keeper stats [天數]` | 判為新任務卻沒交接的比例 |
| `/session-keeper on <功能> [時長]`、`off [功能]` | 臨時開啟用模型的功能，或在這個 session 關閉（見[設定](../settings.zh-TW.md#用模型的功能)） |
| `/session-keeper status`、`set`、`unset` | 查看與修改設定 |

## 費用

保持快取與交接預設關，cache 狀態、帶入進度不花 token。

| 功能 | 模型 | 何時呼叫 | 每次的量 | 送出的內容 |
| --- | --- | --- | --- | --- |
| `keep_warm` 保持快取 | 主對話模型（fork） | 1h 快取、context 超過 30k，閒置 `idle_minutes`（55）分鐘後；每段閒置最多 `max_keeps`（3）次 | 讀一次整段快取（≈ context 大小）＋約 1 個輸出 token | 主對話上一次請求的原樣前綴（整段對話） |
| `away_handoff` 快取過期提議交接 | 主對話模型（fork） | 1h 快取時保持快取的最後一次改寫交接摘要；你選交接時若沒有預先寫好的摘要再寫一次 | 讀一次整段快取＋摘要約 1–2k 輸出 token；快取已過期時是整段重寫 | 同上 |
| `handoff_gate` 新任務判斷 | Haiku | context 超過 `CLAUDE_CTX_GUARD_TOKENS`（150k）後的每則 prompt（留下後再多 50k 才再判斷） | 約 1–3k 輸入、最多 8 個輸出 token | 新 prompt、最近 5 則 prompt、進度檔的任務與最近碰過的檔案 |

`/session-keeper handoff` 是你自己下的指令，不受開關限制，費用和交接摘要相同。

- **怎麼估**：fork 的費用 ≈ context token 數 × 快取讀取價（輸入價的 0.1 倍）＋輸出；快取已過期時改成 × 快取寫入價（1h 是輸入價的 2 倍）。例如 150k context 保持一次 ≈ 15k 輸入 token 的價錢。Haiku 的判斷以 token 數算，金額很小。
- **送去哪**：都經由 Claude Code 的 `$.model` 送到主對話使用的同一個 API 供應商，不送到其他地方。
- **訂閱制**：Pro／Max 不依 token 計費，但會算進用量額度。上面的換算都是依 API 價格估算。
- **開啟**：`/session-keeper on <keep_warm|away_handoff|handoff_gate> [時長]`，或用 `/config` 常開（`handoff_gate` 選 `suggest` 或 `block`）。

## cache 狀態

不用 icon，各段以版面間距隔開（desktop 是比例字型，` · ` 會擠在一起）。status line 可以讀 Claude Code 算好的 `prompt_cache`，mod 拿不到，只能從每次請求的 usage 自己算。

| 欄位 | 計算方式 |
| ---- | -------- |
| `warm 1h [16:44] 23m left` | 最後一次回應的時間 + TTL。TTL 從 transcript 最近一筆 `ephemeral_5m/1h_input_tokens` 判斷，每 10 分鐘重讀一次；判斷出來之前只顯示 `warm` |
| `cold, next +184.3k` | 已過期；下一次要重寫的量 = 上一次請求的輸入 + 輸出 |
| `hit 91%` | 主對話所有請求的 cache 讀取量 ÷ 全部輸入（不含 subagent） |
| `miss 2 +150.2k (ttl? +1)` | 這次讀到的 cache 比上一次送出的少了 20% 以上（且超過 2048 token）就算一次失效；`/compact` 之後的重建不算 |

失效原因都是推測，所以帶 `?`：`model?`（model 換了）、`tools?`（工具清單變了，例如 MCP 連上或斷開）、`ttl?`（閒置超過 TTL），都不符合時顯示 `unknown`。改 CLAUDE.md 等 system prompt 造成的失效會落在 `unknown`。

顏色：warm 為灰色，剩不到 5 分鐘（5m TTL 為剩不到 1 分鐘）變黃，cold 為紅色，有失效時 `miss` 為黃色。

只在 `desktop` 畫，CLI 不顯示（終端機已有 status line），但 usage 仍會照常記錄。

## 保持快取

1h 快取在最後一次被讀寫後 1 小時過期，過期後下一則 prompt 要把整個 context 重寫一次（1h 快取的寫入價是輸入價的 2 倍）；讀一次快取只要 0.1 倍，並讓到期時間重新起算。所以閒置時用 `$.model.fork({ prompt: 'Reply with OK only' })` 對主對話送一個不帶工具的請求，讀一次快取。

- **何時送**：主對話最後一次請求（或上一次保持）之後經過 `idle_minutes`（預設 55）分鐘。每段閒置最多 `max_keeps`（預設 3）次，用完後照常過期；主對話有新的請求就重新計算。
- **不送的情況**：TTL 不是 1h（5m 快取在 55 分鐘時早已過期；TTL 還沒從 transcript 判斷出來也不送）、上一次請求的輸入少於 30k、已經過期、`/clear` 後換了對話。
- **結果**：成功後把快取到期時間改成送出的時間，desktop 的 cache 行顯示 `kept 1/3`；成功、失敗與不送的原因都只寫進 debug log（`keep warm …`），不打擾畫面。fork 的 usage 不計入 `hit`。
- **熱重載**：計時器會被清掉，`session.start` 依 `$.state` 裡的最後請求時間重新排程；已經過了預定時間但還沒過期的，立刻送。
- **設定**：`keep_warm` 開關、`idle_minutes`（5–59）、`max_keeps`（1–10）。最後一次保持在 context 超過交接門檻時改成產生交接摘要，見下方「交接」。

fork 是主對話最後一次請求加上一則訊息，所以 model、system prompt、工具都相同，讀的就是主對話的快取（型別檔：「the API serves that prefix from its cache」）；換了 model（`/model`）之後的 fork 會整段重寫。fork 讀快取是否也把 1h 的到期時間重新起算，型別檔沒有寫明，這裡依快取的一般行為（每次命中都重新計時）推定；debug log 的 `read` 量若在下一次保持時接近 0，代表沒有續上。

## 交接

context 大的時候，接無關的新任務、或快取過期後繼續，成本是開新 session 的數倍。交接只建議、不自動清空：在輸入框上方提議，由你選。

- **兩種提議**：門檻都是 `CLAUDE_CTX_GUARD_TOKENS`（預設 150000，和 status line 的 ctx 變黃相同），context 用主對話最後一次請求的輸入量。
  - **新任務**（`handoff_gate`）：Haiku 讀新 prompt、最近 5 則 prompt、進度檔的任務與最近碰過的檔案，判斷是不是無關的新任務，不確定時判為相關。`suggest`：prompt 照常送出，判斷在背景跑，判為新任務時才顯示提議；`block`：先不送出，等判斷（最多 8 秒），判為新任務時攔下讓你選；`off`：不判斷。按下「留在這裡」或不理它直接送下一則之後，context 再多 50k 才會再提議。
  - **快取過期**（`away_handoff`）：快取 TTL 已過、context 超過門檻時，攔下 prompt，提議交接或「仍在這裡做」（照原樣送出）；直接再打一則也算留下，兩則一起送出。附件帶不過去，有附件的 prompt 不攔。
- **交接做什麼**：fork 主對話寫交接摘要（目標、已驗證、未驗證、失敗過的做法、沒收尾的東西、決定與限制、相關檔案與確認指令、一個下一步、待回答的問題，以及不拘格式的「其他」；已在 spec、commit 等處的內容只寫路徑，不寫密鑰）→ 寫進 `.claude/progress.md`（加進 `.git/info/exclude`）→ `/clear` → 放進新 session 的輸入框當草稿，你看過、可修改後才送出。
  - 新任務：草稿只有那則新 prompt，舊工作的摘要只留在進度檔，之後回來接續用。`suggest` 模式下新 prompt 已經送出，按交接會先中斷它的回答，摘要也不寫它。
  - 快取過期、`/session-keeper handoff [目標]`：草稿是摘要加上你的 prompt。
  - 交接期間打的訊息先攔下（同樣內容只記一次），一起放進草稿。摘要沒產生（3 分鐘逾時或失敗）就留在原 session，被攔下的 prompt 放回輸入框。
- **預先產生摘要**：快取過期後才 fork，等於先付一次整份重寫。所以 1h TTL 時，保持快取的最後一次改成產生交接摘要（同樣讀熱快取，只多了輸出）；回來時快取已過期、主對話這段期間沒有新請求，就直接用它，不再 fork。
- **帶入進度**（`progress_resume`）：每個 session 的第一則 prompt 附上 `.claude/progress.md`（`project-memory` 的整理或交接寫的），條件是 24 小時內、不是這個 session 寫的、沒給過這個 session；附註寫明可能與這次無關。交接後的新 session 已經有草稿（或要做別的事），不再附。
- **記錄**：每次判斷與你的選擇（交接、留下、忽略）存在 `$.store`（最近 300 筆），`/session-keeper stats [天數]` 顯示判為新任務卻沒交接的比例，用來決定要不要改成 `block`。

## 設定

| key | 預設 | 範圍 | repo 檔案 | 意思 |
| --- | --- | --- | --- | --- |
| `keep_warm` | 關 | | 只能關閉 | 閒置時讓 1h 快取保持溫熱 |
| `idle_minutes` | 55 | 5–59 | 只能調高 | 閒置幾分鐘後送出保持快取 |
| `max_keeps` | 3 | 1–10 | 只能調低 | 同一段閒置最多保持幾次 |
| `handoff_gate` | `off` | `suggest`／`block`／`off` | 不能設定 | 判斷 prompt 是不是無關的新任務 |
| `away_handoff` | 關 | | 只能關閉 | 快取過期時提議交接 |
| `progress_resume` | 開 | | 可設定 | 新 session 的第一則 prompt 附上最近的進度 |

交接門檻由環境變數 `CLAUDE_CTX_GUARD_TOKENS`（預設 150000）設定。分層與 `/session-keeper on`／`off` 見[設定](../settings.zh-TW.md)。

## 已知限制

- 交接靠 `/clear` 後把草稿放進輸入框；放不進去（例如有對話框擋著）時 toast 提示，摘要仍在 `.claude/progress.md`。
- `suggest` 模式的提議出現時，新 prompt 已經付了一輪大 context 的錢。
