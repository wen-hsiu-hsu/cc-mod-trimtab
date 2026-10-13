# 跨 session 保存「待辦／待決定」的工具比較（對照 open-items）

- 查證日期：2026-10-12（所有 URL 皆於當日存取）
- 來源規則：只用官方文件、專案自己的 GitHub README／issue／原始碼、作者網站。查不到一手來源的標「未查證」。第三方部落格只當線索，不當依據。
- 使用紀錄的範圍：open-items 開始被使用的 2026-10-06 到 2026-10-12（約 6 天）。樣本小，證據強度會註明。
- 版本註記：Claude Code 的 Tasks 工具、Codex 的 `update_plan` 近期有改預設，見各節。

## 1. 摘要

- **open-items 的定位在這批工具裡很少見**：它只管「待決定的問題、未解決的 bug、延後項目」，項目是約 50 字的短句，由 Claude 用一個 `track` 工具登記。beads、Taskmaster、shrimp 管的是「工作拆解與依賴」，是另一個問題。最接近的是 Claude Code 內建的 Tasks／TodoWrite，但它管「這一輪要做的步驟」，不管「還沒決定的事」。
- **別人的主要抱怨都是「太重」，不是「功能不夠」**。Taskmaster 預設載入 36 個 MCP 工具、約 21,000 token（https://raw.githubusercontent.com/eyaltoledano/claude-task-master/main/README.md），issue #1280「MCP Context Bloat」提議做精簡版。beads 有 issue「Shrink 10k+ context window used by beads」（#295）和「Beads feels painful to use」（#2938，抱怨安裝、升級、`bd doctor --fix` 弄壞資料）。open-items 只有一個工具、每個 session 附一段規則，沒有這類問題。
- **「Agent 登記後會漂移」是共通風險**：beads #486 回報 Claude 在 context 重置後忘了用 beads、改回內建 TodoWrite；維護者的解法是 SessionStart 與 PreCompact hook 重新注入 `bd prime`（https://github.com/steveyegge/beads/issues/486）。open-items 的規則放在 system prompt 的 session 區段、compact 時另附清單，結構上已是同一種解法。
- **重新浮現的時機有三種做法**：每 N 則訊息提醒（Cline Focus Chain，預設 6 則）、session 開始與 compact 時注入（beads）、只在清單有變動時附差異（open-items）。後者最省，ROADMAP 已選定，這次的使用紀錄沒有反證。
- **你的使用紀錄顯示項目壽命很短**：cc-mod-trimtab 的 45 筆決策紀錄中，決策類登記到完成平均約 17 分鐘（中位數 7 分鐘）、問題類約 24 分鐘（中位數 15 分鐘）、延後類平均約 3.7 小時（中位數 31 分鐘）、最長 16 小時；目前未完成的最舊項目 5 天。所以「過期處理」「依賴」「排序」目前都沒有需求證據。
- **`/open-items stats` 的漏抓率（50%、70%）被高估**：抽查 2026-10-06 之後 29 次「以問句結尾又沒呼叫 track」的回答，下一則使用者訊息有 14 次是 14 字內的短答（ok、好、commit），6 次是系統或跨 session 訊息，2 次沒有下一則；只有約 7 次是實質回答，且其中沒有一次在後續被追問「剛剛那個問題呢」。這份證據支持維持「不做 Haiku 抽取」，並建議先修指標。
- **B 圈（第 4 節，深入 taskwarrior、dstask、adr-tools／MADR）的重點**：兩個待辦工具的使用者抱怨都指向同一件事：**預設過濾（context）一旦有些指令不認，或把項目藏起來卻沒提示，就會誤導使用者**（taskwarrior #2917、#3730；dstask #87、#132）；dstask 的解法是每次列出時印「N critical task(s) outside this context!」，open-items 的載入 toast 已是同一種設計。taskwarrior 自己把「年齡」權重設得最低（2.0，一年才拿滿；`next` 標籤 15.0、due 12.0），支持 open-items 只淡化、不排序。
- **C 圈（第 5 節）的重點**：Masicampo & Baumeister (2011) 的摘要說，卸下未完成目標負擔的是「具體計畫」而不是「記下來」；ADR 原作者 Nygard 與 Zimmermann 要求決策記錄理由與回頭檢視的時機。落到 open-items 只有兩個小點：延後項目的文字寫出回頭條件（11 筆延後中已有 6 筆自己這樣寫）、決策備註寫理由（18 筆已完成決策約 8 筆有）。兩者證據都弱，見建議表第 11、13 項。
- **最值得做的三項**（細節見第 6 節）：(1) stats 排除確認型問句（改動小、證據強）；(2) 面板的「此 branch」過濾與排序（改動小，證據弱，暫緩）；(3) 無強證據的其他項都建議暫緩。實際上這次只有第 1 項證據足夠；B、C 圈新增的第 11–14 項證據都弱，只有第 11 項成本低到（一句規則文字）值得考慮。

## 2. 對照表

「深入」＝第 3 節（A 圈）或第 4 節（B 圈）有筆記；「列表」＝只列一行。

| 工具 | 範圍 | 抓取 | 重新浮現 | 收尾 | 儲存 |
|---|---|---|---|---|---|
| open-items（本 mod） | 深入（自己） | Claude 呼叫 `track add`；沒選的選項自動延後（可復原） | 載入後第一則 prompt 附清單；compact 時附清單；規則放 system prompt session 區段；輸入框上方計數 | Claude 呼叫 `resolve`（決定要附理由）；面板按完成／不做；7 天以上項目變淡 | `$.store`，依 repo 分，worktree 共用，300 筆決策紀錄 |
| beads | 深入 | 使用者與 agent 都用 `bd create`；`bd remember` 存長期事實 | `bd prime` 在 SessionStart 與 PreCompact 注入；`bd ready` 列沒被擋住的項目 | `bd close`，關閉後解除依賴；舊的已關閉項目做語意壓縮（memory decay） | Dolt（版本化資料庫），`.beads/issues.jsonl` 只是匯出 |
| Claude Code Tasks／TodoWrite | 深入 | Claude 自己用 TaskCreate／TaskUpdate | Ctrl+T 顯示最多 5 項；compact 後仍在；`--resume` 還原展開狀態 | Claude 更新狀態；`CLAUDE_CODE_TASK_LIST_ID` 可跨 session 共用 | `~/.claude/tasks/` |
| Cline Focus Chain | 深入 | Claude 建 todo；使用者可改 markdown 檔 | 預設每 6 則訊息提醒一次（1–100 可調）；Plan 轉 Act 與使用者手改時也提醒 | Claude 更新 | 可編輯的 markdown 檔 |
| Taskmaster | 深入 | 解析 PRD 產生任務，或對話中建立 | `next_task`（使用者或 agent 主動問） | `set_task_status` | 專案內檔案 |
| Gemini CLI `write_todos` | 深入 | 模型每次傳整份清單 | 輸入框上方進度條；Ctrl+T 展開 | 模型更新狀態；一次只能有一個 in_progress | 只在該 session |
| Roo／Kilo todo list | 深入 | 模型用 `update_todo_list` 整份取代 | 聊天裡顯示清單；Kilo 可在核准前編輯 | 模型更新（pending／in-progress／completed） | 該 task（見筆記，細節未逐項查證） |
| shrimp-task-manager | 列表 | 使用者說「plan task」，模型拆解 | 使用者說「list tasks」「execute task」；另有 Task Viewer（React，localhost:5173） | 文件有「reflect task」；README 沒有驗證評分的描述 | 「任務記憶」備份（細節未查證） |
| Codex CLI `update_plan` | 列表 | 模型更新有序步驟清單 | TUI 的 plan 視圖 | 模型標完成 | 無（未查證）；第三方回報 2026-08 預設改為 opt-in，未能用官方來源確認 |
| openloops／open-loop 類工具 | 列表 | 未查證 | 未查證 | 未查證 | 搜尋沒有找到名為 openloops 的專案；找到的 jaltez/openloop 是跨 repo 自動開發迴圈，不是待辦工具（https://github.com/jaltez/openloop） |
| taskwarrior | B 圈（深入，4.1） | 使用者 `task add`／`annotate` | `wait:` 到期才重新出現；`next` 報表依 urgency 排序 | `done`；`until:` 到期自動刪除 | 本機檔案 |
| todo.txt | B 圈（列表，4.4） | 使用者 | 純文字檔 | 行首 `x` 加完成日 | 純文字 |
| dstask | B 圈（深入，4.2） | 使用者 `add`，`/` 後接 note；`log` 記已完成項 | `next` 為預設；P3 淡化；暫停項醒目；context 外有 P0 時印提示 | `done`；`undo` 用 git revert；`show-resolved` 依週回顧 | git repo（YAML）；context 在 `.git/dstask/state.bin` |
| git-bug | B 圈（列表，4.4） | 使用者，bridge 匯入 | CLI／TUI／Web | 改狀態 | git 內部 |
| adr-tools／MADR | B 圈（深入，4.3） | `adr new`，範本四段 | 無（靠人或 agent 去讀） | `adr new -s N` 取代舊決策並改舊檔狀態 | markdown 檔 |
| leasot | B 圈（列表，4.4） | 掃描程式碼註解 | 報表 | 註解被刪就消失 | 不另存 |

## 3. A 圈各工具筆記

### 3.0 挑選理由

依「跟 open-items 定位多接近」和「資料夠不夠」：
- 選 **beads**：同樣要跨 session、同樣為 coding agent，有 SessionStart／PreCompact 注入，且 issue 資料豐富（ROADMAP 已引用它的 `bd ready`）。
- 選 **Claude Code Tasks／TodoWrite**：同一個宿主，使用者最容易拿來互相比較，也是 open-items 最直接的「重疊風險」。
- 選 **Cline Focus Chain**：ROADMAP 已否決它的「每 N 輪注入」，需要看一手文件與 issue 驗證。
- 選 **Taskmaster**：最大宗的使用者，issue 資料多，是「做太重」的反面教材。
- 選 **Gemini CLI `write_todos`**：同為終端機、輸入框上方顯示，與 open-items 的計數列最像。
- 選 **Roo／Kilo todo list**：有「使用者可在核准前編輯」的互動點，其他工具沒有。
- 未深入：shrimp（README 沒有成本、提醒機制等一手細節）、Codex `update_plan`（找不到官方頁面，只有第三方文章）、openloops（找不到同名專案）。

### 3.1 beads（steveyegge/beads）
- 定位：給 coding agent 的持久記憶，指令列工具 `bd`；README 寫「Do not use markdown TODO lists for task tracking」。https://raw.githubusercontent.com/steveyegge/beads/main/README.md
- 抓取：使用者與 agent 用同一組指令（`bd create`）；`bd remember "insight"` 存長期事實。同上。
- 重新浮現：`bd ready` 列出沒有未解決阻擋的任務；`bd prime` 輸出「agent workflow context and persistent memories」；`bd setup claude`／`bd setup codex` 安裝 hook。README 沒有寫 hook 何時觸發，也沒有 token 數字。同上。維護者在 issue 中說 `bd prime` 在 SessionStart 與 PreCompact 執行，輸出保持精簡。https://github.com/steveyegge/beads/issues/486
- 收尾：`bd close`；關閉會解除依賴者，使其回到 `bd ready`；舊的已關閉任務做語意壓縮（README 說「memory decay」）。同上 README。
- 低改動高效益：`--claim` 一步完成「指派加進行中」；hash ID（`bd-a1b2`）避免多 branch 合併衝突；`bd init --stealth` 不把檔案提交進主 repo。同上 README。
- 工作流程：Dolt 原生分支與合併，用 git remote 的 `refs/dolt/data` 同步；README 沒提 worktree。同上 README。
- 反例（使用者回饋）：
  - #295「Shrink 10k+ context window used by beads」（已關閉）、#2139「`bd prime` 應是單一來源，init／setup／prime 重疊每個 session 浪費約 300 token」、#436「`bd prime` 在非 beads 目錄也輸出」、#855 要求照 skill 的漸進揭露改寫。列表來源：https://github.com/steveyegge/beads/issues?q=is%3Aissue+bd+prime+tokens （僅讀標題，內文未逐篇確認；#295 單頁回 404）
  - #486：context 重置後 Claude 回頭用內建 TodoWrite，使用者要一直提醒。維護者回覆：靠 hook 重新注入，舊版問題在新版已重做，之後關閉。https://github.com/steveyegge/beads/issues/486
  - #2938「Beads feels painful to use」：花約 9.5 小時處理 SQLite、daemon、`bd init` 覆蓋 git hooks、`bd doctor --fix` 讓問題更糟；指令重疊（`prime`／`onboard`／`init`／`setup`）令人困惑；每次升級都壞東西。維護者後續提出「縮小支援的工作流程、減少手動設定」的穩定計畫。https://github.com/steveyegge/beads/issues/2938
- 對 open-items：支持「不要依賴關係」（ROADMAP 已否決）；#486 證明「規則要在 compact／重置後仍在」是必要，open-items 已做。

### 3.2 Claude Code 內建 Tasks／TodoWrite
- Task 工具（TaskCreate、TaskGet、TaskList、TaskUpdate）預設只在列出的模型上提供；TodoWrite 預設關閉，設 `CLAUDE_CODE_ENABLE_TASKS=0` 才啟用。https://code.claude.com/docs/en/tools-reference
- Ctrl+T 顯示或隱藏清單，最多同時顯示五項；展開狀態在 `--resume`、`--continue` 時還原；清單「persist across context compactions」；`CLAUDE_CODE_TASK_LIST_ID` 指向 `~/.claude/tasks/` 下的命名資料夾，可跨 session 共用。https://code.claude.com/docs/en/interactive-mode
- 反例／缺口（使用者回饋，僅讀 issue 標題與摘要）：#90731「任務依 session ID 存放，新 session ID 讓既有任務留在磁碟卻列不出來」（開放）；#87057「TODO tasks lost during execution」（已關閉）；#93675「Task tools are off by model, with no settings key」（開放）。https://github.com/anthropics/claude-code/issues?q=is%3Aissue+TodoWrite+OR+%22task+list%22+persist+resume
- 與 open-items 的分工：Tasks 是「這項工作的步驟」，預設不跨 session（除非設 ID）；open-items 是「別人（使用者）還沒回答的事」，依 repo 保存。兩者可共存。
- 可借用：展開狀態跨 resume 還原（open-items 面板是臨時開關，沒有這個需求證據）。

### 3.3 Cline Focus Chain
- 以下取自官方文件頁 https://docs.cline.bot/features/focus-chain 的搜尋摘要（直接抓取該頁時回傳的是別頁內容，**逐字未核對**）：預設關閉；「Remind Cline Interval」預設 6 則訊息，範圍 1–100；Plan 轉 Act 與使用者手改 todo 時也會提醒；todo 存成可編輯的 markdown 檔。
- 反例：issue #8256「`task_progress` 參數被帶到外部 MCP 工具，導致呼叫失敗」；#7696「空的 `focus_chain` 工具描述讓 Bedrock 的驗證失敗」；#7524 同因造成 Anthropic 模型 500 錯誤。https://github.com/cline/cline/issues?q=focus+chain （依 GitHub API 搜尋結果，僅讀標題與摘要）
- 對 open-items：每 N 則提醒的成本是每 N 輪重複的 token，加上與其他工具的介面相互干擾（上述 issue）。支持 ROADMAP 的「不做每 N 輪注入」。可借用的是「使用者手改時才通知模型」，open-items 的面板關閉項目通知（`panelNote`）已是同樣設計。

### 3.4 Taskmaster（eyaltoledano/claude-task-master）
- 任務來自 `task-master parse-prd`；`next_task` 由使用者或 agent 主動問；README 沒有定義狀態生命週期。https://raw.githubusercontent.com/eyaltoledano/claude-task-master/main/README.md
- 成本：預設 `all` 載入 36 個工具、約 21,000 token；`standard` 15 個約 10,000；`core`（lean）7 個約 5,000，README 自述省約 70%。同上。
- 反例：#1280「MCP Context Bloat: Suggestion for Lightweight Profile」（已關閉，後來有了 core 模式）；#1137「get_tasks 回應超過 token 上限，要求分頁」（開放）。https://github.com/eyaltoledano/claude-task-master/issues?q=tokens+context （GitHub API 搜尋，標題與摘要）
- 對 open-items：支持「一個工具、少量描述」的設計；`track` 的描述放在 MCP 工具描述裡，成本遠低於 5,000 token（未量測，依工具數 1 個估計）。

### 3.5 Gemini CLI `write_todos`
- 五種狀態（pending、in_progress、completed、cancelled、blocked）；每次更新傳整份清單；同時只有一項 in_progress；「Updates the progress indicator above the CLI input prompt」；Ctrl+T 展開；「Todo state is scoped to the current session」。https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/tools/todos.md
- 對 open-items：輸入框上方的進度條與 open-items 的計數同一種放法，互相印證；它不跨 session，正是 open-items 的差異。

### 3.6 Roo／Kilo todo list
- Roo 的 `update_todo_list` 以 markdown 清單整份取代，有三種狀態；Roo 3.23 說明可在聊天中檢視與管理。Kilo（fork）文件說提出更新時有「Edit」可在核准前改項目文字、增刪、調狀態。以上取自搜尋摘要，原頁抓取失敗（roocodeinc.github.io 回 404），**未逐字核對**：https://docs.roocode.com/features/task-todo-list 、https://kilo.ai/docs/basic-usage/task-todo-list
- Roo 文件自己對「使用者能改到什麼程度」的描述不一致（見搜尋摘要），因此不當依據。
- 對 open-items：可借用的點只有「核准前編輯」，而 open-items 不經核准，本身沒有對應位置。

## 4. B 圈：人用的終端機待辦與決策工具

### 4.0 挑選理由

標準是「哪個最有機會給 open-items 小改動、大效益」，同時要有原始碼或 issue 可讀。
- 選 **taskwarrior**：最成熟的終端機待辦，原始碼可讀；有 `wait`（隱藏到某日）、`until`（到期刪除）、`context` 和 urgency 公式，正好對應 open-items 現有的三個問題：延後項目何時回來、過期怎麼辦、多 branch 怎麼過濾。
- 選 **dstask**：自述是「像 taskwarrior 但用 git 同步」，狀態裡有 `deferred`、`delegated`、`paused`，與 open-items 的「延後」最接近；context 的存法和「context 外有幾項」的提示可以直接對照載入 toast 的「N 個在其他 branch」；issue #132 正好在討論延後到某日。
- 選 **adr-tools／MADR（合併成一節）**：open-items 的決策紀錄（帶理由完成、300 筆）就是輕量版決策紀錄；adr-tools 是原型、MADR 是目前仍在更新的模板，MADR 的 issue #217「為 LLM 讀取標準化 frontmatter」與本 mod 的對象（agent）同方向。
- 未深入（各一行，見 4.4）：todo.txt（格式與 open-items 同路線，沒有新點）、git-bug（bridge 方向已被 ROADMAP 否決）、leasot（TODO 註解同步已被否決）、taskbook、ultralist（本輪沒有讀，**未查證**）。

### 4.1 taskwarrior（GothenburgBitFactory/taskwarrior）

讀的是 clone 的原始碼（commit 38ac57f）與 `doc/man/task.1.in`，不是已發佈版本。
- 抓取：`task add`；`task <filter> annotate` 加註記；`task add` 時可附 `wait:`、`until:`、`due:`（`doc/man/task.1.in`）。
- 重新浮現：預設 `next` 報表依 `urgency-` 排序（`src/Context.cpp` 的 `report.next.sort=urgency-`）。`wait:<date>` 讓任務「hidden from most built-in reports」，日期過了「again becomes visible」（`task.1.in`），也就是時間到了自己回來，不用人記。
- 收尾：`done`；`until:<date>` 是「expiration date of task, after which it will be deleted」（`task.1.in`），即自動過期，且是刪除。
- urgency 公式（`src/Context.cpp` 預設值、`src/Task.cpp` 的 `urgency_*`）：`next` 標籤 15.0、due 12.0、blocking 8.0、scheduled 5.0、active 4.0、**age 2.0**、annotations 1.0、tags 1.0、project 1.0、blocked -5.0、waiting -3.0。age 是「天數 ÷ `urgency.age.max`（預設 365）」的線性值，所以一年才拿滿 2 分；annotations 與 tags 是 0.8／0.9／1.0 的飽和值。結論：連 taskwarrior 自己都只把「年齡」當最弱的平手判斷。open-items 的「7 天變淡」同樣是低權重提示，沒有理由升級成排序。
- 低改動高效益的設計：
  - 預設值先用、再調（urgency 文件的建議，見 https://taskwarrior.org/docs/urgency/）。
  - `wait` 的語意是「現在不用看」而不是「不存在」：項目仍在，只是報表排除 `+WAITING`。
  - context 以名稱存一組過濾條件；issue #3053 標題「Override context on specific terminals」（開放）顯示使用者想要在特定終端機臨時換 context（dstask 用環境變數 `DSTASK_CONTEXT` 解了這點，見 4.2）。
- git／工作流程：原始碼與 man 頁清單中沒有看到 git 整合，同步走另一套機制（`task-sync.5`），細節**未查證**。
- 使用者抱怨（issue 標題與開頭內文）：
  - #2917「Some filters don't obey task contexts」（開放）：設了 context 後，`task list urgency > 10` 仍列出 context 外的項目。
  - #3730「Context is not respected by `modify` command」（開放，2024-12 提出）：`task status:pending modify +testtag` 改到 context 外的任務。
  - 共同教訓：**預設過濾一旦「有些指令認、有些不認」，使用者就會被誤導**。這是 context／「此 branch」類功能最大的風險，詳見建議表第 2 項。
  - urgency 有大量 issue（#2078、#2743、#3111 等），多是在抱怨係數與依賴繼承的行為；open-items 不做依賴與排序，可避開。
- 對 open-items：（1）`wait` 的「時間到了才回來」＝ 建議表第 12 項（貪睡），但本機證據不足；（2）`until` 的自動刪除與 ROADMAP「不做自動驗證」同精神，不採用；（3）age 係數低，支持維持 7 天淡化而不排序。

### 4.2 dstask（naggie/dstask）

讀的是 clone 的原始碼（commit cdfd902）與 README。
- 抓取：`dstask add 標題 +tag project:x P1 due:friday`；`/` 後面的字一律當 note（README 語法表：`dstask add check out ipfs / https://ipfs.io`）；`log` 記錄「已完成」的任務（README 指令表：「Log a task (already resolved)」）。`template:<id>` 可從範本建立。
- 狀態：`pending`、`active`、`resolved`、`delegated`、`deferred`、`paused`、`recurring`、`template`（`const.go`）。
- 重新浮現：`next` 是不帶指令時的預設；依優先序再依建立日排序；P3「Shown at bottom and faded」；暫停的任務「slightly highlighted」，`show-paused` 在它們「pile up」時用；`show-unorganised` 用來回顧沒分類的項目（README「General tips」）。
- context 怎麼存：`context` 指令把過濾條件序列化成 gob 檔，路徑是 `<repo>/.git/dstask/state.bin`（`config.go` 第 34 行、`localstate.go`）。放在 `.git` 目錄內，所以**不進版本、不跨機器同步**（README：「Context is not synchronised between machines」）。環境變數 `DSTASK_CONTEXT` 優先於磁碟上的 context，README 建議用 direnv 讓每個專案目錄自動切換。`--` 暫時忽略 context。
- context 外的提示：`display.go` 第 34 行起，每次列出時若有 context 外的 P0 項目，印出「N critical task(s) outside this context! Use `dstask -- P0` to see them.」。這是我見過最小的「過濾不能讓人漏看」設計：過濾可以預設，但**重要的被藏起來要有一行提示**。open-items 的載入 toast 已有「N 個在其他 branch、M 個超過 7 天」（`items.ts` 的 `loadSummary`），概念相同。
- 收尾：`done` 轉 resolved；`show-resolved` 依週顯示完成的任務，README 圖說寫「Useful for meetings」；`undo` 以 git revert 還原，每個動作是一個 git commit（`git.go` 的 `MustGitCommit`）。
- 過期：沒有自動過期。README 的建議是「Use dstask to track things you might forget, rather than everything」「Record only required tasks … else your task list will grow unboundedly」，即**靠少登記而不是靠清除**，與 open-items 只登記未決事項、ROADMAP 不做自動清除一致。
- git／工作流程：任務存成 git repo 內的 YAML 檔，`sync` 先 pull 再 push；不是專案 repo 的一部分。
- 使用者抱怨（issue 標題與討論）：
  - #132「support for 'wait' attribute」（開放，5 則留言）：使用者要「延後到某日才出現」；維護者與貢獻者討論結果是預設隱藏、另開 `show-deferred`，並且要「indication of hidden deferred tasks in context」（隱藏的要有提示）。與上面「context 外提示」是同一條原則。
  - #161「Cannot view tasks once they are resolved」（開放）：完成後找不到當初寫的 note，只能 grep YAML。對照 open-items：完成時的 note 進決策紀錄，`/open-items log` 與 `track history` 可查，已避開這個問題。
  - #87「inconsistencies when merging context with filter provided as argument (OR vs AND)」（開放，12 則留言）：context 與臨時過濾條件相疊時語意不一致。與 taskwarrior #2917 同類。
  - #108「Better documentation: define contexts/antitags」：context 需要額外學習成本。
- 對 open-items：（1）「此 branch」過濾若做，要有 dstask 式的隱藏數量提示與一個可繞過的方法；（2）`wait`／defer 的討論顯示「延後」要有時間或條件才有意義（建議表第 11、12 項）；（3）`show-resolved` 按週回顧對照 `/open-items log`，後者使用 0 次，沒有證據需要週回顧。

### 4.3 adr-tools 與 MADR（決策紀錄）

讀的是 clone 的原始碼：adr-tools commit b3279ba（2020-03-30，之後沒有更新）、MADR commit ba75bb1（2026-08-28）。
- 抓取：`adr new 標題` 依範本建檔；範本固定四段：Status、Context、Decision、Consequences（`adr-tools/src/template.md`）。MADR 有四種範本：bare-minimal、bare、minimal、full。minimal 版只有三段：Context and Problem Statement、Considered Options、Decision Outcome（「Chosen option: "{title of option 1}", because {justification}」）；full 版另有 YAML frontmatter（`status`、`date`、`decision-makers`、`consulted`、`informed`），範本註明這些「optional metadata elements」（`madr/template/adr-template*.md`）。
- 重新浮現：沒有。紀錄存在 markdown 檔，靠人或 agent 去讀；`adr list` 只列檔名（`src/adr-list`）。
- 收尾／過期：`adr new -s 9 標題` 建立取代第 9 號的新紀錄，並把舊紀錄 Status 段改為被取代（`src/adr-new`、`_adr_add_link`，以 awk 改 `## Status` 段文字）。舊紀錄保留。沒有自動過期。
- 低改動高效益的設計：
  - 紀錄很短：Nygard 寫「The whole document should be one or two pages long」，並要求完整句子。
  - 理由與結果綁在一句：MADR minimal 的 `Chosen option: X, because Y`。
  - 被取代而不是刪除：「it's still relevant to know that it _was_ the decision, but is _no longer_ the decision」（Nygard）。
- git／工作流程：紀錄是 repo 內的檔案，隨 commit 走；adr-tools 沒有 hook。
- 使用者抱怨：
  - adr-tools #123「Supper surprised different ADR status variables are not baked in」：狀態只有 Accepted／Superseded，沒有「提議中」等階段（開放）；#133 狀態字串拼錯（SUPERCEDED）；#151「Project Status and Future Maintenance」（開放，內文未讀，只讀標題）。狀態用自由文字存在 markdown 段落裡，容易不一致。
  - MADR #228「Status values: clarify case sensitivity」、#218「Minimal template — confusing marking one of the sections as optional」、#32「Support quick decision of done」（開放）：討論如何判斷決策「做完」，引用 Zimmermann 的檢查清單（見 5.2）。
  - MADR #217「Standardize frontmatter for easier LLM ingestion」（開放，2026-05-25，6 則留言）：提議讓 agent 只讀 frontmatter（type、id、title、status、tags、related），需要時才載入內文，類比 skill 的漸進載入。對照 open-items：載入時只附「id：短句（branch）」一行，已是同樣的做法。
- 對 open-items：（1）決策完成時帶理由與 MADR 的 `Chosen option … because …` 同構；實際使用中約一半的備註只寫結果、沒寫理由（見建議表第 13 項）；（2）「取代」關係在本機沒有案例（建議表第 4 項）；（3）狀態用固定欄位（kind、isDone、outcome）而非自由文字，已避開 #123、#133 這類問題。

### 4.4 其餘 B 圈工具（各一行，本輪未深入）

- **todo.txt**：「A single line … represents a single task」，行首 `x` 加完成日（https://raw.githubusercontent.com/todotxt/todo.txt/master/README.md）；與 open-items 一行一項同路線，沒有新點。
- **git-bug**：離線優先、資料放在 git 內部、bridge 匯入匯出 GitHub／Jira（https://raw.githubusercontent.com/git-bug/git-bug/master/README.md）；bridge 與 ROADMAP 已否決的「同步到 GitHub issue」同方向。
- **leasot**：預設掃 TODO 與 FIXME，註解須獨占一行（https://raw.githubusercontent.com/pgilad/leasot/master/README.md）；ROADMAP 已否決同步到 TODO 註解。
- **taskbook、ultralist**：未讀，**未查證**。

## 5. C 圈：理念

只收「能落到 open-items 具體功能」的觀點。原始出處兩項：一篇論文、一組決策紀錄的原作者文章。

### 5.1 Masicampo & Baumeister (2011)：寫下具體計畫能卸下未完成目標的負擔

- 出處：Masicampo, E. J., & Baumeister, R. F. (2011). Consider it done! Plan making can eliminate the cognitive effects of unfulfilled goals. *Journal of Personality and Social Psychology*。DOI 10.1037/a0024192；摘要取自 Europe PMC（PMID 21688924，https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:10.1037/a0024192&resultType=core&format=json）。
- 摘要寫的主張：未完成的目標會留在腦中（Zeigarnik 效應）；未完成目標造成閱讀時的侵入思緒、目標相關詞更容易想到、不相關的字謎表現變差；「Allowing participants to formulate specific plans for their unfulfilled goals eliminated the various activation and interference effects」；結論是「Once a plan is made, the drive to attain a goal is suspended … and is resumed at the specified later time」。
- 限制：我只讀了摘要，沒讀全文；摘要沒寫受試者與樣本數，**未查證**。研究對象是個人目標，推到「agent 開發時待決定的事」是我的推論。
- 落到的功能（一點）：
  1. **延後項目要帶「何時、等什麼」**：卸下負擔的是「具體計畫」，不是「記下來」。open-items 把沒選的選項自動延後，內容只有選項本身。使用紀錄中 11 筆延後項目（cc-mod-trimtab 完成 9 筆＋開放中 2 筆），有 6 筆文字自己就帶條件（「等設定寫好…」「合併 master 前：…」「部署後用 … 驗證」），5 筆沒有（人工讀文字判斷）。對應建議表第 11 項。

### 5.2 ADR 社群：決策要記錄理由，也要記錄何時回頭看

- 出處：Michael Nygard, "Documenting Architecture Decisions", Cognitect 部落格, 2011-11-15（https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions）；Olaf Zimmermann, "A Definition of Done for Architectural Decision Making"（https://ozimmer.ch/practices/2020/05/22/ADDefinitionOfDone.html）。
- Nygard：「One of the hardest things to track during the life of a project is the motivation behind certain decisions」；沒有紀錄的人只能「accept blindly or reverse blindly」；紀錄含 Title、Context、Decision、Status、Consequences，「one or two pages」；被推翻的決策保留並標為 superseded。
- Zimmermann 的 ecADR 檢查：Evidence、Criteria（至少兩個選項）、Agreement、Documentation、**Realization and review plan**（「when will we revisit and possibly revise this decision (expiration)?」）。
- 落到的功能（兩點）：
  1. **決策要帶理由**：open-items 的 `resolve` 對 decision 要求備註，且存入 300 筆紀錄。人工逐筆讀 18 筆已完成決策，約 8 筆備註含明確理由（例如「使用者原本就關掉，需要時用 … 臨時開」），其餘只寫結果或「使用者指定」。對應建議表第 13 項。
  2. **「何時回頭」**：Zimmermann 的 R 與 5.1 的「具體計畫」同指向延後項目該有回頭條件，對應第 11 項。
- 沒有落到功能的部分不收：「多人協作的 Agreement」「Evidence 驗證」不適用單人與 agent 的場景。

### 5.3 GTD（前一輪已查）

GTD 官方 What is GTD 頁只有流程簡述（Capture：「Write, record, or gather any and everything that has your attention into a collection tool」）。「open loops」「weekly review」「tickler」「someday/maybe」在該頁沒有出現，書本身我沒有取得，**未查證**，這一輪不使用。

## 6. 對照 open-items 與使用紀錄

### 6.1 使用紀錄摘要（2026-10-06 到 2026-10-12）

資料來源：`~/.claude/plugins/store/open-items_*.json`（兩個 marketplace 各一份，另有 inline 一份）、`~/.claude/projects/*/*.jsonl`、`~/.claude/history.jsonl`。`~/.claude/debug/` 只剩一個符號連結，沒有可用的 log，所以 `missed` 逐筆紀錄抓不到，改從 transcript 重算。

- `track` 呼叫共 281 次：add 145、resolve 132、history 2、list 2（transcript 計數）。`history` 與 `list` 幾乎沒用過。
- 指令使用：history.jsonl 裡 `/open-items` 5 次、`/open-items stats` 1 次；`undo`、`log`、`copy` 0 次。transcript 中面板關閉項目的通知出現 5 次。這代表項目幾乎都由 Claude 登記與完成（132 次 resolve），人只偶爾進面板。
- 載入時附清單的通知（carried over）在 transcript 出現 54 次。
- 項目壽命（cc-mod-trimtab 的 45 筆決策紀錄，按完成者）：decision 19 筆，登記到完成平均約 17 分鐘、中位數 7 分鐘、最長約 2 小時；question 15 筆，平均約 24 分鐘、中位數 15 分鐘、最長約 2.4 小時；deferred 9 筆，平均約 3.7 小時、中位數 31 分鐘、最長約 16 小時；bug 2 筆，約 3.4 小時與 12 小時。（2026-10-12 主 session 以 `at` 減去 uid 末段的建立時間重算，取代第一輪的數字。）紀錄的「不做」只有 1 筆。
- 目前未完成：5 筆，分散在 4 個其他 repo（bug 1、deferred 2、question 1、decision 1），最舊 5 天。沒有超過 7 天的。
- 注意：另一個 marketplace 的 store 的 `dropped` 紀錄中有一批註記為「擷圖用的示範資料，清除」，是文件截圖用的假資料，**我已排除，沒有算進上面的數字**。
- 決策紀錄的文字長度中位數約 52 字、備註中位數約 55 字、最長 89 字。皆短。
- 項目所屬 branch：紀錄 53 筆中 37 筆在 master、7 筆 main、其餘 9 筆在 `worktree-*`、`docs/split-readme`、`feat/agent-ledger` 等；約 17% 不在主幹，使用紀錄裡有 worktree 的實際使用。
- **漏抓率**：store 內 stats 為 12／6、30／21、1／1（問句／漏抓），合計 43 次問句結尾、28 次沒呼叫 `track`（65%）。transcript 重算（2026-10-06 之後共 493 個回合）：問句結尾 41 次，其中有 `track` 的 12 次，沒有的 29 次。這 29 次的下一則使用者訊息：14 次是 14 字內的短答（例如 ok、好、commit、開始第 2 步）、6 次是系統或跨 session 訊息、2 次沒有下一則、7 次是實質回答。抽查 7 次實質回答的首句，都是直接回答了問題，沒有「剛剛那個問題呢」之類的追問。
- **重複追問的訊號**：在 history.jsonl 3,107 則中搜尋「還沒回答」「沒選」「延後」「待決定」「漏掉」「忘了」等詞，沒有發現使用者在追問被遺漏的問題或延後項目（「剛剛」「剛才」出現很多，但都是在指剛做完的工作，不是未決問題）。這是關鍵字抽樣，不是全文審查。

### 6.2 建議表

排序依「改動小、效益大」；第 11–14 項為 B、C 圈新增，證據都弱，沒有一項強到值得立即做。證據強度：強＝有多筆實例；弱＝單一或間接；無＝找不到案例，標為暫緩。

| 功能 | 來源工具 | 改動大小 | 預期效益 | 使用紀錄的證據 | 與 ROADMAP |
|---|---|---|---|---|---|
| 1. `stats` 不把確認型問句算漏抓：在下一則 prompt 若是短答（約 14 字內）或回答以「要我…嗎」「要照這樣…嗎」收尾，就不計入漏抓；或另列「有實質選項的問句」一欄 | 無外部來源（自己的指標問題）；呼應 beads #486 的「漂移要能量測」 | 小（只動 stats 的計數時機，不動 `track`） | 讓漏抓率回到可信，才有辦法判斷 Haiku 抽取要不要做 | 強：29 次無 `track` 的問句結尾中，14 次下一則是 14 字內短答、6 次是系統或跨 session 訊息，真正實質回答只有約 7 次 | 無衝突；直接影響「Haiku 抽取」暫緩項的重新評估條件（見 7） |
| 2. 載入 toast 與面板預設先列「此 branch」的項目，其他 branch 的收合或淡化（dstask 的 context 預設概念） | dstask `context`、git-bug | 小（面板排序與淡化規則；branch 欄位已存在） | 在 worktree 並行時減少看到別條線的項目 | 弱：約 17% 的紀錄來自非主幹 branch 或 worktree，但沒有抱怨或誤關案例；目前未完成項目只有 5 筆 | 無衝突。標「暫緩」：未完成項目超過約 15 筆、或在 worktree 裡誤關別 branch 的項目時重新評估。若做，設計守則取自 B 圈：(a) 隱藏的要有數量提示（dstask 的「N critical task(s) outside this context!」）；(b) 要有一個一步繞過的方法（dstask 的 `--`）；(c) 所有入口（面板、toast、附給 Claude 的清單、`copy`）規則一致，taskwarrior #2917、#3730、dstask #87 都是「有些指令不認 context」造成的 |
| 3. `history`／`list` 的使用提示（在 `PROMPT_RULES` 減少這兩個 action 的說明） | Taskmaster 的精簡工具集（#1280） | 小（改一段規則文字） | 每個 session 少幾十個 token | 弱：`history`、`list` 各只用 2 次／281 次；但沒有證據說這段規則造成問題，節省量也很小 | 無衝突。標「暫緩」：規則文字所佔 token 成為抱怨，或 `history` 持續為 0 次一個月以上時再評估 |
| 4. 完成決策時建立「取代」關係（`superseded_by`，adr-tools 的 `-s`） | adr-tools | 中（紀錄欄位、查詢、面板顯示） | 之後重新做相反決定時，舊決策自動標為被取代 | 無：紀錄中沒有發現同一個問題被重新決定、需要取代舊決策的案例（`log` 指令使用 0 次） | 無衝突。暫緩；條件：出現 2 次以上「重新做出與舊紀錄相反的決定」，並且在 `log` 查到舊紀錄 |
| 5. 面板展開狀態、排序或篩選跨 `--resume` 還原 | Claude Code Tasks | 小 | 回到 session 後少按一次鍵 | 無：面板開啟只有 5 次，沒有人抱怨需要重開 | 無衝突。暫緩 |
| 6. 使用者在面板編輯項目文字 | Kilo 的「核准前編輯」 | 中 | 修正 Claude 登記錯的短句 | 無：沒有項目因文字寫錯被關掉重開的案例 | 無衝突。暫緩 |
| 7. 項目逾期自動提醒或到期清除 | taskwarrior age 係數、dstask `show-paused` | 中 | 避免項目被遺忘 | 無：最舊未完成 5 天，沒有超過 7 天；延後類平均約 3.7 小時、中位數 31 分鐘就完成 | 與 ROADMAP「不做」的自動驗證精神一致（用年齡讓人判斷）。暫緩。B 圈補充：taskwarrior 的 age 係數只有 2.0、一年才拿滿，`until` 是自動刪除而非提醒；dstask 無自動過期、靠少登記控制清單，皆不支持新增過期機制 |
| 8. 依賴與 `ready` 清單 | beads | 大 | 多步驟專案的下一步排序 | 無：項目只是 50 字短句，沒有依賴關係的需求 | ROADMAP 已「不做」，新證據無反對 |
| 9. 每 N 則訊息重新注入 | Cline Focus Chain | 中 | 防止清單被遺忘 | 無：沒有 Claude 忘記清單的案例；且 Focus Chain 本身有成本與相容性問題（Cline #8256、#7696） | ROADMAP 已「不做」，新證據支持 |
| 10. 同步到 GitHub issue | git-bug bridge | 大 | 與團隊共享 | 無 | ROADMAP 已「不做」，無新證據 |
| 11. `track` 對 deferred 的說明加一句：文字寫出「等什麼、或何時回頭」（只改規則文字，不加欄位） | taskwarrior `wait`、dstask #132、Masicampo & Baumeister (2011)、Zimmermann 的 R（review plan） | 小（一句規則文字） | 載入時一眼知道這項何時該處理，不必再問 Claude 或自己回想 | 弱至中：11 筆延後項目中 6 筆文字已自帶條件、5 筆沒有；沒有因為缺條件而被遺忘或誤處理的案例（9 筆已完成的延後，最長 16 小時）。最舊的開放延後項目 5 天，文字無條件 | 無衝突。可做但非急迫；若不做，暫緩條件：出現延後項目超過 7 天未處理且文字無條件的案例達 3 筆 |
| 12. 延後項目「貪睡」：到某日或某條件前，載入時不附給 Claude，toast 只顯示數量 | taskwarrior `wait`、dstask #132（延後到某日） | 中（新欄位、載入過濾、面板按鍵） | 長期延後的項目不在每次載入時重複出現 | 無：載入通知 54 次，但未完成延後項目只有 2 筆（2 天、5 天），沒有使用者要求隱藏或抱怨重複出現的紀錄（上一輪的關鍵字抽樣未見） | 無衝突。暫緩；條件：同一延後項目超過 7 天仍在、且使用者表示不想每次看到，或未完成延後項目累積到 5 筆以上；若做，要照第 2 項的守則顯示被隱藏的數量 |
| 13. 決策完成備註採「選了 X，因為 Y」格式（規則一句話） | MADR minimal 的 `Chosen option: X, because Y`、Nygard | 小（規則文字） | 之後 `log`／`history` 查到的不只是結果，還有理由 | 弱：人工逐筆讀 18 筆已完成決策，約 8 筆備註有明確理由，其餘只寫結果或「使用者指定」；但 `log` 使用 0 次、`history` 2 次，沒有回頭查卻找不到理由的案例 | 無衝突。暫緩；條件：出現 1 次以上「查了 log 卻看不出為何這樣決定」 |
| 14. 手動完成或不做也能 `undo`（目前只有自動延後可復原） | dstask `undo`（git revert） | 中 | 誤按時能復原 | 無：面板關閉項目的通知 5 次，沒有誤關案例 | 無衝突。暫緩 |

## 7. ROADMAP 已暫緩或已否決的項目與新證據

- **「open-items 的 Haiku 抽取」（暫緩，條件：stats 漏抓率明顯偏高）**
  - 表面上條件已達成：store 內合計 28／43（65%），單個 store 一度 21／30（70%）。
  - 但抽查 29 次無 `track` 的問句結尾，約七成是確認型短答或系統訊息，只有約 7 次是實質回答，且都沒有後續追問。這是**反對現在啟動 Haiku 抽取**的新證據，同時指出評估條件本身需要修正：該用「扣除確認型問句後的漏抓率」，所以先做建議表第 1 項。
  - 樣本只有 6 天，7 次實質回答不足以斷定沒有漏抓。
- **「每 N 輪重新注入（Cline Focus Chain）」（不做）**：新證據支持。Focus Chain 預設每 6 則提醒、Cline 有數件因 focus_chain 工具介面引起的 issue（#8256、#7696、#7524）；你的紀錄裡也沒有 Claude 忘記清單的案例，且 compact 與 `/clear` 後注入已涵蓋。
- **「依賴與可做清單（beads `bd ready`）」（不做）**：新證據支持。beads 自己的使用者回報命令重疊、升級破壞資料（#2938）、context 過大（#295）；你的項目壽命從分鐘到數小時，沒有依賴需求。
- **「同步到 GitHub issue 或 TODO 註解」（不做）**：無新證據；git-bug 的 bridge 與 leasot 是這個方向，但兩者本質上是不同產品。
- **「載入時自動驗證是否仍成立（openloops 的 shell 判斷式）」（不做）**：我沒有找到名為 openloops 的專案（見第 2 節），來源**未查證**；使用紀錄也顯示項目很快完成，沒有需要自動驗證的長期項目，無反對證據。
- **「自動驗證／過期」類（不做）的 B 圈補充**：taskwarrior 的 `until` 是到期自動刪除，dstask 沒有自動過期；兩者都不支持在 open-items 加上自動清除。使用紀錄也沒有 7 天以上的項目（6.1）。
- **「Haiku 抽取」「依賴」「每 N 輪注入」**：B、C 圈沒有新證據，維持原結論。

## 8. 未查證／待追的問題

- Cline Focus Chain 官方文件頁的逐字內容：直接抓取 docs.cline.bot 兩個網址都回傳了別頁內容，預設 6 則與範圍 1–100 取自搜尋摘要。
- Roo Code todo list 的使用者編輯能力：官方頁抓取失敗（404），搜尋摘要又提到 Roo 文件自身不一致。
- Codex CLI `update_plan` 的預設（always-on 或 opt-in）：只有第三方文章和 mirror 的 commit 標題，沒有從 openai/codex 本身查證。
- shrimp-task-manager：README 沒有提醒機制、成本、`verify_task` 評分的描述（我讀到的 README 沒有這些詞），其他文件未讀。
- openloops：沒找到同名專案；ROADMAP 中這一項的原始來源需要回頭確認。
- GTD 的「open loops」「weekly review」：官方 What is GTD 頁沒有這兩個詞，未取得一手來源。
- beads #295 內文：單頁回 404，只讀到列表標題；#2139、#436、#855 同樣只讀標題。
- Claude Code issue #90731、#87057、#93675：只讀搜尋結果的標題與摘要，沒有開啟內文。
- 使用紀錄的限制：只有 6 天、一位使用者；`~/.claude/debug/` 的 `missed` 逐筆紀錄已不存在，漏抓是從 transcript 重算；關鍵字抽樣可能漏掉沒用關鍵字的追問；`/open-items stats` 的計數時間點與 transcript 計數略有差異（43 vs 41、28 vs 29）。
- 兩個 marketplace 的 store 各有一份，項目壽命統計只用了 cc-mod-trimtab 那份（45 筆）；另一份含截圖用假資料，沒有重新統計壽命。
- 所有廠商自述的數字（Taskmaster 的 21,000／約 70%）皆未獨立重現。
- taskwarrior：讀的是 clone 的 HEAD（commit 38ac57f）而非發佈版本；與 git 的整合與 `task-sync` 細節未查證；urgency 相關 issue 只讀標題；#2917、#3730 只讀開頭內文。
- dstask：issue #87、#108、#161 只讀標題（#161、#132 讀了開頭與部分留言）；README 沒有說 `deferred` 狀態的語意，只在 `const.go` 看到狀態名稱。
- adr-tools／MADR：adr-tools #151 只讀標題；MADR #228、#218、#32 只讀標題或開頭；adr-tools 的 `adr list` 只列檔名是看原始碼推得，沒有實跑。
- taskbook、ultralist、todo.txt 的附加工具：本輪未讀。
- Masicampo & Baumeister (2011)：只讀 Europe PMC 提供的摘要，沒讀全文，樣本與受試者背景未查證；PubMed 頁面抓取失敗（需要 cookie）。
- GTD 書本身（open loops、weekly review）：仍未取得一手來源。
- ~~6.1 的決策壽命分類計數與 store 不一致~~：已由主 session 依 store 重算並改正 6.1 與摘要（decision 19、question 15、deferred 9、bug 2，合計 45）；項目壽命比第一輪寫的長，但「分鐘到數小時內完成」的結論不變。
- 本輪新增的「延後項目 6／11 帶條件」「決策備註約 8／18 有理由」是人工讀文字的判斷（前者另以關鍵字「等」「後」「前」輔助），邊界案例可能有不同判讀；樣本只有 6 天。
