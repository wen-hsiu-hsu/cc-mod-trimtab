# cc-mod-trimtab

[English](README.md) | 繁體中文

Claude Code 的 function-hook plugin（mod）：減少出錯、節省 token、提高容錯。repo 根目錄的 `.claude-plugin/marketplace.json` 把這個 repo 變成 marketplace `cc-mod-trimtab`，每個 mod 可以單獨安裝。

- **需求**：Claude Code 2.1.296 以上（實測版本）。mod API 仍是 early access，Claude Code 更新後可能需要跟著改。只支援 CLI 與 desktop，雲端 session 無法載入（見「安裝」）。
- 變更紀錄見 [CHANGELOG.md](CHANGELOG.md)，安全性問題的回報方式與各 mod 的保護範圍見 [SECURITY.md](SECURITY.md)，決定與 mod 規劃見 [ROADMAP.md](ROADMAP.md)。

## Mods

| Mod | 用途 | 用模型 | CLI | 雲端（見下） |
| --- | ---- | ------ | --- | ---- |
| `secret-scrub` | 送出 prompt 前遮蔽 `token=`、`Bearer`、`sk-…`、`ghp_…`、JWT、私鑰、`*_TOKEN=` 等密鑰；prompt 含 `#noscrub`（`bypass_marker` 可改）時原樣送出；可加自訂規則（`custom_rules`）與例外（`allow`）；輸入框歷史（`history.jsonl`）也改寫成遮蔽後的內容，`/secret-scrub history` 清理所有 session 的舊紀錄 | 否 | 是 | 否 |
| `tool-guard` | 攔下會丟失工作的指令，先量出影響範圍：`reset --hard`、`checkout --`、`restore`（會丟掉的未 commit 檔案）、`clean -f`（會刪的未追蹤檔案）、force push（遠端會被蓋掉的 commit）、`stash drop/clear`、`--no-verify`、`rm -r/-f`（會刪的檔案數與大小，`$TMPDIR`、`/tmp`、`/var/folders` 與 `rm_skip_paths` 底下的不算）、資料庫 migration（待執行的項目）。不會造成損失的直接放行（工作區乾淨、force push 不丟 commit 且不是 main/master、rm 沒有符合的檔案、沒有待執行的 migration）；要確認時開面板列出影響，按 `1` 執行、`2` 取消；終端機太窄放不下面板時改用內建的詢問對話框（同樣列出影響，選「執行」或「取消」，也可以打字回覆給 Claude）。`-p` 等非互動模式無人可問，直接擋下並把影響寫進原因，由使用者輸入 `/tool-guard allow` 放行一次（10 分鐘內）。另外可檢查 commit 標題格式（`commit_format`，預設關；`commit_pattern` 自訂格式），並移除 Claude 署名（`strip_attribution`，預設開） | 否 | 是 | 否 |
| `output-trimmer` | Bash 輸出超過 150 行或 15k 字元（`max_lines`、`max_chars`）時，只給模型開頭、結尾與錯誤行，完整輸出存到 `$TMPDIR/claude-output-trimmer/`；讀檔類指令不處理，指令加 `# notrim` 取得完整輸出 | 否 | 是 | 否 |
| `agent-dispatch` | 輸入框上方顯示執行中的背景 agent 與 Esc 會中斷的提醒；被中斷時按 `[重派]` 或 `/agent-dispatch redispatch` 把重派指示放進輸入框；`/agent-dispatch stats [天數]` 依本機帳本列出主 session、subagent 與各模型的 token 用量 | 否 | 是（手機只有狀態列） | 否 |
| `open-items` | 追蹤待決定、未解決、延後的項目：Claude 用 `track` 工具登記，與未完成項目相同或互相包含的文字不重複新增；你只選部分選項時（「A＋B，C 先寫成觀察項」）沒選的自動列為延後，toast 顯示延後了哪些，下一則 prompt 前可按 `[復原延後]`（`u`）或 `/open-items undo` 取消（只解析回答結尾、或後面接問句的選項清單）。輸入框上方顯示計數，按 `[開啟]`（`o`）或 `/open-items` 開面板（完成／不做／引用／複製成 markdown，列出建立時間與 branch，超過 7 天變淡）；在面板關掉的項目會隨下一則 prompt 告知 Claude。決策帶理由完成、或標為不做的項目另存一份不過期的紀錄，`/open-items log [關鍵字]` 或 `track` 的 `history` 可查。依 repo 跨 session 保存（同 repo 的 worktree 共用），每次變動就合併寫入，並行的 session 不會互相覆寫；載入後的第一則 prompt 會把清單附給 Claude，toast 註明幾個在其他 branch、幾個超過 7 天。`/open-items copy` 複製清單，`/open-items stats` 看漏抓率（回答以問句結尾卻沒呼叫 `track` 的比例，逐筆記在 debug log） | 否 | 是（手機只有狀態列） | 否 |
| `session-keeper` | desktop 的輸入框上方常駐一行 prompt cache 狀態（desktop 不執行 status line）：`cache  warm 1h [16:44] 23m left  ·  kept 1/3  ·  hit 91%  ·  miss 2 +150.2k (ttl? +1)`；快過期變黃、過期變紅並顯示下次要重寫的量（`cold, next +184.3k`）；失效原因是推測的。保持快取：TTL 為 1h、context 超過 30k 時，最後一次用到快取後閒置 55 分鐘送一次只回覆 OK 的 fork 讀快取，每段閒置最多 3 次，CLI 也會送。交接：context 超過門檻（`CLAUDE_CTX_GUARD_TOKENS`，預設 150k）時，Haiku 判斷 prompt 是無關的新任務、或快取已過期，就在輸入框上方提議 `[交接並開新 session]`（`h`）／`[仍在這裡做]`（`k`）；交接時摘要寫進 `.claude/progress.md`，`/clear` 後放進輸入框當草稿；`/session-keeper handoff [目標]` 隨時交接。新 session 的第一則 prompt 附上 24 小時內的進度。見下方「session-keeper」 | 保持快取與交接時（fork 主對話）、判斷新任務時（Haiku）；預設關，`/session-keeper on` 開啟 | cache 狀態只在 desktop 顯示；其餘都有 | 否 |
| `self-check` | 給 Claude 的防呆提醒，不擋使用者：同一個工具連續兩次因同樣原因失敗（錯誤文字去掉路徑與數字後相同）時，在第二次的結果後面請 Claude 先找出原因、不要原樣重試；這一輪改過程式檔（Edit／Write，不含 `.md` `.txt` 等文件、不含子代理改的）、之後沒跑測試、建置或檢查，回覆卻說完成時，擋下這次停止一次請 Claude 驗證（回覆已說明沒驗證的不擋）。兩項各自可關閉（`retry_nudge`、`done_check`，見「設定」）。出錯時跳過，不影響工具呼叫與停止 | 否 | 是 | 否 |
| `project-memory` | 在背景用 Sonnet（effort low）把上次之後新增的對話整理成記憶、規則與流程：每 30 則訊息（context 30k 以上）、閒置 10 分鐘（可調）或 `/clear` 時（有 5 則以上新訊息）。記憶與規則寫進內建 memory（每條一個 `pm-*.md`，`MEMORY.md` 只改連到 `pm-` 檔的行、最多 60 條），被推翻的標記失效、90 天後刪檔，記下的相關檔案不見時交給模型判斷；同一個請求更新 repo 的 `.claude/progress.md`（加進 `.git/info/exclude`）。有變動時 toast，變動清單附在下一則 prompt。被 3 個 session 證實的規則先問你再寫進 CLAUDE.md，流程做成專案 skill（不 commit）。見下方「project-memory」 | 整理時（Sonnet）；自動整理預設關，`/project-memory on` 開啟 | 是 | 否 |

## 安裝

### CLI 與 desktop

```bash
claude plugin marketplace add wen-hsiu-hsu/cc-mod-trimtab
```

要固定在某個版本時在後面加 tag，例如 `wen-hsiu-hsu/cc-mod-trimtab#v0.1.0`。

然後在 Claude Code 中安裝要用的 mod（user scope）。`secret-scrub` 要第一個安裝，原因見「開發 › 多個 mod 共存」：

```
/plugin install secret-scrub@cc-mod-trimtab
/plugin install session-keeper@cc-mod-trimtab
/plugin install tool-guard@cc-mod-trimtab
/plugin install output-trimmer@cc-mod-trimtab
/plugin install agent-dispatch@cc-mod-trimtab
/plugin install open-items@cc-mod-trimtab
/plugin install self-check@cc-mod-trimtab
/plugin install project-memory@cc-mod-trimtab
```

也可以在 shell 用 `claude plugin install <mod>@cc-mod-trimtab` 安裝。安裝後當下的 session 就會載入 mod，不需要 `/reload-plugins`。

### 更新

每個 mod 在 `plugin.json` 固定了 `version`，所以只有版本號改變時才會更新，中間的 commit 不會。第三方 marketplace 預設不自動更新，可以選一種方式更新：

- **自動更新**：在 `/plugin` 的 Marketplaces 分頁選 `cc-mod-trimtab`，再選 Enable auto-update。
- **手動更新一個 mod**：`claude plugin update <mod>@cc-mod-trimtab`。
- **手動一次更新全部**：在 Marketplaces 分頁選 Update marketplace。

更新後，執行中的 session 要 `/reload-plugins` 才會用新版本；新開的 session 會直接載入。

### 雲端（claude.ai/code）：目前無法載入

官方文件（[plugins/loading](https://code.claude.com/docs/en/plugins/loading#plugins-shared-through-a-repository)）寫明：雲端 session 不會加入 repo 在 `extraKnownMarketplaces` 列出的 marketplace，因為那需要通過 workspace trust 對話框，而雲端 session 不會顯示它。放在專案 `.claude/skills/` 的 plugin 也一樣要先通過 trust。所以在專案的 `.claude/settings.json` 宣告這個 marketplace 不會生效，這些 mod 目前只在 CLI 有用。

## 設定

每個 mod 的設定由高到低讀這幾層，取第一個有值的：

1. **session**：`/<mod> set <key> <value>`，只在這個 session 有效。
2. **local**：`.claude/cc-mod-trimtab.local.json`，不 commit（第一次寫入時加進 `.git/info/exclude`）。fork 別人專案的 repo 用這個檔。
3. **repo**：`.claude/cc-mod-trimtab.json`，commit 進專案、團隊共用，但只能讓保護更嚴、花費更省（見下表）。
4. **使用者**：單一值在 `/config`（存在 `~/.claude/settings.json` 的 `pluginConfigs`）；清單類（`custom_rules`、`allow`、`rm_skip_paths`）放在 `~/.claude/cc-mod-trimtab.json`，因為 `/config` 存不了清單。
5. **預設值**。

三個檔案的格式相同：`{ "<mod>": { "<key>": value } }`。

### 語言

mod 顯示的文字預設是英文（`en`），可以改成繁體中文（`zh-TW`）。在 `~/.claude/cc-mod-trimtab.json`（只對一個專案時用 `.claude/cc-mod-trimtab.local.json`）的 `"*"` 設定一次，所有 mod 都會套用：

```json
{ "*": { "language": "zh-TW" } }
```

- 同一個檔案裡，mod 自己的區段優先於 `"*"`；`/<mod> set language zh-TW` 只改一個 mod。commit 進 repo 的檔案不能設定 `language`。
- 模型替你寫的內容（`project-memory` 的記憶與 `.claude/progress.md`、`session-keeper` 的交接摘要）也照這個設定；送給模型的指示一律是英文。
- `/config` 看不到 `language`，`/config` 裡的標題也只有英文。

```
/<mod> status                                  # 每個設定目前的值、來自哪一層、repo 能怎麼改，以及被忽略的值
/<mod> set <key> <value> [--session|--local|--repo]   # 預設 --session；清單寫 JSON 陣列，否則整段算一項
/<mod> unset <key> [--session|--local|--repo]
/<mod> on [功能] [時長]                         # 用模型的功能臨時開啟，預設 2h，最多 24h（2h、90m、1h30m）
/<mod> off [功能]                               # 在這個 session 關閉
```

用模型的功能（`session-keeper` 的 `keep_warm`、`away_handoff`、`handoff_gate`，`project-memory` 的 `distill`）**預設關**，費用見各 mod 的「費用」：

- **臨時開啟**：`/<mod> on`，到期或 session 結束（含 `/clear`）自動關，不寫入檔案；開啟期間輸入框上方顯示一行灰字，例如 `session-keeper on · keep_warm 1h42m`。一個 mod 有不只一個這類功能時要指定功能（`/session-keeper on keep_warm 2h`）；已經用設定常開的不會改變。
- **常開**：`/config`、`.claude/cc-mod-trimtab.local.json` 或使用者層的檔案；commit 進 repo 的 `.claude/cc-mod-trimtab.json` 不能開啟。
- **關閉**：`/<mod> off` 只關這個 session，常開的設定下個 session 恢復。
- 每個功能在一個 session 裡第一次用到模型時，toast 提醒一次。

repo 檔案能做什麼依設定的性質而定，違反的值不採用，`/<mod> status` 列出原因；`set --repo` 不會寫入會被忽略的值：

| 類別 | 設定 | repo 檔案 |
| --- | --- | --- |
| 保護 | `tool-guard` 的 `commit_format` | 只能開啟 |
| 保護 | `secret-scrub` 的 `allow`、`bypass_marker`；`tool-guard` 的 `rm_skip_paths` | 不能設定（會放寬保護） |
| 保護 | `secret-scrub` 的 `custom_rules` | 不能設定：JavaScript 的正規表示式沒有逾時，一條會無止盡回溯的規則會讓每個 prompt 卡住 |
| 花費 | `session-keeper` 的 `keep_warm`、`away_handoff`、`max_keeps`、`idle_minutes`、`handoff_gate`；`project-memory` 的 `distill`、`distill_every`、`min_context_k`、`idle_minutes` | 只能關閉或調省；`handoff_gate` 與 `project-memory` 的 `idle_minutes` 不能設定 |
| 一般 | 其他（例如 `output-trimmer` 的門檻、`tool-guard` 的 `commit_pattern`、`strip_attribution`） | 可自由設定 |

改了檔案後，`/<mod> status` 會重新讀取；其他時候在 session 開始時讀一次。

## 開發

把 clone 下來的資料夾加成 marketplace，就能直接改 repo 裡的 mod：

```bash
claude plugin marketplace add ./cc-mod-trimtab
```

本機資料夾的 marketplace 裡，相對路徑的 mod 會直接從 repo 載入，不會用複製到 `~/.claude/plugins/cache/` 的那份（`claude plugin list` 的 `Read from:` 會顯示 repo 路徑）。所以改完 mod，在每個執行中的 session 執行 `/reload-plugins` 就好，不用重新安裝，也不用改 `version` 或先 commit。只有新增或改名 mod（`marketplace.json` 有變）時，才要執行 `claude plugin marketplace update cc-mod-trimtab` 並安裝新名稱。

發佈時則要調高改過的 mod 的 `version`，從 GitHub 安裝的使用者才會收到更新，並在 [CHANGELOG.md](CHANGELOG.md) 記下。

```bash
claude plugin validate mods/<mod>   # 檢查 manifest 與 hooks module
claude plugin test mods/<mod>       # 執行 hooks/*.test.ts(x)
claude plugin validate .            # 檢查 marketplace
scripts/check-copies.sh             # 檢查各 mod 共用程式的複本一致
```

- `.claude-plugin/types/` 由 Claude Code 在載入 mod 時產生（API 型別），已列入 `.gitignore`；`tsconfig.json` 繼承它，載入過一次後可用 `npx tsc -p mods/<mod>` 型別檢查。
- 驗證器只允許把 `$` 傳給同一個檔案**頂層**宣告的函式，不能跨 import；helper 要寫成 `async function f($: EngineInterface, …)`。
- 驗證器不做型別檢查：沒定義的變數也會通過，要靠 `tsc` 抓。
- 測試中 engine 的 op（`process.run`、`ui.toast`…）由測試的 `on` 以 `{ value }` 回應。
- mod 不能 import 自己資料夾以外的檔案（符號連結也不行），共用的程式在每個 mod 各放一份，改的時候所有複本一起改，再跑 `scripts/check-copies.sh`：
  - `hooks/config.ts`（分層設定，見「設定」）在每個 mod 都有。
  - 每個 mod 的 register 檔裡 `// --- configIO:` 到 `// --- end configIO ---` 的區塊：`config.ts` 讀寫檔案要用 `$`，而 `$` 不能跨 import，所以由這個區塊包成 `ConfigIO` 傳進去。
  - `project-memory/hooks/scrub.ts` 是 `secret-scrub/hooks/scrub.ts` 的複本。
- 新增設定：在 mod 的 `SPECS` 加一筆（類別、型別、預設值、repo 規則、說明）；單一值同時在 `plugin.json` 的 `userConfig` 加一列，`/config` 才看得到。
- 不使用 emoji：mod 顯示的文字（band、狀態列、toast、面板）、程式碼、測試與文件都不用，狀態改用文字與顏色表達。只有明確指定要用 emoji 時例外，例如 `tool-guard` 檢查的 commit 標題格式。

### 多個 mod 共存

同一事件的 hook 會一層包一層：排在前面的在外層，先拿到輸入、最後拿到結果，呼叫 `next(e)` 才交給下一層。順序由 `~/.claude/settings.json` 的 `enabledPlugins` 決定，跟安裝順序無關，`/plugin install` 會把新的 plugin 加在最後。目前沒有讓 plugin 自己宣告順序的機制（型別檔：「same-event hooks nest in this order and no other way」）。所以原則是**每個 mod 的功能都不能依賴順序**：

- **交給 `next`**：用 matcher（`{ tool: 'Bash' }`、`{ command }`、`{ component, requestId }`）縮小範圍，處理完一律交給 `next`，不要在共用事件上自己回答。
- **共用的位置用疊的**：輸入框上方的 band（`AbovePrompt`）只有一個，所有 plugin 共用。有東西要畫時先 `const below = await next(e)`，把 `below` 放在自己的內容下方；沒東西時 `return next(e)`。直接回傳自己的樹會讓內層 plugin（包括 image-view 這類外部 plugin）的 band 消失。測試時在 engine 端加一個畫 `band beneath` 的 hook，斷言它仍然看得到（見 `session-keeper`、`agent-dispatch`、`open-items` 的測試）。`$.ui.status`、toast、各自 id 的 pane 由 engine 依 plugin 分開，不用處理。
- **band 裡的 Button 不可撞**：`key` 和 `hotkey` 在所有 mod 間不可重複。目前使用中的是 agent-dispatch 的 `r` `d`、open-items 的 `o` `u`、session-keeper 的 `h` `k`。
- **送出後才改狀態**：內層可能擋下事件（例如 `prompt.submit` 回傳 `drop`），所以呼叫 `next` 之前只讀狀態，確定事件通過後才改（見 `open-items` 的 `prompt.submit`）。`next` 之後的程式包在 `try` 裡，避免 `.catch` 被觸發。

唯一無法與順序無關的是**誰先看到原文**：排在 `secret-scrub` 外層的 `prompt.submit` hook 一定會先看到還沒遮蔽的 prompt。因此 `secret-scrub` 固定排在 `enabledPlugins` 的第一個，新增或重排 plugin 後要檢查。實際順序用 `claude -p "ok" --debug-file <檔案>` 的 `$ built for …` 那行確認。

以上依 Claude Code 2.1.294 的型別檔與實測整理。mod API 仍是 early access，之後若加入宣告順序的機制，再更新這段。

## session-keeper

### 費用

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

### cache 狀態

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

### 保持快取

1h 快取在最後一次被讀寫後 1 小時過期，過期後下一則 prompt 要把整個 context 重寫一次（1h 快取的寫入價是輸入價的 2 倍）；讀一次快取只要 0.1 倍，並讓到期時間重新起算。所以閒置時用 `$.model.fork({ prompt: 'Reply with OK only' })` 對主對話送一個不帶工具的請求，讀一次快取。

- **何時送**：主對話最後一次請求（或上一次保持）之後經過 `idle_minutes`（預設 55）分鐘。每段閒置最多 `max_keeps`（預設 3）次，用完後照常過期；主對話有新的請求就重新計算。
- **不送的情況**：TTL 不是 1h（5m 快取在 55 分鐘時早已過期；TTL 還沒從 transcript 判斷出來也不送）、上一次請求的輸入少於 30k、已經過期、`/clear` 後換了對話。
- **結果**：成功後把快取到期時間改成送出的時間，desktop 的 cache 行顯示 `kept 1/3`；成功、失敗與不送的原因都只寫進 debug log（`keep warm …`），不打擾畫面。fork 的 usage 不計入 `hit`。
- **熱重載**：計時器會被清掉，`session.start` 依 `$.state` 裡的最後請求時間重新排程；已經過了預定時間但還沒過期的，立刻送。
- **設定**：`keep_warm` 開關、`idle_minutes`（5–59）、`max_keeps`（1–10）。最後一次保持在 context 超過交接門檻時改成產生交接摘要，見下方「交接」。

fork 是主對話最後一次請求加上一則訊息，所以 model、system prompt、工具都相同，讀的就是主對話的快取（型別檔：「the API serves that prefix from its cache」）；換了 model（`/model`）之後的 fork 會整段重寫。fork 讀快取是否也把 1h 的到期時間重新起算，型別檔沒有寫明，這裡依快取的一般行為（每次命中都重新計時）推定；debug log 的 `read` 量若在下一次保持時接近 0，代表沒有續上。

### 交接

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

### 設定

`keep_warm`（預設關）、`idle_minutes`、`max_keeps`（保持快取），`handoff_gate`（`suggest`／`block`／`off`，預設 `off`）、`away_handoff`（預設關）、`progress_resume`（交接）。分層與 repo 檔案的限制、`/session-keeper on`／`off` 見上方「設定」。

## project-memory

### 費用

自動整理預設關；`/project-memory run` 是你自己下的指令，不受開關限制。

| 功能 | 模型 | 何時呼叫 | 每次的量 | 送出的內容 |
| --- | --- | --- | --- | --- |
| `distill` 自動整理 | Sonnet（effort low） | 每 `distill_every`（30）則且 context 至少 `min_context_k`（30）k、閒置 `idle_minutes`（10）分鐘、`/clear` 時（各有門檻，見下方「整理」）；`MEMORY.md` 超過上限時多一次合併請求 | 輸入 ≈ 上次整理後新增的對話（工具輸入截到 300 字、結果截到 500 字）＋現有記憶清單，通常數千到數萬 token；輸出最多 4000 token | 遮蔽過金鑰的新增對話、現有記憶、進度檔 |

- **怎麼估**：輸入 token × Sonnet 輸入價＋輸出 token × 輸出價。這不是 fork，不讀主對話的快取。
- **送去哪**：經由 Claude Code 的 `$.model` 送到主對話使用的同一個 API 供應商。
- **訂閱制**：不依 token 計費，但算進用量額度；上面的換算是依 API 價格估算。
- **開啟**：`/project-memory on [時長]`，或用 `/config` 常開 `distill`。

### 整理

- **何時**：三種時機，都在背景跑。
  - 主對話回答完、距離上次整理有 `distill_every`（預設 30）則使用者訊息、且 context 至少 `min_context_k`（預設 30）k。
  - 最後一次回答後閒置 `idle_minutes`（預設 10）分鐘，且有 5 則以上新訊息（不看 context 大小）；設成 0 時閒置不整理。
  - `/clear` 時有 5 則以上新訊息：先在 `session.end` 抓下對話，換到新 session 後再整理。直接退出（`/exit`、ctrl+c）時 hook 只有約 1.5 秒，來不及整理。
  - `/project-memory run` 立即整理並顯示狀態，`/project-memory status` 看狀態與設定。自動整理失敗後隔 5 則再試。
- **送什麼**：上次整理到的那則使用者訊息之後的對話（找不到時送整段，但不准增加出現次數），工具輸入截到 300 字、結果截到 500 字，再用 `secret-scrub` 的規則遮蔽；模型輸出的動作裡有像金鑰的值整行丟掉。user、feedback 類記憶要附使用者原話，比對不到就丟掉。
- **寫到哪**：記憶資料夾優先用 context 載入 `MEMORY.md` 的位置，找不到時用 `~/.claude/projects/<repo 根目錄編碼>/memory/`（worktree 共用主工作樹的）。每條記憶與規則一個 `pm-<類型>-<標題中的英數字>-<雜湊>.md`，frontmatter 有 `name`、`description`、`type`，內文是做法、理由、相關檔案與最近 3 筆根據；主 session 改過這些檔案，下次整理以檔案內容為準，認不得的段落原樣保留。整理期間檔案被改過時這次不寫，下次重新整理同一段。
- **相關檔案**：記憶講的是特定檔案時，記下 repo 裡的相對路徑（最多 3 個）。每次整理檢查檔案還在不在，不在的在清單上標給模型：只是改名就改路徑，講的事不成立了就標記失效，看不出來就不動。
- **失效**：模型刪除記憶或規則時不刪檔，而是在 frontmatter 加 `invalidated`（日期）與 `superseded_by`（取代它的那條），從 `MEMORY.md` 與之後的整理中拿掉；90 天後才刪檔。流程只存在 `$.store`，刪除就是刪除。
- **過期**：project、reference 類超過 30 個工作日（這個 repo 有開 session 的日子，記在 `$.store`）沒被證實，從 `MEMORY.md` 拿掉、檔案保留，再被證實就放回。停工一段時間回來不會一次全部過期。
- **上限**：`MEMORY.md` 只自動載入前 200 行，和主 session 自己的記憶共用，所以 `pm-` 的行最多 60 條。整理後超過時，再送一次只能合併與標記失效的請求；仍超過（或請求失敗）就只列最近被證實的 60 條，其餘檔案保留。
- **進度**：有實際進展才更新 `.claude/progress.md`，整份取代；`session-keeper` 交接時會用交接摘要覆蓋它，並由它帶入新 session（見「session-keeper」的「交接」）。

### 寫進 repo

規則與流程被 3 個不同 session 證實、還沒放進 repo 的，每個 session 的第一則 prompt 附上交代（一次最多 3 條，同一條最多 2 次、間隔 6 小時）。同一個 session 再證實只加根據、不加次數。

- **規則**：CLAUDE.md 由使用者決定，Claude 不直接改，而是在回覆最後列出要加的文字和位置，問你要不要加；同意後才寫入，再呼叫 `mark_in_project` 回報位置，規則的 memory 檔隨之刪掉、只在 `$.store` 留紀錄。不同意時標記「不放」，規則照舊留在 memory。
- **流程**：直接做成 `.claude/skills/<名稱>/SKILL.md`（新檔案，你看 diff 決定留不留），回報後不再交代。

都不 commit。

### 設定

`distill` 自動整理開關（預設關；關閉時閒置與 `/clear` 也不整理，臨時開啟用 `/project-memory on`）、`distill_every`（5–200）、`min_context_k`（0–1000，只影響每 N 則的整理）、`idle_minutes`（0–120，0 表示閒置不整理）、`promote` 交代寫進 repo 的開關。

`/config` 的值存在使用者層級 `~/.claude/settings.json` 的 `pluginConfigs`，所有 repo 共用；2026-10-09 在 2.1.295 實測，repo 的 `.claude/settings.json`、`.claude/settings.local.json` 裡的 `pluginConfigs` 不會生效，所以依 repo 調整要用上方「設定」的 repo 或 local 檔案。

## agent-dispatch

### 用量帳本

每一步模型呼叫依「主 session 或發出它的 subagent」記帳，每次派 agent 依 agent 種類記帳，存在 plugin 自己的 `$.store`（每個 session 一個 key，跨 repo 共用）。超過 90 天的紀錄在 session 開始時刪除。

`/agent-dispatch stats [天數]`（1–90，預設 30，含今天）加總所有 session，列出：

- 主 session 與 subagent 的 token（input + cache write + output）與 subagent 佔比；cache read 另列一行。
- 各模型 token，以及 agent 種類 × 模型的派出次數與 token。
- 派出總次數、指定模型的次數（`n/N`）、指定 Opus 的次數、fork 的次數，以及最近 10 筆指定 Opus 的 description。

不含：各 mod 自己呼叫模型（`$.model.fork` / `$.model.complete`）的用量、雲端 session（不載入 mod）、安裝之前的紀錄。

### 設定

`ledger`（預設開）控制記不記帳；關閉後不再記錄，`stats` 仍讀得到已有的紀錄。repo 檔案不能設定它。

## 已知限制

- `secret-scrub` 在遮蔽後約 3 秒與 session 結束時改寫 `history.jsonl` 中本 session 的紀錄（含 `paste-cache`），只有 CLI 會寫這個檔；改寫前 CLI 已載入記憶體的上方向鍵歷史可能仍是原文。檔案超過 4 MiB 時無法讀取，會提示失敗。
- `output-trimmer` 只改模型讀到的內容，畫面上仍顯示完整輸出。
- `tool-guard` 以正則與簡易斷詞解析指令，`eval`、`bash -c "…"`、`xargs rm`、`find -delete`、腳本檔內的呼叫偵測不到。force push 的清單依上次 fetch 的遠端狀態；Django 等 migration 的清單要執行專案自己的狀態指令（例如 `python3 manage.py showmigrations`），會在你按下執行前載入專案程式碼。
- `tool-guard` 的確認面板由 Claude 的工具呼叫開啟，算是「非使用者要求」的 pane，終端機要 144 欄以上（開過一次後 110 欄）才放得下，否則改用詢問對話框；沒放上的原因記在 debug log（`tool-guard: 面板沒有放上`）。面板等待時 Claude 會停住；10 分鐘沒回應、或按 Esc 中斷回合，指令都不會執行。
- `self-check` 擋下停止時，畫面會顯示成 Stop hook error（Claude Code 對 Stop hook `block` 的呈現），之後 Claude 會接著驗證。用 Bash 改檔（`sed -i`、`python3`）還不算改過程式檔；「完成」的判斷只看回覆的開頭與結尾是否有「完成了」「已修好」「all done」等說法，換個說法會漏掉。
- `session-keeper` 的交接靠 `/clear` 後把草稿放進輸入框；放不進去（例如有對話框擋著）時 toast 提示，摘要仍在 `.claude/progress.md`。`suggest` 模式的提議出現時，新 prompt 已經付了一輪大 context 的錢。
- `project-memory` 刪檔用 `rm`（`$.fs` 沒有刪除），只支援 macOS／Linux。記憶資料夾的預設路徑依 Claude Code 的命名推算，設定了其他位置（例如 `autoMemoryDirectory`）且 context 沒載入 `MEMORY.md` 時會寫錯地方。整理只看主對話，subagent 的內容不算。
- 檢查本身出錯時兩個 mod 都改成不放行：`tool-guard` 擋下含 `git`、`rm`、`migrate` 的指令（其他指令照常執行），`/tool-guard allow` 可放行一次；`secret-scrub` 不送出 prompt，把原文放回輸入框，確定沒有密鑰時加 `#noscrub`（或設定的 `bypass_marker`）再送。

## License

[MIT](LICENSE)。部分程式改寫自 [cablate/ctx-handoff-mod](https://github.com/cablate/ctx-handoff-mod)（MIT），見 [NOTICE](NOTICE)。
