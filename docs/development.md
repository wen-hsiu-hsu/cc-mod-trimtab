# 開發指南

給開發這個 repo 的人與 agent。使用者文件見 [README](../README.zh-TW.md)；這份只有中文；`CLAUDE.md` 與 ADR 用英文（見 [ADR 0005](adr/0005-docs-layout.md)）。

## 文件地圖

| 要找什麼 | 在哪裡 |
| --- | --- |
| agent 的入口：最重要的規則與這份指南的連結 | [`CLAUDE.md`](../CLAUDE.md) |
| 專案介紹、每個 mod 一句話 | `README.md`、`README.zh-TW.md` |
| 安裝、設定分層 | `docs/install*.md`、`docs/settings*.md` |
| 每個 mod 的行為、指令、設定、費用、已知限制 | `docs/mods/<mod>.md`、`docs/mods/<mod>.zh-TW.md` |
| 為什麼這樣做（決定與理由） | `docs/adr/`（[索引](adr/README.md)） |
| 畫面的顏色、版面、控制項、快捷鍵、用詞 | [`DESIGN.md`](../DESIGN.md) |
| 畫面的設計稿（每一輪提案與定案） | [`design/`](../design/README.md) |
| 還沒做的事、暫緩與不做的提案、已知問題、查證結果 | [`ROADMAP.md`](../ROADMAP.md) |
| 每個版本改了什麼 | [`CHANGELOG.md`](../CHANGELOG.md) |
| 保護範圍與回報方式 | [`SECURITY.md`](../SECURITY.md) |

## 開始

把 clone 下來的資料夾加成 marketplace，就能直接改 repo 裡的 mod：

```bash
claude plugin marketplace add ./cc-mod-trimtab
```

本機資料夾的 marketplace 裡，相對路徑的 mod 會直接從 repo 載入，不會用複製到 `~/.claude/plugins/cache/` 的那份（`claude plugin list` 的 `Read from:` 會顯示 repo 路徑）。所以改完 mod，在每個執行中的 session 執行 `/reload-plugins` 就好，不用重新安裝，也不用改 `version` 或先 commit。只有新增或改名 mod（`marketplace.json` 有變）時，才要執行 `claude plugin marketplace update cc-mod-trimtab` 並安裝新名稱。

也因為如此，載入這個 clone 的 session 會立刻用到改到一半的程式：在 worktree 裡改，檢查都過了才合併回 master。

## 檢查

```bash
claude plugin validate mods/<mod>   # 檢查 manifest 與 hooks module
claude plugin test mods/<mod>       # 執行 hooks/*.test.ts(x)
claude plugin validate .            # 檢查 marketplace
scripts/check-copies.sh             # 檢查各 mod 共用程式的複本一致
scripts/check-docs.sh               # 檢查文件：每個 mod 有中英頁面、README 有連結、相對連結都存在、ADR 都列在索引
```

CI（`.github/workflows/ci.yml`）在 master 與 PR 上跑上面全部，裝 `@anthropic-ai/claude-code@2.1.296`。CI 沒跑 `tsc`：型別檔只在 Claude Code 載入 mod 時產生，CI 拿不到；`secret-scrub/hooks/history.test.ts` 也已有 2 個型別錯誤。

## 寫 mod

- `.claude-plugin/types/` 由 Claude Code 在載入 mod 時產生（API 型別），已列入 `.gitignore`；`tsconfig.json` 繼承它，載入過一次後可用 `npx tsc -p mods/<mod>` 型別檢查。
- 驗證器只允許把 `$` 傳給同一個檔案**頂層**宣告的函式，不能跨 import；helper 要寫成 `async function f($: EngineInterface, …)`。
- 驗證器不做型別檢查：沒定義的變數也會通過，要靠 `tsc` 抓。
- 測試中 engine 的 op（`process.run`、`ui.toast`…）由測試的 `on` 以 `{ value }` 回應。
- 共用的程式每個 mod 各放一份，見下方「共用程式」。
- 新增設定：在 mod 的 `SPECS` 加一筆（類別、型別、預設值、repo 規則、說明）；單一值同時在 `plugin.json` 的 `userConfig` 加一列，`/config` 才看得到。
- 每個功能有自己的開關，一個功能出錯時跳過，不能拖垮整個 mod。
- 不使用 emoji：mod 顯示的文字（band、狀態列、toast、面板）、程式碼、測試與文件都不用，狀態改用文字與顏色表達。只有明確指定要用 emoji 時例外，例如 `tool-guard` 檢查的 commit 標題格式。
- 測試引擎裡同一個事件不能註冊兩次 hook；要模擬其他 plugin 的行為時，改用測試裡的共用變數（`world`）。
- `Button` 裡只能放文字與 `Text`，不能放 `Box`（見 [DESIGN.md](../DESIGN.md#控制項)）。
- 用 `--plugin-dir` 開的測試 session 讀不到 `pluginConfigs["<mod>@cc-mod-trimtab"]`（key 變成 `<mod>` 或 `<mod>@inline`），所以測不到用 `/config` 常開的行為；這類行為只能測預設值與 `/<mod> on`，常開的等合併後由正式載入的 session 確認。

## 共用程式

mod 不能 import 自己資料夾以外的檔案（見 [ADR 0011](adr/0011-shared-code-copied-per-mod.md)）。下列複本要一起改，再跑 `scripts/check-copies.sh`：

- `hooks/config.ts`（分層設定），每個 mod 都有。
- 每個 mod 的 register 檔裡 `// --- configIO:` 到 `// --- end configIO ---` 的區塊。
- `project-memory/hooks/scrub.ts` 是 `secret-scrub/hooks/scrub.ts` 的複本。
- `hooks/ui.tsx`（畫面的共用元件），每個有畫面的 mod 都有（見 [DESIGN.md](../DESIGN.md)）。

## 多個 mod 共存

同一事件的 hook 會一層包一層：排在前面的在外層，先拿到輸入、最後拿到結果，呼叫 `next(e)` 才交給下一層。順序由 `~/.claude/settings.json` 的 `enabledPlugins` 決定，跟安裝順序無關，`/plugin install` 會把新的 plugin 加在最後。目前沒有讓 plugin 自己宣告順序的機制（型別檔：「same-event hooks nest in this order and no other way」）。所以原則是**每個 mod 的功能都不能依賴順序**：

- **交給 `next`**：用 matcher（`{ tool: 'Bash' }`、`{ command }`、`{ component, requestId }`）縮小範圍，處理完一律交給 `next`，不要在共用事件上自己回答。
- **共用的位置用疊的**：輸入框上方的 band（`AbovePrompt`）只有一個，所有 plugin 共用。有東西要畫時先 `const below = await next(e)`，把 `below` 放在自己的內容下方；沒東西時 `return next(e)`。直接回傳自己的樹會讓內層 plugin（包括 image-view 這類外部 plugin）的 band 消失。測試時在 engine 端加一個畫 `band beneath` 的 hook，斷言它仍然看得到（見 `session-keeper`、`subagent-dispatch`、`open-items` 的測試）。`$.ui.status`、toast、各自 id 的 pane 由 engine 依 plugin 分開，不用處理。
- **band 裡的 Button 不可撞**：`key` 和 `hotkey` 在所有 mod 間不可重複。目前使用中的是 subagent-dispatch 的 `r` `d`、open-items 的 `o` `u`、session-keeper 的 `h` `k`。
- **送出後才改狀態**：內層可能擋下事件（例如 `prompt.submit` 回傳 `drop`），所以呼叫 `next` 之前只讀狀態，確定事件通過後才改（見 `open-items` 的 `prompt.submit`）。`next` 之後的程式包在 `try` 裡，避免 `.catch` 被觸發。

唯一無法與順序無關的是**誰先看到原文**：排在 `secret-scrub` 外層的 `prompt.submit` hook 一定會先看到還沒遮蔽的 prompt。因此 `secret-scrub` 固定排在 `enabledPlugins` 的第一個，新增或重排 plugin 後要檢查。實際順序用 `claude -p "ok" --debug-file <檔案>` 的 `$ built for …` 那行確認。

為什麼這樣規定見 [ADR 0012](adr/0012-order-independent-hooks.md)。

## 改完之後

改動合併前，照下表更新文件。`scripts/check-docs.sh --commit` 會在 `git commit` 前檢查（見下方「commit 前的檢查」）。

| 改了什麼 | 要更新 |
| --- | --- |
| mod 的行為、指令、設定、預設值、門檻、快捷鍵 | `docs/mods/<mod>.md` 與 `.zh-TW.md`（兩份一起改）；影響分層或共用指令時也改 `docs/settings*.md` |
| 新增、改名、移除 mod | 上一列，加上 `README.md` 與 `README.zh-TW.md` 的表、`docs/install*.md` 的安裝清單、`marketplace.json`、`SECURITY.md`（有保護範圍時） |
| 在幾個做法之間取捨過、之後難以反悔的決定 | 新增一個 ADR（見下方「ADR」） |
| 畫面規範 | 先改 `DESIGN.md`，再改程式 |
| 設計畫布 | `design/<主題>/`（見下方「設計稿」） |
| 實測結果（通過或發現限制） | `ROADMAP.md` 的「查證結果」；是限制的話也寫進 mod 頁面的「已知限制」 |
| 做完、暫緩或放棄 ROADMAP 的項目 | `ROADMAP.md` 的「待辦」「暫緩」「不做」 |
| 要發佈的改動 | mod 的 `version` 與 `CHANGELOG.md`（見下方「發佈」） |

### commit 前的檢查

`.claude/settings.json` 的 PreToolUse hook 在 Claude 執行 `git commit` 前跑 `scripts/check-docs.sh --commit`，擋下以下情況並說明原因：

- 暫存區有 mod 的程式（`mods/<mod>/hooks/` 底下不是測試的檔案，或 `plugin.json`），卻沒有它的 `docs/mods/<mod>*.md`：行為沒變時在 commit 訊息加一行 `Docs: n/a <理由>`。
- 同上，卻沒有新增或修改 `docs/adr/`：沒有值得記的決定時加一行 `ADR: n/a <理由>`。
- 中英兩份文件只改了一份（`README`、`docs/install`、`docs/settings`、`docs/mods/<mod>`）：只是修一種語言的錯字時同樣用 `Docs: n/a <理由>`。

這兩行放在 commit 訊息的最後，和其他 trailer 一起。人手動 commit 時不會經過這個 hook，自己照上表檢查。

### push 前的檢查

同一個 hook 也在 Claude 執行 `git push` 前，比對 HEAD 與最近的 `v*` tag，擋下以下情況：

- 某個 mod 在 tag 之後改了（測試檔不算），`plugin.json` 的 `version` 卻沒變。
- 調高的版本沒寫進 `CHANGELOG.md`（`[Unreleased]` 的「`` `<mod>` X.Y.Z ``」或發佈表格的「`` | `<mod>` | X.Y.Z | ``」都算）。
- 有 mod 改過，HEAD 卻還沒打新的 `v*` tag。

確定這次不發佈新版（例如只推文件）時，在 push 指令後加註解 `# Release: n/a <理由>`。人手動 push 時不會經過這個 hook，自己照下方「發佈」檢查。

## 設計稿

畫面先在 claude.ai 的 Design 畫布上畫，每一份稿都存進 repo，才能往回查某個決定之前的樣子。

- **位置**：`design/<主題>/project/`，檔案跟畫布的 `project/` 一模一樣：`canvas.json` 加上每個 artboard 一個 `.dc.html`。[`design/README.md`](../design/README.md) 列出每個主題和它的畫布連結。發布時 `root` 設成 `design/<主題>`，repo 裡的檔案就是畫布的原始檔，不另外放一份。
- **一個主題一張畫布**：每一輪新增一頁，頁名寫「YYYY-MM-DD 內容」；artboard 檔名加上那一輪的前綴（例如 `P1014-`），避免跟舊稿撞名。
- **不改寫舊稿**：討論過或定案的 artboard 不再改；要改就在新的一頁畫新版。同一輪還在討論時可以直接改。
- **省 token**：開新的一輪只讀上一輪定案的那幾份，不把整張畫布讀進對話；每輪做完就 `/clear`。
- **上限**：一張畫布最多 40 頁、512 個檔案，快滿時開新畫布 `<主題>-2`，並列進 `design/README.md`。
- **同步**：畫布每發布一次，就把改到的檔案 commit 進 `design/`（在 worktree 裡）。使用者在頁面上直接改過的，先用 Artifact 的 read 拉回來，再 commit。
- **稿不是規格**：定案的內容寫進 `DESIGN.md`，程式照 `DESIGN.md` 做。
- 畫布連結是私人的，只有擁有者打得開。

## ADR

`docs/adr/NNNN-<slug>.md`，用英文寫，編號取目前最大的加一，並加進[索引](adr/README.md)。只在三個條件都成立時寫：難以反悔、沒有前因後果會讓人意外、真的在幾個做法之間取捨過。容易改回來的、或沒有其他做法的，不用寫。

```md
# <The decision, in one line>

- Status: accepted
- Date: YYYY-MM-DD

<1-3 sentences: the context, what was decided, and why.>

(Only when useful: Considered, Consequences.)
```

決定被推翻時不刪檔：把舊的狀態改成 `superseded by NNNN`，新的 ADR 寫明取代哪一個。

## 發佈

1. 在 worktree 改，`claude plugin validate`、`claude plugin test`、`scripts/check-copies.sh`、`scripts/check-docs.sh` 都過，文件照「改完之後」更新了，才合併回 master（這個 clone 是使用者所有 session 直接載入的 mod）。
2. 改了哪個 mod 就調高它的 `version`：從 GitHub 安裝的使用者只有版本號變了才會更新，中間的 commit 拿不到。
3. CHANGELOG 加一段（每個 tag 列出包含的 mod 版本；破壞性變更寫出使用者要做什麼），打 tag `vX.Y.Z`，push 前先問使用者。少了 version、CHANGELOG 或 tag 時，push 前的檢查會擋下（見上方「push 前的檢查」）。
4. 會改變預設值的改動，合併前先確認自己的 `pluginConfigs` 或 `~/.claude/cc-mod-trimtab.json` 已寫好要維持的值：這個 clone 是自己所有 session 直接載入的，合併後行為立刻改變。
