# AI 寫程式代理的記憶機制比較（對照 project-memory）

- 查證日期：2026-10-12（所有 URL 皆於當日存取）
- 來源規則：只用官方文件、廠商官方 blog／changelog、專案自己的 GitHub README／原始碼、作者論文。查不到一手來源的標「未查證」或刪除。
- 版本註記：許多功能是 preview／beta／會改名（見各節「版本相關」）。

## 1. 摘要

- **主流做法是「小索引常駐 + 內容按需讀取」**。Claude Code 只載入 MEMORY.md 前 200 行或 25KB，topic 檔由模型用一般檔案工具按需讀（https://code.claude.com/docs/en/memory）。Windsurf 的 Model Decision 規則也是只常駐 description、需要時才讀全文（https://docs.devin.ai/desktop/cascade/memories）。project-memory 的「60 行索引 + 單檔記憶」與此一致，方向正確。
- **GitHub Copilot 的核心價值是「讀取時驗證」**：記憶綁 citation，使用前對當前 branch 檢查；矛盾就改寫、有效就刷新時間戳（https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/）。project-memory 只檢查「相關檔案是否存在」，可再往「檢查檔案內容是否仍支持記憶」延伸，成本仍輕。
- **「使用即續命」的過期設計**：Copilot 未被使用的記憶 28 天後刪除，成功驗證與使用會重設計時器（https://docs.github.com/en/copilot/concepts/agents/copilot-memory）。project-memory 目前以「30 個工作日」計，是否把「被引用」也算進續命，值得評估（需要能偵測引用，偵測成本是難點）。
- **背景抽取 + 觸發條件節流是共識**：Codex memories 跳過進行中／過短的 session、等 chat 閒置夠久、剩餘 rate limit 太低就略過這一輪（https://developers.openai.com/codex/memories → 轉址 https://learn.chatgpt.com/docs/customization/memories.md?surface=app）。Letta 的 sleep-time 以「完成 N 個 agent 步驟」或「context 被 compact」觸發（https://docs.letta.com/guides/agents/architectures/sleeptime）。project-memory 的「每 N 則／idle／/clear」已是同級設計；可借「剩餘額度低時略過」。
- **各家都警告「自動記憶不是規則來源」**：Codex 建議必要規則放 AGENTS.md，記憶只是本機回想輔助；Windsurf 也建議可重用知識寫成 Rules／AGENTS.md，因為可版控分享。project-memory 「3 個 session 確認才提議升級到 CLAUDE.md、先問使用者」符合此共識，且門檻比多數家更明確。
- **Cursor 的 Memories 後來加入「使用者核准」**，之後（依社群回報，未官方證實）被移除、改為鼓勵轉成 Rules。信任與可審查性是自動記憶最大的存活風險。project-memory 的「檔案即記憶、markdown、可手改」是正解；可考慮在新增時給一個低干擾通知。
- **輕量路線的對手其實很少**：Mem0／Zep／claude-mem 都需要向量庫、圖資料庫或常駐 worker；真正與 project-memory 同量級的是 Claude Code 自己的 auto memory、Gemini CLI（純 markdown）、Basic Memory（markdown + 本機 SQLite 索引）。project-memory 的「帶有 invalidated／superseded_by 的失效機制」比這些輕量方案都完整，與 Graphiti 的「失效而非刪除」同理念，但不需要圖資料庫。
- **Mem0 的「ADD/UPDATE/DELETE/NOOP + 對 top-s 相似記憶比對」** 是 project-memory 的 add/update/invalidate 的原型；差別是 Mem0 用 embedding 找相似，project-memory 直接把整份記憶清單丟給 Sonnet，在 60 條上限內免向量庫。

## 2. 對照表

| 工具 | 注入方式 | 儲存 | 抽取模型與時機 | 過期與失效 | 使用者檢視 |
|---|---|---|---|---|---|
| Claude Code（CLAUDE.md） | 每 session 啟動全載入；子目錄檔按需載入；`.claude/rules` 可依 paths 載入 | 人寫 markdown；user／project／org 範圍 | 人寫 | 無 | `/memory`、`/context` |
| Claude Code auto memory | MEMORY.md 前 200 行或 25KB 常駐；topic 檔按需讀 | `~/.claude/projects/<project>/memory/` markdown；本機、同 repo worktree 共用 | Claude 在工作中自己寫（model 未載明） | 不隨 transcript 清理；靠 Claude／人刪改 | `/memory`、「Saved N memories」提示 |
| GitHub Copilot Memory | session 開頭帶入最近的記憶（blog）；每條使用前驗 citation | repo 層與 user 層結構化記錄（subject／fact／citations／reason），託管在 GitHub | agent 以 tool call 建立（需 write 權限） | 28 天未使用即刪；驗證通過可刷新 | repo owner 可審閱／刪除；user 可看與刪自己的偏好 |
| Cursor | Rules：always／智慧／glob／手動 | `.cursor/rules/*.mdc`、AGENTS.md；Memories 為每專案、存 Cursor 端 | Memories：背景生成（有核准步驟，依 changelog） | 無明載 | Settings 管理 |
| Windsurf Cascade | Rules 四種啟用模式；Memories 自動帶入 | Memories：`~/.codeium/windsurf/memories/`；Rules：`.devin/rules/*.md`（舊 `.windsurf/rules`） | Cascade 自動建立，建立與使用不耗 credit | 無明載 | 設定面板檢視／編輯；Memories 僅限 legacy agent |
| Cline Memory Bank | 每個 task 開頭「必須讀全部」檔案 | 專案內 `memory-bank/*.md`（6 個核心檔） | Cline 自己改，或使用者下「update memory bank」 | 無 | 純 markdown，可版控 |
| Roo Code | 規則檔按目錄／mode 載入 | `.roo/rules*/`、AGENTS.md | 無記憶功能 | – | – |
| Aider | repo map 預設約 1k token；conventions 檔用 `--read`（可 prompt cache） | 檔案（CONVENTIONS.md）；repo map 即時算 | 無記憶抽取；repo map 用圖排名 | – | 人寫檔案 |
| Codex CLI（AGENTS.md） | 根到當前目錄串接，總量上限預設 32 KiB | 人寫 markdown | 人寫 | – | 檔案 |
| Codex memories | 啟用後注入（具體內容未載明） | `~/.codex/memories/`（摘要、耐久條目、近期輸入、證據） | 背景；閒置夠久才處理；`extract_model`／`consolidation_model` 兩階段 | 未載明 | `/memories` 每 chat 開關；設定頁刪除全部 |
| Gemini CLI | GEMINI.md 階層每次 prompt 全帶；JIT 載入子目錄 | `~/.gemini/GEMINI.md`、專案 GEMINI.md、私人專案記憶夾 | 模型用 write_file／replace 寫入 | 無 | `/memory show`、`/memory reload` |
| Mem0 | 檢索（search）後注入 | 向量庫（+ 選配圖）；見下 | 兩階段：LLM 抽取 → LLM 判斷 ADD/UPDATE/DELETE/NOOP | 可設 `expiration_date` | Platform／OpenMemory dashboard（未查證細節） |
| Letta | memory blocks 永遠在 context；archival 另外檢索 | blocks（label／description／value／limit 字元）；新版 MemFS（git 支援的檔案系統） | 主 agent 自編輯；sleep-time／Dreaming 背景 subagent | 無明載 | 可讀寫 blocks |
| Zep／Graphiti | 混合檢索（embedding + BM25 + 圖走訪） | 時間知識圖（Neo4j／FalkorDB／Neptune） | 增量攝入時 LLM 抽取 | 事實有有效期間，矛盾時失效不刪 | API／圖查詢 |
| LangMem | 熱路徑或背景；profile／collection | LangGraph store（可無 DB 純函式使用） | 背景 memory manager | 合併／整併 | 程式化 |
| claude-mem | SessionStart 注入 + 三層漸進揭露（索引→時間線→細節） | SQLite（FTS5）+ Chroma 向量庫 | PostToolUse 等 hook 捕捉 → 語意摘要（模型可設） | 無明載 | worker + 本機 UI（細節未逐項查證） |
| Basic Memory | 模型經 MCP 工具讀寫、`build_context` 走 `memory://` | markdown + 本機 SQLite 索引 | 無自動抽取；LLM 經 MCP 寫 | 人／模型編輯 | 直接編輯檔案（Obsidian 類） |
| memory MCP server | 模型呼叫 `read_graph`／`search_nodes` | JSONL 知識圖（entities／relations／observations） | 模型依 system prompt 自行更新 | 手動 delete_* | 檔案 |

## 3. 各工具筆記

### 3.1 Claude Code 官方記憶
- 兩套機制並存：CLAUDE.md（人寫）與 auto memory（Claude 寫），兩者都在每次對話開頭載入，且「Claude treats them as context, not enforced configuration」。https://code.claude.com/docs/en/memory
- CLAUDE.md 建議每檔 200 行內；import 不會降低 context 成本；子目錄的 CLAUDE.md 在讀到該目錄檔案時才載入；根目錄 CLAUDE.md 在 `/compact` 後重新注入。同上。
- auto memory 存 `~/.claude/projects/<project>/memory/`，由 git repo 推導，worktree 共用；機器本機，不跨機器。MEMORY.md 是「one line per memory」的索引，前 200 行或 25KB 載入，topic 檔不在啟動時載入，由 Claude 按需讀。同上。
- 寫入後系統量測 MEMORY.md；接近上限時提醒 Claude 縮短，超過時寫入成功但回傳「重寫索引」的錯誤。同上。
- 記錄四類 `type`：user／feedback／project／reference；「Claude skips anything it can derive from the codebase」，也略過 CLAUDE.md 已有的內容。同上。
- 開關：`/memory` 內切換（寫入 `autoMemoryEnabled`）、環境變數 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`；可用 `autoMemoryDirectory` 改位置。同上。
- 子 agent 可有自己的 auto memory；主對話的 auto memory 不會載入子 agent（fork 例外）。同上。
- 版本相關：`/memory` 不再等編輯器關閉（v2.1.216）、`/import`（v2.1.213）、`CLAUDE_CODE_PROJECT_DIR_NAME`（v2.1.234）、AGENTS.md 列入 `/memory`（v2.1.280）。同上。

### 3.2 GitHub Copilot Memory
- 公開預覽（「subject to change」）。儲存 repo 層事實（慣例、架構決策、build 指令）與 user 層偏好。https://docs.github.com/en/copilot/concepts/agents/copilot-memory
- repo 事實連結到支持它的程式碼；使用前對當前 branch 檢查 citation，只用驗證通過的事實；user 偏好可附使用者原話為 citation。同上。
- 未使用的記憶 28 天後自動刪除；成功驗證與使用可重設計時器。同上。
- 以使用者為單位開關；組織／企業方案要管理員先啟用政策，個人可 opt out。同上。
- 設計文章：每條記憶 = subject、fact、citations、reason；建立是 tool call，僅 write 權限貢獻者可建；session 開頭放 repo「最近的記憶」，未來才加搜尋與加權。https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/
- 讀取時驗證：矛盾或 citation 失效 → 存修正版；有效且有用 → 重存以刷新時間戳。同上。
- 對抗測試：以假事實＋壞 citation 注入，agent「consistently verified citations, discovered contradictions, and updated incorrect memories」；coding agent PR merge 率 83% → 90%，code review precision +3%、recall +4%（官方自述數據）。同上。

### 3.3 Cursor
- Rules：Project（`.cursor/rules/*.mdc`）、User、Team（dashboard）、AGENTS.md；四種套用模式。建議單條規則 500 行內，「Reference files rather than copying their contents」，避免過時。https://cursor.com/docs/context/rules
- Memories：1.0 beta，每個專案、使用者個人，可在 Settings 管理。https://cursor.com/changelog/1-0
- GA 版 changelog 提到「introduced user approvals for background-generated memories to preserve trust」（來源為搜尋結果摘要，原頁未逐字確認，版本編號未查證）。論壇回報後來被移除、改建議轉為 Rules：屬社群資料，**未查證**。

### 3.4 Windsurf Cascade
- Memories 由 Cascade 自動或應請求建立，存 `~/.codeium/windsurf/memories/`，限該 workspace，「Creating and using auto-generated memories do NOT consume credits」；現僅適用 legacy Cascade agent。https://docs.devin.ai/desktop/cascade/memories
- Rules 四種啟用模式：Always On、Model Decision（只常駐 description）、Glob、Manual；global 規則上限 6,000 字元、workspace 規則每檔 12,000 字元。同上。
- 官方建議把可重用知識寫成 Rules／AGENTS.md（可版控分享）而非依賴自動記憶。同上。
- 版本相關：網域由 docs.windsurf.com 轉到 docs.devin.ai，產品正在改名與調整。

### 3.5 Cline Memory Bank
- 6 個核心檔（projectbrief／productContext／activeContext／systemPatterns／techContext／progress）；指令寫「I MUST read ALL memory bank files at the start of EVERY task」；更新於重大改變、或使用者說 "update memory bank"。https://docs.cline.bot/features/memory-bank
- 頁面未給 token 數。它是「全載入」型，成本隨檔案增大；優點是透明、可版控。

### 3.6 Roo Code
- 規則：`.roo/rules/`、mode 專屬 `.roo/rules-{mode}/`、AGENTS.md；文件未描述記憶功能。https://roocodeinc.github.io/Roo-Code/features/custom-instructions

### 3.7 Aider
- repo map：以檔案為節點、依賴為邊建圖排名，預設 `--map-tokens` 1k，無檔案加入 chat 時會擴大。https://aider.chat/docs/repomap.html
- conventions：`--read CONVENTIONS.md` 以唯讀載入，啟用 prompt caching 時會被快取。https://aider.chat/docs/usage/conventions.html
- 沒有自動記憶抽取。可借鏡的是「用固定 token 預算 + 排名」控制注入量。

### 3.8 OpenAI Codex CLI 與 ChatGPT
- AGENTS.md：global（`~/.codex`）+ 專案根到當前目錄逐層串接，後者優先；總量到 `project_doc_max_bytes`（預設 32 KiB）即停止。https://learn.chatgpt.com/docs/agent-configuration/agents-md
- Codex memories（預設關閉；發布時不含 EEA／UK／瑞士）：跳過進行中或過短的 session、遮蔽祕密、背景更新、chat 閒置夠久才總結、剩餘 rate limit 低於門檻就跳過；設定含 `generate_memories`、`use_memories`、`extract_model`、`consolidation_model`、`min_rate_limit_remaining_percent`、`disable_on_external_context`。https://learn.chatgpt.com/docs/customization/memories.md?surface=app
- 檔案是「generated state」，不建議以手改為主要控制；必要規則應放 AGENTS.md。同上。
- 兩階段（per-chat extract → global consolidation）是值得注意的結構。頁面未載明預設模型、閒置時長與注入內容。
- ChatGPT（網頁）記憶：OpenAI 頁面回 403，**未查證**，不列細節。

### 3.9 Gemini CLI
- GEMINI.md 三層：global `~/.gemini/GEMINI.md`、工作區與其上層（每次 prompt 都送出）、JIT（工具碰到某目錄時才載入該目錄及祖先的 GEMINI.md）；CLI 頁尾顯示載入檔數。https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/gemini-md.md
- `/memory show` 顯示完整串接內容；`/memory reload` 重新掃描。同上。
- 記憶 tool 文件目前描述「模型用 write_file／replace 直接編輯 markdown」，依類型分流：跨專案偏好 → 全域檔、共享專案指示 → repo GEMINI.md、私人專案筆記 → 每專案私人記憶夾；文件強調「avoids duplicating the same fact across multiple memory tiers」。https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/tools/memory.md
- 版本相關：舊版的 `save_memory` 工具名稱在目前文件中查無，**未查證**。

### 3.10 Mem0
- add：LLM 從訊息抽出事實；平台版「additive」，非同步（PENDING + event_id）；`expiration_date` 讓過期記憶從 search 隱藏。https://docs.mem0.ai/core-concepts/memory-operations/add
- 論文（arXiv:2504.19413）：抽取輸入 = 對話摘要 + 最近 m=10 則 + 新訊息；更新階段對每個候選事實取 top-s=10 相似記憶，由 LLM 以 tool call 選 ADD／UPDATE／DELETE／NOOP。https://arxiv.org/html/2504.19413
- 自述數字：相對 full-context「91% lower p95 latency」、「saves more than 90% token cost」（摘要）；LOCOMO 上 LLM-as-a-Judge 相對 OpenAI 提升 26%。https://arxiv.org/abs/2504.19413 。這些是作者在其 benchmark 的自報數，與寫程式場景不同。
- OpenMemory：兩個嘗試的官方 URL 皆 404，**未查證**。

### 3.11 Letta
- Memory blocks：label／description／value／limit（字元），「always visible - no retrieval needed」，agent 預設可自編輯，可設 read_only，可多 agent 共享，寫入為整塊取代、並發時最後寫者勝。https://docs.letta.com/guides/agents/memory-blocks
- MemGPT：以作業系統記憶階層類比做 virtual context management。https://arxiv.org/abs/2310.08560
- sleep-time compute（2025-04 blog）：每個啟用的 agent 是兩個 agent，主 agent 無編輯 core memory 的工具，由 sleep-time agent 在背景整理；可用較大較慢的模型；頻率越高 token 越多。https://www.letta.com/blog/sleep-time-compute
- 目前文件改稱 Dreaming：背景 subagent 檢視近期對話、整併、更新記憶；觸發為「完成 N 個 agent 步驟」或「context 被 compact」；可選「更新前由 agent 在第二個背景對話審查」（較耗 token、不要求使用者核准）；記憶放在 git 支援的 MemFS。https://docs.letta.com/guides/agents/architectures/sleeptime 。版本相關，名稱與機制近期有變。

### 3.12 Zep／Graphiti
- 時間知識圖；事實有有效期間，「old facts are invalidated — not deleted」；增量攝入無需批次重算；混合檢索（embedding + BM25 + 圖走訪），不依賴 LLM 摘要；後端需 Neo4j／FalkorDB／Neptune，預設用 OpenAI。https://github.com/getzep/graphiti
- 論文：DMR 94.8% vs MemGPT 93.4%；LongMemEval 準確度最多 +18.5%、延遲 -90%（對未指明基線）。https://arxiv.org/abs/2501.13956
- 對本專案：理念（失效不刪、有效期間）可學，實作（圖資料庫）太重。

### 3.13 LangMem
- 語意（collection／profile）、情節、程序三類記憶；寫入分「熱路徑」（即時、增加延遲）與「背景」（對話後或閒置後，偏重 recall）；`create_prompt_optimizer` 依軌跡與回饋改寫 prompt（程序記憶）；核心函式可不用 DB。https://langchain-ai.github.io/langmem/concepts/conceptual_guide/

### 3.14 社群 Claude Code 工具
- claude-mem：5 個生命週期 hook、SQLite（FTS5）+ Chroma；三層漸進揭露（索引→時間線→細節），自述每筆搜尋結果約 50–100 token、完整 observation 約 500–1,000 token、「~10x token savings」（專案自述，未獨立驗證）；`<private>` 標籤排除內容；需 Node 20+，另有 worker 服務。https://github.com/thedotmack/claude-mem
- Basic Memory：AGPL-3.0；markdown 檔 + 本機 SQLite 索引、「No servers required」；observations／relations 形成圖；MCP 工具含 `build_context`；README 未描述自動抽取，由 LLM 經 MCP 寫入或使用者直接編輯。https://github.com/basicmachines-co/basic-memory
- 官方 memory MCP server：JSONL 知識圖；寫入用 `.lock` 檔，60 秒拿不到鎖就報錯而非覆蓋；範例 prompt 要求每次對話開頭檢索記憶。https://github.com/modelcontextprotocol/servers/tree/main/src/memory

## 4. 對照 project-memory

標記：【輕量可做】【值得但較重】【太重，不建議】。

### 4.1 Token 最佳化
project-memory 已做到或更好：
- 常駐只有索引（60 條上限，低於官方 200 行／25KB），詳情按需讀，與官方設計與 Windsurf Model Decision 同型。
- 抽取只送「新增的 transcript」並截斷 tool 輸入／輸出、遮蔽祕密，用 Sonnet low；增量處理比 Mem0 的「摘要 + 最近 10 則」更省（Mem0 依賴摘要需另行維護）。
- 閒置／N 則／`/clear` 觸發，與 Codex、Letta 同級。

可借鏡：
- 【輕量可做】額度低時略過這一輪（Codex 的 `min_rate_limit_remaining_percent`）：若 hook 能讀到用量資訊就加；讀不到則放棄。理由：避免背景抽取吃掉互動額度。
- 【輕量可做】抽取「兩階段」只在必要時做：平常只做 per-session 抽取，另設低頻（如累積 N 條新增）的整併輪，仿 Codex extract／consolidation 與 Letta Dreaming；整併輪只讀 60 條索引。理由：不增加常態成本。
- 【輕量可做】MEMORY.md 逼近上限時沿用官方「接近 → 提醒、超過 → 錯誤」的做法，由 mod 自行在整併時優先合併／失效低價值條目。理由：已有 60 行上限，只差溢出策略。
- 【輕量可做】讓抽取 prompt 明確「略過可從程式碼推得的內容與 CLAUDE.md 已有內容」，官方 auto memory 即如此。理由：減少記憶量就是減少未來注入量。
- 【值得但較重】依相關性只放「與當前目錄／檔案相關」的記憶（類似 Cursor／Windsurf glob 規則、Claude Code path-scoped rules）。理由：需要 hook 在載入時過濾，與「由內建 memory 載入、mod 不注入」的 ADR 0016 決定衝突。
- 【值得但較重】Aider 式 token 預算＋排名注入。理由：需要排序訊號（使用頻率），而本專案不注入。
- 【太重，不建議】向量檢索（Mem0／claude-mem 的 Chroma）、圖檢索（Zep）。理由：60 條上限內整份清單餵模型比 top-s 檢索簡單，且違反「無向量庫」。

### 4.2 儲存
project-memory 已做到或更好：
- 一條一檔 markdown + frontmatter，與官方 auto memory 同格式；人可直接改。
- 以不同 session 計數、失效而非刪除（`invalidated`／`superseded_by`、90 天寬限），理念同 Graphiti 的「invalidated — not deleted」，但不需圖庫；Copilot／Codex／官方 auto memory 都沒有 supersede 鏈。
- 相關檔案路徑存在性檢查，是 Copilot citation 驗證的簡化版。

可借鏡：
- 【輕量可做】把「相關檔案」升級成 Copilot 式 citation：記下檔案＋一小段（函式名或關鍵字串），讀取／整併時用 grep 檢查該字串仍在。理由：不需 LLM，一次 grep。
- 【輕量可做】記錄 `reason`（Copilot 結構的 subject／fact／citations／reason）。project-memory 已有 how／why，等同。
- 【輕量可做】使用者原話作為 evidence（Copilot 對 user 偏好的做法）；現行「最近 3 筆 evidence」已接近。
- 【輕量可做】Gemini 的「同一事實不要跨層重複」：你們已在規則升級到 CLAUDE.md 後刪除記憶檔，達成。
- 【值得但較重】並發寫入保護：memory MCP server 用 `.lock` 檔避免覆蓋；project-memory 若多個 session 同時抽取，需確認是否已有原子寫入或鎖（本報告未檢視程式，待查）。
- 【值得但較重】私人／共享分流（Gemini 的三層、Copilot 的 user／repo）：目前記憶在本機 memory 夾、不跨機器；要團隊共享須走升級到 CLAUDE.md／skills 的路，現況已合理。
- 【太重，不建議】知識圖的 entities／relations、bi-temporal 欄位。理由：維護成本高，個人用量下無實證需求。

### 4.3 開發者體驗
project-memory 已做到或更好：
- 升級到 CLAUDE.md 前先問使用者；多數產品（Codex、Windsurf）只是建議「必要規則寫進 AGENTS.md」，沒有主動提議流程。
- 純 markdown 可檢視；`/memory` 可瀏覽；與官方「Saved N memories」同一路徑。
- 程序性記憶轉成 `.claude/skills`，對應 LangMem 的 procedural memory，且是 Claude Code 原生形式。

可借鏡：
- 【輕量可做】Cursor 後來加入的「背景生成的記憶需使用者核准」：做成低干擾版本——新增後用 toast 或下次 session 開頭列一行「本次新增／失效 N 條」，不阻擋。理由：信任是自動記憶存活的關鍵；不需新 UI。
- 【輕量可做】Codex `/memories` 的「這個 chat 不要被拿去產生記憶」：加一個 per-session 開關（例如 `/project-memory pause`）。理由：敏感工作時的 opt-out，成本低。
- 【輕量可做】Gemini `/memory show`：提供一個指令列出「目前會被載入的 pm- 記憶及各自的狀態（有效／待失效／檔案遺失）」。理由：純讀檔。
- 【輕量可做】claude-mem 的 `<private>` 標籤概念：以特定標記讓某段對話不進抽取。理由：祕密遮蔽之外再加一道人為控制。
- 【值得但較重】儀表板（Mem0 dashboard、claude-mem UI）。理由：需要 pane 設計，先以指令取代。
- 【太重，不建議】託管式、跨機器同步（Copilot、Basic Memory cloud）。理由：違反無伺服器。

### 4.4 其他值得研究的功能
- 【輕量可做】讀取時驗證＋刷新（Copilot）：當一條記憶被重新確認（再次出現於 session）時刷新其「最後驗證日」；現行「不同 session 計數」已涵蓋一部分，可明確分離「出現次數」與「最後驗證時間」兩個欄位，過期以後者計。
- 【輕量可做】矛盾處理走 supersede：Mem0 的 DELETE、Copilot 的「存修正版」，project-memory 的 invalidate + `superseded_by` 已覆蓋，且保留歷史。
- 【值得但較重】對抗式測試：Copilot 用假事實＋壞 citation 驗證 agent 會糾正；本專案可在 `claude plugin test` 加一組「注入過時記憶，確認被標失效」的案例（需抽取呼叫，成本是測試時的 token）。
- 【值得但較重】提示最佳化／程序記憶演進（LangMem `create_prompt_optimizer`）：skills 目前只新增，可考慮「依後續修正更新 skill」；先觀察實際案例再做。
- 【太重，不建議】MemGPT 式自編輯的分層記憶、Letta 持續運行的 sleep-time agent：需要常駐 agent 與較大模型，成本與風險高；project-memory 的觸發式背景抽取已取得大部分收益。

## 5. 未查證／待追的問題

- ChatGPT memory（saved memories 與 chat history 參照）：OpenAI 官方頁回 403，本報告未納入。
- OpenMemory（mem0 的本機 MCP 版）：嘗試的 README 路徑皆 404，需要重新找官方文件位置。
- Cursor Memories 的移除時間點與核准機制細節：只有搜尋摘要與論壇回報，需要直接讀官方 changelog 的對應版本頁。
- Gemini CLI：舊 `save_memory` 工具與目前「直接編輯 markdown」的關係；私人專案記憶夾的實際路徑。
- Claude Code auto memory 用哪個模型、在何時寫入：文件只說 Claude 在工作中自己決定，未載明是否為背景抽取。
- Codex memories 的預設抽取／整併模型、閒置時長、注入內容：官方頁未載明。
- Mem0 的「7k／26k token」數字與 LOCOMO 場景綁定，不能直接外推到寫程式；且我讀到的段落對 Zep 與 full-context 的比較混在一起，引用前應回原文核對表格。
- claude-mem：hook 實際耗費的模型成本、是否預設呼叫外部模型，README 只說可設定；未讀原始碼。
- project-memory 自身：多 session 並發寫入的原子性、抽取時是否可取得剩餘額度資訊（影響 4.1 的第一項），需看 hooks 原始碼確認，本次未讀。
- 所有「自述」的效益數字（Copilot 83% → 90%、Mem0 90% token 節省、claude-mem 10x）皆來自廠商或作者，未經獨立重現。
