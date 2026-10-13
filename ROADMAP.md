# Roadmap

cc-mod-trimtab 還沒做的事：待辦、待實測、暫緩與不做的提案、已知問題，以及實測與查證的結果。功能與用法見 [docs/mods](docs/mods/)，已做的決定與理由見 [ADR](docs/adr/README.md)，開發與發佈流程見[開發指南](docs/development.md)。

## 已知問題

- 安裝時 CLI 提示「userConfig options not yet set」：沒設定的值用預設，不影響使用（寫在[安裝與更新](docs/install.zh-TW.md)）。

## 待實測

1. 2.1.296 自己產生的型別檔與 2.1.288 版是否一致（見「查證結果」2；目前只拿得到 2.1.288 版）。
2. 第一次寫 `.claude/cc-mod-trimtab.local.json` 時加進 `.git/info/exclude`：只有自動測試。
3. `subagent-dispatch` 帳本跨 `/clear` 的 session 命名與 agent 步數歸屬：只有自動測試。
4. `subagent-dispatch` 熱圖用滑鼠點格子選日：只有自動測試；實際終端機只用 `j`／`k`／`p` 驗過（見「查證結果」21）。
5. `subagent-dispatch` 回填後 `turn.step` 每次寫入的實際耗時：只在 engine 外量過（見「查證結果」21）。
## 待辦

目前沒有。

## mod 規劃

提案依「實際發生過的問題 × 效益 ÷ 實作量」篩選；已做的設計見 [ADR](docs/adr/README.md)。

### 暫緩

| 提案 | 原因 | 重新評估的條件 |
| ---- | ---- | -------------- |
| bash-edit-snapshot（`tool-guard` 在 Bash 寫檔指令前用 `git stash create` 存快照，`/undo-bash [n]` 還原；`/rewind` 只追蹤 Edit／Write） | 2026-10-11 檢視約一個月的使用紀錄：Bash 寫檔（`sed -i`、`python3`、重導向、heredoc）很常見，但沒有一次造成損失，改錯的都在寫入前被檢查擋下或用 git 輕易救回；目標多是已 commit 的檔案，快照多保護的範圍很小 | Bash 寫檔讓未 commit 的內容遺失或要手動重建、且 `/rewind` 救不回；使用者因 Bash 改檔要求還原；或對未 commit 的檔案做大範圍取代出錯。做的時候寫檔偵測也複製到 `self-check` 的 `noteCall` |
| classifier-retry（auto mode 分類器沒給判定時重試） | 實際發生的次數少；不確定同一個工具呼叫裡能否再呼叫一次 `next` | 頻率上升，或確認 API 支援重試 |
| open-items 的 Haiku 抽取 | 每輪都要花 token；先觀察 track 工具與選項解析的漏抓率 | `/open-items stats` 的漏抓率明顯偏高（2026-10-13 起只計你回覆超過 14 字的問句，短答與非本人訊息不計；之前 65% 的漏抓多半是「要 commit 嗎？」這類一句話就答完的確認，那些計數已作廢） |
| project-memory 把有相關檔案的規則改寫進 `.claude/rules/<名稱>.md`（frontmatter `paths` 填相關檔案，只在碰到這些檔案時載入；沒有相關檔案的規則與流程類規則照舊寫進 CLAUDE.md，先問使用者不變） | 2026-10-12 決定先不做：寫進 repo 的規則還很少，CLAUDE.md 佔的 context 不成問題；相關檔案記不完整時，規則該出現卻不載入。依據見「查證結果」第 13 條 | CLAUDE.md 因升級進來的規則明顯變長（例如超過 200 行），或升級的規則多半只跟少數檔案有關。做的時候：改 `promote.ts` 的交代與 `mark_in_project` 的說明，由模型判斷規則屬於哪一種，新增 ADR 取代 0016 的這一點 |
| project-memory 的 `<private>` 標記（訊息中標起來的段落不送去整理；claude-mem 的做法） | 2026-10-12 決定略過：`/project-memory off` 已能在這個 session 停止自動整理，送出前也已用 `secret-scrub` 的規則遮蔽金鑰 | 開著自動整理時需要只排除某一段（例如貼上客戶資料），而 `off` 再 `on` 不夠用；或發現敏感內容被寫進記憶 |
| project-memory 只送相關的記憶給模型（Mem0 只送相似的前 10 筆） | 要 embedding 或相似度比對；記憶少時整份清單送得進去，`MEMORY.md` 也限 60 條 | 記憶（含失效前）超過約 150 條、或整理輸出常被截斷（debug log 的「丟棄 N 行」中出現 JSON 錯誤） |
| project-memory 的離線評估集（照 LongMemEval 分類標 30–50 段對話的預期整理結果，量抽取與更新的錯誤率） | 成本較高，要先累積一段時間的真實整理結果才有素材 | 用過一個月以上，或懷疑整理品質（記錯、漏記、重複）時 |
| `tool-guard` 的 cmd-rewrite（Bash 執行前依 repo 設定的 `{ "match", "replace" }` 改寫指令，例如 `npx vitest run` 換成 `npm run test:brief --`；改寫時提示一次，進版控的規則第一次生效前要使用者核准） | 2026-10-11 查一個多月的 prompt 與 transcript：沒有一次因為 Claude 沒照 CLAUDE.md 的指令規則而糾正；唯一一條「該用 X 不要用 Y」的規則才加 5 天，之後還沒有 session 可看 | 有這類規則的 repo 累積 5 個以上 session 後，仍有 2 次以上被糾正或照舊跑錯的指令。先做最窄的版本：設定檔寫死的字面 match／replace |
| `tool-guard` 的學來的守門（`/tool-guard suggest` 把 memory 中出現 3 次以上的規則交給模型草擬工具呼叫前的比對式，核准才生效；上游 `guards.ts`） | 同一次查證：沒有同一種工具呼叫錯誤在不同 session 被糾正 3 次以上；反覆出現的糾正是寫作風格與流程，比對式擋不了；規則提升已由 `project-memory` 的「3 個 session 證實」處理 | 同一個工具呼叫錯誤在不同 session 被糾正 3 次以上，且寫得成字面比對式。先做使用者自己在設定檔寫 block／warn 比對式，不用模型草擬 |
| `subagent-dispatch` 的分派提醒（subagent 跑在 Opus 但 description 看不出理由、或同一個 session fork 偏多時跳 toast，只提醒不擋；先在 `stats` 標出符合的派出，看誤判再開 toast，開 toast 時給它自己的開關） | 2026-10-12 查帳本（新舊檔名共 23 次派出）：Sonnet 11、Haiku 9、fork 3，沒有一次跑在 Opus，一個 session 最多 fork 2 次。帳本已記模型、指定模型、fork 與 description，之後可直接從帳本算，不必先加欄位 | 帳本出現 3 次以上 description 沒寫理由的 Opus 派出（非 fork），或有 session fork 3 次以上。先做最窄的版本：`stats` 摘要多一行計數並在列表標出，不跳 toast |
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
| open-items 載入時自動驗證是否仍成立（以 shell 判斷式檢查） | 項目是文字，沒有可自動檢查的條件；改用顯示年齡讓使用者判斷 |

## 查證結果

1. `userConfig` 不能依專案設定：`pluginConfigs` 只從使用者或 managed 設定讀取（[mods reference](https://code.claude.com/docs/en/plugins/mods/reference)）；2026-10-09 在 2.1.295 實測，repo 的 `.claude/settings.json`、`.claude/settings.local.json` 不會生效（用 `--plugin-dir` 加 `claude -p`，正式安裝的互動模式沒測）。→ repo 層由 mod 自己讀檔。
2. usage：`$.model.fork` 與 `$.model.complete` 都回傳 `{ isAnswered, text, usage }`，`usage` 有 input、output、cache read、cache write 四種 token 數，沒有金額；`classify` 只回傳標籤。依本機 2.1.288 產生的型別檔（2026-10-11 確認；GitHub 上的 `mods/types/claude-code.d.ts` 是 2.1.277 寫的，`complete` 還只回傳文字）。repo 的 `session-keeper`、`project-memory` 已在 2.1.296 上用 `isAnswered`／`text`。
3. `cc-mod-trimtab` 重名：網路搜尋沒找到同名的 Claude Code、MCP 或 agent 專案；未做 GitHub 全站搜尋。
4. 2026-10-06 已在 CLI 實測 output-trimmer 的結果改寫、agent-dispatch（原 agent-watch）的中斷偵測、tool-guard（原 shell-guard）的攔截與放行、secret-scrub 的遮蔽、open-items 的自動延後與 compact 行為。
5. `$.store` 是 plugin 自己的一個 JSON 檔，放在使用者的 Claude Code 設定目錄，跨 session 與熱重載保留（2.1.296 型別檔）。所有 session 共用同一份，所以 session 層的值（`set --session`、`on`）以 sessionId 為 key 存，一週沒寫入的 session 在其他 session 寫入時清掉（0.1.1 起）。2026-10-11 實測：0.1.0 時 A 開 `keep_warm` 後 B `set`，A 的值被蓋回預設；0.1.1 後兩個 session 各自保留。
6. 從 GitHub 安裝的 plugin 會複製到 `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`，plugin 資料夾外的檔案不會複製（[plugins/loading](https://code.claude.com/docs/en/plugins/loading)）；第三方 marketplace 預設不自動更新。2026-10-11 在隔離的 `CLAUDE_CONFIG_DIR` 從 GitHub 安裝 8 個 mod，`enabledPlugins` 順序照安裝順序，快取副本的測試通過。
7. 2026-10-11 實測：`/reload-plugins` 後 `/<mod> status` 立刻讀到 `~/.claude/cc-mod-trimtab.json`（symlink 也讀得到）的 `"*".language`。
8. 2026-10-11 實測 `--resume`：sessionId 不變，`session.start` 重讀設定，臨時開啟的灰字提示列與值都接得上（open-items o3）。
9. 2026-10-11 實測 `subagent-dispatch` 帳本：背景 agent 的每一步都記到（例：5 步、33,692 token）；真實的 fork 記成 fork；同一模型的 id 寫法一致，不會拆成兩列；終端機太窄時 pane 改放在輸入框上方。
10. 2026-10-12 改名 `agent-dispatch` → `subagent-dispatch`：`$.store` 的檔名是 `<mod>_<marketplace>-<雜湊>.json`，雜湊依 plugin 算，所以新名稱用新檔案，舊帳本不會跟著搬，要手動併入（session key 不重疊）；舊 session 在 `/reload-plugins` 前仍寫舊檔。在隔離的 `CLAUDE_CONFIG_DIR` 驗證過新名稱可安裝、舊名稱找不到。
11. 用 `--plugin-dir` 開的 session 讀 `pluginConfigs` 的 key 是 `<mod>` 或 `<mod>@inline`，讀不到 `<mod>@cc-mod-trimtab` 的值（2026-10-11），所以測試 session 測不到用 `/config` 常開的行為。
12. `$.session.usage()` 回傳 `rateLimits: { kind, percentUsed, resetsAt? }[]`，`kind` 有 `five_hour`、`seven_day` 與 gateway 的 `spend_limit`；不是訂閱制或還沒讀到數值時是空陣列，呼叫不花 token（依本機型別檔，2026-10-12）。`project-memory` 的 `max_rate_used` 依此判斷；實際訂閱帳號上的數值還沒在執行中的 session 確認。
13. 依路徑載入的規則：`.claude/rules/`（含子資料夾）的 `.md` 加 frontmatter `paths`（YAML 清單或逗號分隔，glob），只在 Read／Write／Edit 或 `cat` 碰到符合的檔案時載入；沒有 `paths` 的規則啟動就載入，和 `.claude/CLAUDE.md` 同優先（[memory 文件](https://code.claude.com/docs/en/memory)）。2026-10-12 在 2.1.296 用 `claude -p` 實測：規則限 `src/**/*.ts`，不讀檔或讀 `docs/b.md` 時答不出規則內容，讀 `src/a.ts` 後答得出。→ 見「暫緩」的「規則改寫進 `.claude/rules`」。
14. 2026-10-13 用 prototype 在 2.1.296 實測 pane 的焦點：只有 Tab 與 ↑↓ 會移動焦點；←→ pane 不攔，會切到別的 session；用 `$.ui.focus` 在關掉一列後把焦點搬到下一列，焦點會落在剛按的動作按鈕上或跳過一列；整行做成按鈕時截斷的開頭會重複出現。→ ADR 0021。
15. Button 的 `hotkey` 只在它所在的區塊（band 或自己的 pane）有焦點時生效，輸入框打字不觸發；同一區塊兩顆同鍵時後畫的贏（依 2.1.296 型別檔 `ButtonProps.hotkey`，2026-10-13）。所以 subagent-dispatch band 的 `d`（略過）與 open-items pane 的 `d`（完成）不衝突。
16. 2026-10-13 在 2.1.296 的 subagent-dispatch stats pane 實際看到：`Button` 裡的 `<Text wrap="truncate-end">` 在中英混合的文字上不會截斷，而是折到下一行，連帶把同一行右邊的次數擠下去；名稱照 pane 寬度先截好之後，次數仍會被擠下，名稱要再多留兩格，次數的 `Box` 固定寬度、`flexShrink={0}` 才保持一行。→ DESIGN.md「控制項」。
17. 2026-10-13 確認 GitHub 的 private vulnerability reporting 已開啟，`SECURITY.md` 指的回報管道可用。
18. 2026-10-13 在 Claude Code 裡看過 open-items 面板改版（焦點列動作、分組與單邊線 `│`、比例長條計數、每項全文、按鍵說明）：顯示正常。
19. 2026-10-13 實際看到用模型的功能在一個 session 第一次觸發時的 toast：顯示正常。
20. 2026-10-13 在 2.1.296 用臨時 mod 加 `claude -p --plugin-dir` 實測 `$.session.usage().cost`（訂閱帳號，`rateLimits` 有 `five_hour`、`seven_day`）：`cost.usd` 有值；`turn.step` 的 `next` 回來時已加上這一步；subagent 的步數也算在內；session 結束時的總額等於各步差額的加總。mod 自己的 `$.model.complete` 不算進去（呼叫前後與 1.5 秒後都沒變）。兩個 agent 並行時，各步「呼叫前後」的差額會重疊、加總比總額多；改用「這次讀到的值減上次讀到的值」，總額對得上，同時結束的步數才可能記錯名下。
21. 2026-10-14 在 2.1.296 用 `--plugin-dir` 載入 subagent-dispatch 0.5.0（自己的 `subagent-dispatch_inline-*` store），在 pty 裡實際看 stats pane：session 開始後不到 8 秒就在背景從本機 transcript 補上 221 個 session（最早 9/15，兩個超過 4 MiB 的檔案經 `cat` 讀到，略過 0 個），跳出 toast；store 變成 288 KB（221 本帳本、27 行每日摘要）。熱圖在 dock（約 45 欄，20 週）與 100 欄 inline（47 週）都對齊：每格一顆按鈕佔 1 欄、格間 1 欄，月份標在對的週，今天在最後一欄。`j`、`j`、`p` 依序選到今天、前一天、回到 30 天，卡片數字跟著換。發現兩件事並已修正：dock 時 `j`／`k` 把日期範圍擠掉，改成放不下時移到下一行；清單第一列加 `autoFocus` 會讓 inline 的 pane 捲到那一列、把熱圖捲出畫面，所以不加。另外在 engine 外量了 288 KB store 一次 parse 加寫回約 2.4 ms，當作 `turn.step` 寫入耗時的近似值。
22. 2026-10-14 subagent-dispatch 0.5.0 的 stats pane 在終端機橫向縮放時重畫很慢。量測：每次重畫都對每個 key 各讀一次 `$.store`（221 個 session 時 248 次），在測試環境佔一次重畫約 60 ms 裡的 40 ms，算熱圖與報表只要約 3 ms。在 2.1.296 的 pty 裡實測，縮放後畫面穩定要 213–254 ms；改成 30 秒內的重畫沿用上次讀到的 store（自己寫入或開 pane 時重讀）後是 51–62 ms。剩下的時間主要是 371 顆格子按鈕的版面。
