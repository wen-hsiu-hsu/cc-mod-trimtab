# Roadmap

cc-mod-trimtab 的決定與理由、已知問題和之後的 mod 規劃。功能與用法見 [README](README.zh-TW.md)；這裡只留 README 沒寫的理由與還沒做的事。

## 決定

| 項目 | 決定 |
| --- | --- |
| 發佈 | 2026-10-11 發佈 v0.1.0，repo 是 public：`github.com/wen-hsiu-hsu/cc-mod-trimtab` |
| repo 結構 | 單一 repo、單一 marketplace，每個 mod 可單獨 `/plugin install <mod>@cc-mod-trimtab` |
| 名稱 | `cc-mod-trimtab`（repo 與 marketplace 同名）：`cc-mod-` 前綴讓人從名稱看出是 Claude Code mod。2026-10-11 由 `trimtab` 改名。`ballast` 已有同類 Claude Code plugin（`svy04/ballast`），不用 |
| mod 名稱 | 已公開，不再改名：改名會讓使用者的 `enabledPlugins` 與 `/config` 的值（綁在 `<mod>@cc-mod-trimtab`）失效。公開前已把 `shell-guard` 改成 `tool-guard`、`agent-watch` 改成 `agent-dispatch`、`nudges` 改成 `self-check` |
| 版本 | 各 mod 有自己的 `version`，整個 repo 另打 tag `vX.Y.Z`，CHANGELOG 列出每個 tag 包含的 mod 版本 |
| License | MIT。改寫自 ctx-handoff-mod 的檔案列在 `NOTICE` |
| 文件語言 | 中英雙語：英文 `README.md`、中文 `README.zh-TW.md`；ROADMAP 只有中文 |
| 介面語言 | 預設 `en`，可設 `zh-TW`（見「設計紀錄 › 介面語言」） |
| git 歷史 | 發佈前壓成一個初始 commit（舊歷史含個人 email 與假密鑰原文，本機留 `backup/pre-squash`） |
| 獨立性 | 每個 mod 不依賴其他 mod，也沒有中央 mod |
| 支援範圍 | Claude Code 2.1.296 以上（實測版本，mod API 仍是 early access）；CLI 與 desktop。雲端 session 不會加入 repo 宣告的 marketplace（需要 workspace trust，雲端不顯示 trust 對話框） |

## 發佈流程

1. 在 worktree 改，`claude plugin validate`、`claude plugin test`、`scripts/check-copies.sh` 都過才合併回 master（這個 clone 是使用者所有 session 直接載入的 mod）。
2. 改了哪個 mod 就調高它的 `version`：從 GitHub 安裝的使用者只有版本號變了才會更新，中間的 commit 拿不到。
3. CHANGELOG 加一段，打 tag `vX.Y.Z`，push 前先問使用者。CI（`.github/workflows/ci.yml`）在 master 與 PR 上跑 validate、test、`check-copies.sh`，裝 `@anthropic-ai/claude-code@2.1.296`。
4. 會改變預設值的改動，合併前先確認自己的 `pluginConfigs` 或 `~/.claude/cc-mod-trimtab.json` 已寫好要維持的值：這個 clone 是自己所有 session 直接載入的，合併後行為立刻改變。

CI 沒跑 `tsc`：型別檔只在 Claude Code 載入 mod 時產生，CI 拿不到；`secret-scrub/hooks/history.test.ts` 也已有 2 個型別錯誤。

## 已知問題

- 安裝時 CLI 提示「userConfig options not yet set」：沒設定的值用預設，不影響使用，README 沒寫。

## 待實測

1. 2.1.296 自己產生的型別檔與 2.1.288 版是否一致（見「查證結果」2；目前只拿得到 2.1.288 版）。

## 待辦

依實作順序。

- [ ] **1. `agent-dispatch`：加入用量帳本與分派提醒**。2026-10-09 決定。用量帳本與報表已做（0.2.0），分派提醒還沒做。
  - [x] 用量帳本：`agent.spawn` 記下每次派出的 description、agent 種類、指定與 `next(e)` 回傳的實際模型（被其他 mod 改過的也記得到）、fork、背景；`turn.step` 依 `agentId` 把每步 usage 加到主 session（依模型）或該次派出。session 層記 repo、開始時間、第一則 prompt 前 40 字。每個 session 一個 key，最多 500 筆派出，90 天沒寫入刪除。
  - [x] 報表：`/agent-dispatch stats [天數]` 開 pane（摘要卡、依 repo／session／模型／種類分組到每次派出、7／30／90 天），`--text` 與放不下時印文字版。
  - [x] 輸入框上方只在 agent 被中斷時顯示重派，執行中不再列出。
  - [ ] 分派提醒（只提醒，不擋也不改模型）：subagent 跑在 Opus 但 description 看不出理由、或同一個 session fork 次數偏多時跳 toast，並記進帳本。「看不出理由」的判斷與 fork 門檻實作時再定，先只記錄不提醒，看一段時間的誤判再開。
  - 每個功能各自的開關（帳本已有 `ledger`）。
  - 限制：hook 不能讀檔，無法回填安裝前的 transcript；雲端 session 不載入 mod，那部分不會記到。實作前確認 `turn.step` 是否涵蓋 fork 與背景 agent 的每一步。

## 費用回報

暫緩（見「暫緩」），設計先留著。

- 一次性觸發：toast 顯示 token 數與估算金額。
- 有模型參與的功能：輸入框上方常駐顯示各 mod 自己的累計（不跨 mod 加總），例如 `keep 3x 12.4k tok ~$0.04`。
- 只有拿得到 API 回傳 usage 的功能才顯示；拿不到就不顯示。
  - `$.model.fork`（保持快取、交接摘要）與 `$.model.complete`（Haiku 交接判斷、Sonnet 整理）都回傳 `usage`（四種 token 數；失敗時是失敗前已花掉的量），可顯示。
  - `$.model.classify` 只回傳標籤，沒有 usage；目前沒有 mod 用它。
- 金額依價格表估算並標明「依 API 價格估算」與價格日期；訂閱制實際不依 token 計費。價格表裡沒有的模型只顯示 token 數。
- 價格表在每個需要的 mod 各放一份，加進 `scripts/check-copies.sh`（比照 `scrub.ts`）。

## 設計紀錄

### 介面規範

顏色、版面、控制項、快捷鍵與用詞見 [DESIGN.md](DESIGN.md)（2026-10-12）。理由：

- **畫的程式在有畫面的 mod 各放一份 `hooks/ui.tsx`**：mod 不能跨資料夾 import；只有 toast 的 mod 用不到，不放。
- **`yellow` 只表示「要你處理」**：原本也用在切換鈕目前的值，和 band 的提問同色；目前的值改用 `bold`。
- **確認框用 `1`／`2`**：和 Claude Code 內建權限提示一致，其他地方用字母。

### 設定分層

用法見 README「設定」。理由：

- **repo 層由 mod 自己讀檔**：`pluginConfigs` 只從使用者或 managed 設定讀取，沒有專案層（見「查證結果」1）。讀設定的程式（`hooks/config.ts`）在每個 mod 各放一份，`check-copies.sh` 檢查相同。
- **commit 進 repo 的檔案只能讓保護更嚴、花費更省**（2026-10-11）：clone 來的 repo 不能關掉 `secret-scrub`、`tool-guard`，也不能替使用者開啟會花 token 的功能。每個 key 標明類別（保護、花費、一般）與 repo 規則；違反的值不採用，`/<mod> status` 列出原因。`never` 的 key 連和下層相同的值也拒絕，`set --repo` 才不會把它寫進 repo 檔。
- **`.local.json`**：fork 別人專案的 repo 用這個檔，不在對方 repo 多一個檔；第一次寫入時加進 `.git/info/exclude`。
- **清單放使用者層的檔案**：`/config` 只能存字串、數字、布林。
- **`secret-scrub` 的 `custom_rules` repo 不能設定**：JavaScript 的正規表示式沒有逾時，commit 進來的一條會無止盡回溯的規則會卡住每個 prompt。`allow` 要整段符合。
- **個人習慣預設關**：commit 標題格式檢查預設關（使用者自己在 `pluginConfigs` 打開）；移除 Claude 署名預設開。

### 指令

- 每個 mod 註冊 `/<mod>`，子指令統一：`status`、`set`、`unset`、`on`、`off`。一次性動作用具名子指令（`/session-keeper handoff`、`/session-keeper stats`、`/project-memory run`）。
- 舊指令改名時不留別名（留別名會再遇到撞名）：`/redispatch` → `/agent-dispatch redispatch`、`/guard-allow` → `/tool-guard allow`、`/scrub-history` → `/secret-scrub history`、`/project-memory` → `/project-memory run`。
- 不註冊 `/handoff` 這類通用名稱：使用者自己的指令或 skill 同名時，mod 的註冊會被拒絕（2026-10-11 實際遇到 mattpocock/skills 的 `/handoff`）。註冊失敗時跳 toast，不只寫 debug log。

### 用模型的功能

| 功能 | mod | 模型 |
| --- | --- | --- |
| 保持快取、快取過期提議交接 | session-keeper | 主對話模型（fork） |
| 判斷新任務 | session-keeper | Haiku |
| 自動整理記憶 | project-memory | Sonnet |

- **預設關**，第一次觸發時 toast 提醒一次。常開用 `/config` 或 `.local.json`；commit 進 repo 的檔案不能開。
- **臨時開啟**（2026-10-11）：存在 session 層並記到期時間，`/clear` 換了 session 也算結束；已經常開的功能 `on` 不改變，`off` 只關這個 session。開啟期間每個 mod 一行灰字（`session-keeper on · keep_warm 1h42m`），畫在自己那段的最上面，常開的不列。
- **費用說明**（2026-10-11）：每個功能一列的表（模型、何時呼叫、每次的量、送出的內容），表下說明估算方式、送去哪、訂閱制不依 token 計費、開啟方法；不放試算金額，免得價格變動要跟著改。

### 介面語言

2026-10-11 決定，發佈前完成：

- 預設 `en`。設定共用一個值，寫在設定檔的 `"*": { "language": … }`；同一層裡 mod 自己的區段優先。repo 檔案不能設定。使用者檔例外接受這個單一值（`/config` 存不了跨 mod 的值），所以 `plugin.json` 的 `userConfig` 不放。
- 畫面上看得到的文字依設定，包括 Stop hook 擋下與 tool-guard 拒絕的理由。給模型的指示一律英文；模型替使用者寫的內容（記憶、`progress.md`、交接摘要、升級成 CLAUDE.md 或 skill 的內容）依設定。解析使用者或 Claude 說的話時兩種語言都認。
- 快取列（`cache warm … left`、`hit`、`miss`）與臨時開啟的灰字保留英文，當成技術用語。
- `plugin.json` 與 marketplace 的說明只有英文（manifest 無法依語言切換），所以 `/config` 的標題是英文。
- 已知的小落差：切換語言後，指令選單的描述要到下個 session 才更新；用預設 `en` 整理時，既有的中文記憶檔會改寫成英文標籤（內容不變）。

## mod 規劃

提案依「實際發生過的問題 × 效益 ÷ 實作量」篩選。

### 出處

[cablate/ctx-handoff-mod](https://github.com/cablate/ctx-handoff-mod) v0.5.0（MIT，commit `3a06bc8`）。2026-10-09 決定不整個 fork：hooks 約 4,200 行、上游更新快，而且它的自動交接（600k 自動 `/clear`）與回覆語言提醒和這裡的規劃重疊。只拆保持快取、進度提醒、專案筆記、守門、防呆提醒五項，照 [README](README.zh-TW.md) 的共存規則與慣例重寫；它的面板直接取代 `AbovePrompt` 而沒有疊上 `next(e)` 的結果，`prompt.submit` 在 `next` 之前就改狀態，這兩點不照搬。沿用程式碼的 3 個檔案（`self-check/hooks/loops.ts`、`project-memory/hooks/distill.ts`、`promote.ts`）列在 `NOTICE`。

### 分組

2026-10-09 依「共用資料或同一個事件」分組：

| mod | 包含 | 理由 |
| --- | ---- | ---- |
| `self-check`（由 nudges 改名） | 重複失敗、說完成卻沒驗證 | 對象是 Claude 不是使用者、看的是執行後的結果與 `classic.Stop`，和守門共用不到程式；出錯時跳過即可；「說完成卻沒驗證」會顯示成 Stop hook error，獨立才能用 `/plugin` 單獨停用 |
| `session-keeper` | cache 狀態、保持快取、new-task-gate、交接、進度的讀取與帶入 | 共用用量、TTL 與閒置計時；保持快取的 fork 要讓快取到期時間跟著更新 |
| `project-memory` | 專案筆記、進度的產生 | 上游兩者在同一個請求產生；筆記的規則是守門的來源 |
| `tool-guard`（由 shell-guard 改名） | 固定規則（cmd-rewrite、學來的守門、bash-edit-snapshot 暫緩） | 都在工具執行前做事，共用指令解析、影響預覽與確認面板；學來的守門不只看 Bash，`shell-guard` 這個名字不準 |
| `agent-dispatch`（由 agent-watch 改名） | 背景 agent 監看與重派、用量帳本、分派提醒 | 都圍繞派 agent 這件事，共用 Agent 呼叫與 `agent.spawn` 的資料（種類、模型、description）。用量帳本要的 `turn.step` 雖然 session-keeper 也聽，但它拿不到 agent 種類 |
| 維持獨立 | secret-scrub、output-trimmer、open-items | secret-scrub 要排第一，併入的功能也會看到未遮蔽的原文；output-trimmer、open-items 和別人沒有共用的資料。open-items 載入後會自己把清單附給 Claude，交接與進度不用帶未完成項目 |

### 設計原則

- **交接只建議、不自動清空**：上游到 600k 自動 `/clear`，不照搬（會在沒預期的時候發生，而且 600k 時模型品質早就下滑）。兩種情況攔下 prompt，讓使用者選「交接並開新 session」或「仍在這裡做」，共用同一個交接流程：
  - context 超過門檻，且 prompt 是無關的新任務（new-task-gate）
  - 快取已過期且 context 很大：保持快取的次數用完、或閒置太久後回來的第一則
- **筆記寫進內建 memory**：每條一個檔案並更新 `MEMORY.md` 索引，只有一套記憶，Claude Code 自己載入，不用 mod 注入。出現次數存在 `project-memory` 的 `$.store`；規則寫進 CLAUDE.md 後刪掉對應的 memory 檔，避免重複。
- **進度與交接摘要是同一份檔案**：`project-memory` 整理筆記時更新進度，`session-keeper` 交接時用交接摘要覆蓋，只有 `session-keeper` 讀取並帶入新 session。這樣不用跨 mod 讀 `$.store`。這份檔案是暫時性的，不放在 `memory/` 資料夾。
- **守門與改寫規則放 repo 層設定**：核准的守門規則和 cmd-rewrite 規則照「設定分層」，進版控的放 `.claude/cc-mod-trimtab.json`，fork 別人專案的 repo 放 `.claude/cc-mod-trimtab.local.json`。
- **進版控的 cmd-rewrite 規則要先核准**：改寫指令不算「讓保護更嚴」，clone 來的 repo 可以在 `.claude/cc-mod-trimtab.json` 把 `npm test` 改寫成任意指令。所以進版控的改寫規則第一次生效前要使用者核准，記下規則內容的雜湊，內容變了重新核准；`.local.json` 的不用。
- 合併後每個功能要有自己的開關，一個功能出錯不能拖垮整個 mod。

### 已完成的設計紀錄

- **`self-check`（原 nudges）**（2026-10-09）：「說完成卻沒驗證」照上游，回覆要有「完成了」等說法才擋；子代理改的檔、只改文件都不算。上游只算 Edit／Write，漏掉 Bash 改檔（要等 bash-edit-snapshot 的寫檔偵測，見「暫緩」）。回覆語言提醒不移植。上游：`loops.ts`，`register.ts` 的 `classic.Stop` 和 `tool.call`。
- **`session-keeper` 保持快取**（2026-10-09）：context 少於 30k 不送、TTL 還沒判斷出來不送、5m TTL 不送（上游不偵測 TTL，要手動關）。計時由 `$.state` 的最後請求時間推算，熱重載後接得上；fork 後更新快取到期時間。上游：`register.ts` 的 `schedule`、`onIdle`、`resumeSchedule`。
- **`project-memory`**（2026-10-09）：依業界做法比對（Mem0、Letta sleep-time、Zep／Graphiti、Copilot Memory、Claude Code 官方 memory 文件）後決定：
  - 規則寫進 CLAUDE.md 前先問使用者（官方定位 CLAUDE.md 由人寫）；流程做成 skill 不用問。
  - 退出時 `session.end` 只有約 1.5 秒，來不及整理，不補。
  - 次數算「幾個不同 session 證實過」；過期用工作日（repo 有開 session 的日子）計算；刪除改成標記失效（`invalidated`、`superseded_by`），90 天後刪檔。
  - 記憶記下相關檔案路徑，檔案不見時標給模型判斷（Copilot 式出處驗證的簡化版）。
  - 交接前不整理：mod 之間不能互相呼叫，交接摘要由 `session-keeper` 讀 `$.session.messages()` 自己寫。
  - 上游：`distill.ts`、`notes.ts`、`promote.ts`、`transcript.ts`、`progress.ts`。
- **`session-keeper` 交接與 new-task-gate**（2026-10-09）：依業界做法比對（Amp Handoff、Cline `new_task`、Anthropic 的 long-running harness 與 context engineering 文章、Chroma context rot、主題轉換偵測的論文）後決定：
  - 交接內容放進新 session 的輸入框當草稿，審閱後才送出（Amp 的做法）。
  - 判為新任務時，舊工作的摘要只寫進進度檔，新 session 的草稿只有新 prompt。
  - 先用「只提議」模式，記錄選擇與忽略來算誤判率（判為新任務但留下的比例），之後才改成攔截（`/config` 的 `handoff_gate`）。不確定時判為相關；留下或忽略後，context 再多 50k 才會再提議。
  - 快取過期才產生摘要的話 fork 要付整份重寫，所以 1h TTL 時把保持快取的最後一次改成產生交接摘要。
  - 門檻沿用 `CLAUDE_CTX_GUARD_TOKENS`（預設 150000），和 status line 一致。
  - 摘要由 fork 寫、不讓主對話寫（2026-10-11 與 mattpocock/skills 的 handoff skill 比較後確認）：`$.model.fork` 送的是主對話上一次請求的原樣前綴，同樣讀快取，費用和主對話寫一輪相同；主對話寫還要多一次寫檔的工具呼叫（再讀一次整份快取），而且回答進行中時不能插隊。
  - 摘要固定段落，但加一段格式不拘的「其他」：固定段落保證「已驗證／未驗證」這類接手最容易漏的資訊一定出現，沒有的寫「無」好分辨是沒有還是漏寫；「其他」補上 skill 自由格式的彈性。也照 skill 加上「已寫在別處的只寫路徑」與「不寫密鑰」（摘要存成 repo 裡的檔案，secret-scrub 管不到）。
  - 上游：`handoff.ts`，`register.ts` 的 `prompt.submit`、`classic.Stop`、`onIdle`。

### 暫緩

| 提案 | 原因 | 重新評估的條件 |
| ---- | ---- | -------------- |
| bash-edit-snapshot（`tool-guard` 在 Bash 寫檔指令前用 `git stash create` 存快照，`/undo-bash [n]` 還原；`/rewind` 只追蹤 Edit／Write） | 2026-10-11 檢視約一個月的使用紀錄：Bash 寫檔（`sed -i`、`python3`、重導向、heredoc）很常見，但沒有一次造成損失，改錯的都在寫入前被檢查擋下或用 git 輕易救回；目標多是已 commit 的檔案，快照多保護的範圍很小 | Bash 寫檔讓未 commit 的內容遺失或要手動重建、且 `/rewind` 救不回；使用者因 Bash 改檔要求還原；或對未 commit 的檔案做大範圍取代出錯。做的時候寫檔偵測也複製到 `self-check` 的 `noteCall` |
| classifier-retry（auto mode 分類器沒給判定時重試） | 實際發生的次數少；不確定同一個工具呼叫裡能否再呼叫一次 `next` | 頻率上升，或確認 API 支援重試 |
| open-items 的 Haiku 抽取 | 每輪都要花 token；先觀察 track 工具與選項解析的漏抓率 | `/open-items stats` 的漏抓率明顯偏高（2026-10-07 開始記錄） |
| project-memory 只送相關的記憶給模型（Mem0 只送相似的前 10 筆） | 要 embedding 或相似度比對；記憶少時整份清單送得進去，`MEMORY.md` 也限 60 條 | 記憶（含失效前）超過約 150 條、或整理輸出常被截斷（debug log 的「丟棄 N 行」中出現 JSON 錯誤） |
| project-memory 的離線評估集（照 LongMemEval 分類標 30–50 段對話的預期整理結果，量抽取與更新的錯誤率） | 成本較高，要先累積一段時間的真實整理結果才有素材 | 用過一個月以上，或懷疑整理品質（記錯、漏記、重複）時 |
| 費用回報（見「費用回報」：每次呼叫的 toast、輸入框上方的各 mod 累計、依價格表估算金額） | 2026-10-11 查一個多月的 prompt 與 transcript：沒有一次問過 mod 呼叫模型花多少 token 或錢，也沒有因費用關功能；問過的是主對話的 context、訂閱額度與 cache 何時過期 | 開了 `keep_warm` 等背景呼叫後問「花了多少」、對用量表示意外，或 `/usage` 額度的消耗說不出來源。先做最窄的版本：`/<mod> status` 列累計 token 數，不估金額 |
| `tool-guard` 的 cmd-rewrite（Bash 執行前依 repo 設定的 `{ "match", "replace" }` 改寫指令，例如 `npx vitest run` 換成 `npm run test:brief --`；改寫時提示一次，進版控的規則第一次生效前要使用者核准） | 2026-10-11 查一個多月的 prompt 與 transcript：沒有一次因為 Claude 沒照 CLAUDE.md 的指令規則而糾正；唯一一條「該用 X 不要用 Y」的規則才加 5 天，之後還沒有 session 可看 | 有這類規則的 repo 累積 5 個以上 session 後，仍有 2 次以上被糾正或照舊跑錯的指令。先做最窄的版本：設定檔寫死的字面 match／replace |
| `tool-guard` 的學來的守門（`/tool-guard suggest` 把 memory 中出現 3 次以上的規則交給模型草擬工具呼叫前的比對式，核准才生效；上游 `guards.ts`） | 同一次查證：沒有同一種工具呼叫錯誤在不同 session 被糾正 3 次以上；反覆出現的糾正是寫作風格與流程，比對式擋不了；規則提升已由 `project-memory` 的「3 個 session 證實」處理 | 同一個工具呼叫錯誤在不同 session 被糾正 3 次以上，且寫得成字面比對式。先做使用者自己在設定檔寫 block／warn 比對式，不用模型草擬 |
| CI 跑 `tsc` | 型別檔只在 Claude Code 載入 mod 時產生，CI 拿不到 | Claude Code 提供產生型別檔的指令，或型別檔有公開的套件 |

### 不做

| 提案 | 原因 |
| ---- | ---- |
| session-learn（session 結束時用 Haiku 提出記憶修改建議） | 由 project-memory 處理 |
| next-step suggest（預填下一步指令） | 仍要多跑一輪，省不到 token；Claude Code 已有內建的 prompt 建議 |
| done-notifier（回合太久或等授權時通知） | Claude Code settings 的 `Notification` / `Stop` hook 加一行系統通知指令就能做到，不需要 mod |
| cloud-meter（用 `$.ui.status` 顯示 ctx、cache、額度，給沒有 status line 的雲端用） | 2026-10-06 實測：debug log 顯示有算出內容並呼叫 `$.ui.status`，但互動畫面上沒有出現；已移除 |
| open-items 每 N 輪重新注入清單（Cline Focus Chain） | 每輪都花 token；只在清單有變動時附差異就夠 |
| open-items 的依賴與「可做清單」（beads 的 `bd ready`） | 項目只是 80 字的短句，依賴關係太重 |
| open-items 同步到 GitHub issue 或 TODO 註解 | 會變成兩邊都要維護；需要時用「引用」交給模型開 issue |
| open-items 載入時自動驗證是否仍成立（openloops 的 shell 判斷式） | 項目是文字，沒有可自動檢查的條件；改用顯示年齡讓使用者判斷 |

## 查證結果

1. `userConfig` 不能依專案設定：`pluginConfigs` 只從使用者或 managed 設定讀取（[mods reference](https://code.claude.com/docs/en/plugins/mods/reference)）；2026-10-09 在 2.1.295 實測，repo 的 `.claude/settings.json`、`.claude/settings.local.json` 不會生效（用 `--plugin-dir` 加 `claude -p`，正式安裝的互動模式沒測）。→ repo 層由 mod 自己讀檔。
2. usage：`$.model.fork` 與 `$.model.complete` 都回傳 `{ isAnswered, text, usage }`，`usage` 有 input、output、cache read、cache write 四種 token 數，沒有金額；`classify` 只回傳標籤。依本機 2.1.288 產生的型別檔（2026-10-11 確認；GitHub 上的 `mods/types/claude-code.d.ts` 是 2.1.277 寫的，`complete` 還只回傳文字）。repo 的 `session-keeper`、`project-memory` 已在 2.1.296 上用 `isAnswered`／`text`。→ 見「費用回報」。
3. `cc-mod-trimtab` 重名：網路搜尋沒找到同名的 Claude Code、MCP 或 agent 專案；未做 GitHub 全站搜尋。
4. 2026-10-06 已在 CLI 實測 output-trimmer 的結果改寫、agent-dispatch（原 agent-watch）的中斷偵測、tool-guard（原 shell-guard）的攔截與放行、secret-scrub 的遮蔽、open-items 的自動延後與 compact 行為。
5. `$.store` 是 plugin 自己的一個 JSON 檔，放在使用者的 Claude Code 設定目錄，跨 session 與熱重載保留（2.1.296 型別檔）。所有 session 共用同一份，所以 session 層的值（`set --session`、`on`）以 sessionId 為 key 存，一週沒寫入的 session 在其他 session 寫入時清掉（0.1.1 起）。2026-10-11 實測：0.1.0 時 A 開 `keep_warm` 後 B `set`，A 的值被蓋回預設；0.1.1 後兩個 session 各自保留。
6. 從 GitHub 安裝的 plugin 會複製到 `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`，plugin 資料夾外的檔案不會複製（[plugins/loading](https://code.claude.com/docs/en/plugins/loading)）；第三方 marketplace 預設不自動更新。2026-10-11 在隔離的 `CLAUDE_CONFIG_DIR` 從 GitHub 安裝 8 個 mod，`enabledPlugins` 順序照安裝順序，快取副本的測試通過。
7. 2026-10-11 實測：`/reload-plugins` 後 `/<mod> status` 立刻讀到 `~/.claude/cc-mod-trimtab.json`（symlink 也讀得到）的 `"*".language`。
8. 2026-10-11 實測 `--resume`：sessionId 不變，`session.start` 重讀設定，臨時開啟的灰字提示列與值都接得上（open-items o3）。
