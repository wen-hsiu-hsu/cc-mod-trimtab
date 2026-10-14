# subagent-dispatch：stats 日曆熱圖、每日摘要、transcript 回填

狀態：規格已確認（2026-10-13），尚未實作。目標版本 0.8.0。

已確認的決定：
- 一週從週一開始。
- 熱圖寬度放得下幾週就畫幾週。
- 每日摘要只用在熱圖。
- 實作時再查怎麼辨認 fork。
- 熱圖用 GitHub 式週曆格，格子畫成 `■`（2026-10-14 從四個版面提案、四種格子字元中選定，設計稿在 claude.ai artifact「subagent-dispatch 熱力圖」）。
- 點格子或按 `j`／`k` 選一天，下面的期間變成那一天。
- 「沒有資料」和「沒有用量」畫法不同。

## 範圍

1. stats pane 加日曆熱圖，寬度放得下幾週就畫幾週，最多 53 週。
2. 新增「每天一行」的每日摘要，保留 366 天。session 明細仍保留 90 天。熱圖畫 90 天以前的格子時讀這份摘要。
3. 安裝或更新後第一次開 session 時，從本機 transcript 回填還沒有帳本的 session。

不做：自訂熱圖期間、標出今天的格子、把沒有資料的週收合成一段、分級改用固定 53 週。`期間` 和 `stats [天數]` 上限仍是 90 天；選到 90 天以前的日子時，卡片讀那天的 `day:` 摘要（見「選一天」），分組清單沒有資料。

## 1. 每日摘要

### 資料

key `day:YYYY-MM-DD`（當地日期），值為：

```ts
type DayRow = {
  // 主 session 當天的 token，依模型
  main: Record<string, Tally>
  // 最後一步落在當天的派出的 token，依派出的模型
  sub: Record<string, Tally>
  // 同 Report.spawned 的五個計數
  spawned: { all: number; explicit: number; opus: number; forks: number; defaults: number }
  // 算出這一行的時間
  at: number
}
```

### 怎麼寫

- 不即時累加。多個 session 同時對同一個 key 做「讀出、加上、寫回」會互相蓋掉，所以每一行都從帳本**整個重算**再寫入。兩個 session 同時算出的值一樣，誰蓋過誰都沒差。
- `session.start` 剪帳本之前，先替「前天以前、還沒有 `day:` 行」的日子產生摘要（昨天可能還有 session 在寫，所以不算）。
- 一行寫好之後就不再改。帳本 90 天後刪除時，摘要不受影響。
- `day:` 行超過 366 天就刪掉，跟剪帳本在同一步做。
- 回填寫完帳本後，也跑一次產生摘要。

### 大小

一天約 200–400 bytes（2–3 個模型），366 天約 0.1 MB。

## 2. 日曆熱圖

### 資料

- 最近 90 天（今天往前算 90 個日曆天）的資料來源和 `buildReport` 一樣，都從帳本來：主 session 用 `Ledger.daily`，派出用 `dayOf(spawn.last)`。這段的數字和 pane 其他地方對得起來。
- 更早的日子讀 `day:` 摘要。帳本在第 90 天刪掉以前，摘要早就產生好了，所以兩段之間不會有缺口。
- 每格分三種：**沒有資料**（帳本和 `day:` 摘要都沒有這天：回填以前、transcript 已刪、別台電腦）、**沒有用量**（有紀錄，0 token）、**有用量**。前兩種意思不同，畫法也不同。
  - 90 天內：這天落在任何一本帳本的 `started`–`updated` 之間，或有任何一筆 `Ledger.daily`，就算有紀錄。
  - 90 天前：有 `day:` 行就算有紀錄，整行都是 0 就是沒有用量。
- 每格的值是當天主 session 加派出的 token，跟 pane 的總數一樣不算快取讀取。
- 新增 `buildHeatmap(ledgers, dayRows, weeks, now): { days: { day: string; tokens: number | null }[] }`（`null` = 沒有資料），放在 `ledger.ts`，可以單獨測試。

### 版面

由上而下：標題列、熱圖（月份列、7 列格子、標註行、圖例）、空一行、`期間` 那一行、卡片……

- 位置在總覽最上面，標題列下面、`期間` 那一行上面。打開某一列之後不顯示。
- 熱圖本身不跟著 `期間` 改變。
- 週數 = `min(53, 放得下的週數)`，至少 4 週。終端機放得下的週數是 `floor((bodyColumns - 4) / 2)`：80 格的終端機 38 週，110 格畫滿 53 週。desktop 依 pane 寬度用同一條公式算。
- 一欄是一週，共 7 列，週一在最上面，今天落在最後一欄。今天以後的格子留空、不能選。
- 左邊標 `一`／`三`／`五`（英文為 `Mon`／`Wed`／`Fri`），上方在每個月第一次出現的那一欄標月份（`Jul`／`7月`）。
- 終端機：每格是一個上色的 `■`，格與格之間空 1 格，再加左邊 4 格的星期標籤。至少要 4 週（11 格），`bodyColumns` 不到 12 就不畫熱圖。`■` 是 East Asian Ambiguous 寬度，終端機設成「ambiguous 當全形」時會錯位，記進「已知限制」。
- 格子的畫法：
  - 有用量：`■`，依四分位數分 4 級，青色系越亮越多。
  - 沒有用量：灰色 `■`。
  - 沒有資料：`dimColor` 的 `·`，不畫 `■`。
  - 選到的那天：`bold` 的橘色 `■`（`#ff8c42`，跟青色色階互補，一眼跳出來；不吃 hex 時用 `magentaBright`）。DESIGN.md「不要用顏色表示選到」是針對切換鈕，這裡要在 DESIGN.md 寫明例外：`■` 加粗看不出差別，格子只能靠顏色標出選到的那天（下方標註行的 `▲` 日期再用文字說一次）。
  - 分級只依畫出來的那幾週算，所以寬度改變時顏色可能跟著變。
- 色階（設計稿的值，要先寫進 DESIGN.md；`color` 吃不吃 hex 要先查型別檔，不吃的話改用 ANSI 色 `gray`、`blue`、`cyan`、`cyanBright`、`whiteBright`）：沒有用量 `#4a4a52`，1–4 級 `#1f5a6d`、`#2a7f9c`、`#3aa6cc`、`#86d6f0`。
- 標註行（格子下面一行）：
  - 沒選日時，用 `└──── 30 天 ────┘` 標出目前期間涵蓋的週（從期間第一天那週到最後一欄）。期間是 1 天時改成 `▲ 今天`。
  - 選了一天時，在那一欄下面用同一個橘色 `bold` 寫 `▲ 10/02 週五`；靠近右邊放不下時改成 `10/02 週五 ▲`，`▲` 對齊那一欄。
- 圖例一行：`無資料 · 無用量 ■ 少 ■■■■ 多 選到 ■`（英文為 `No data · None ■ Less ■■■■ More Selected ■`），最多的那天靠右：`最多 10/02 1.2M`。
- desktop：用一張 `Svg` 畫，有用量的顏色沿用 `COLORS.sub.fill` 依級數調透明度；沒有用量是 `COLORS.default.fill` 25% 實心；沒有資料是虛線外框、不填色；選到的那天填同一個橘色。
- `--text` 文字版不畫熱圖。

### 選一天

- 點格子（終端機的滑鼠點擊可用）選那一天。每一格是一顆 `plain` 按鈕，`key` 寫成 `day:YYYY-MM-DD`。
- `j: ‹ 前一天`、`k: 後一天 ›` 兩顆 `plain` 按鈕放在 `期間` 那一行最右邊。`j` 在沒選日時選今天，之後一次往前一天，到最左一欄停；`k` 往後一天，到今天停，沒選日時不做事。
- 選了之後，`期間` 顯示 `‹ 10/02 週五 ›`，後面寫 `1 天 · p 回到 30 天`；卡片、快取讀取、分組清單都換成那一天。
- 選了日子時，`p` 第一下取消選日、回到原本的期間；沒選日時照舊在 1／7／30／90 天之間切換。
- 選到沒有用量的日子：卡片的位置改成一句灰字 `10/04（六）沒有用量（這天有紀錄，主 session 和 subagent 都是 0 token）。`
- 選到沒有資料的日子：灰字 `09/08（二）沒有資料（帳本與每日摘要都沒有這天：回填以前，或 transcript 已被刪掉）。`，不畫 0。
- 選到 90 天以前、有摘要的日子：卡片用 `day:` 行的數字；分組清單改成一句灰字說明那天只剩每日摘要。
- 快捷鍵 `j`、`k` 要加進 DESIGN.md 的快捷鍵表。

## 3. 從 transcript 回填

### 什麼時候跑

- hook API 沒有安裝事件（2.1.288 型別檔）。所以 `session.start` 時如果 store 裡沒有 `backfill` key，就在背景跑，不等它結束就呼叫 `next(e)`。剛安裝的 mod 第一次載入，以及從舊版更新上來時，都會遇到這種情況。
- `backfill` 的值是 `{ state: 'running' | 'done', at, sessions, skipped }`。開始時寫 `running`；別的 session 看到 `running` 而且不到 10 分鐘，就不跑。
- 新增 `/subagent-dispatch backfill` 子指令，不管有沒有標記都重跑一次，給失敗後重來或換電腦後用。
- 帳本設定 `ledger` 關閉時不跑。

### 讀哪些檔

- projects 根目錄 = `dirname(dirname(e.transcript_path))`，這樣 `CLAUDE_CONFIG_DIR` 也會跟著對。
- `<root>/<project>/<sid>.jsonl` 是主 session，`<root>/<project>/<sid>/subagents/agent-<id>.jsonl` 加上 `.meta.json` 是派出。
- 只補 store 裡**沒有** `ledger:<sid>` 的 session，目前的 session 也略過。已經有帳本的 session，以即時記錄為準。
- 用 `$.fs.list` 和 `$.fs.read` 讀。`$.fs.read` 單檔上限 4 MiB，超過的檔改用 `$.process.spawn(['cat', path])` 串流讀；沒有 `$.process`（例如 desktop）就略過，記進 `skipped`。目前 299 個主 transcript 裡有 2 個超過，最大 10.4 MB；subagent 檔最大 3.0 MB。
- 一次只處理一個檔案，處理完一個就讓出事件迴圈，不拖慢 session。

### 怎麼算（2026-10-13 對照實際 transcript 確認過的欄位）

- 主 session：取 `type: "assistant"` 而且 `isSidechain` 不是 true 的行。同一則回覆會依內容區塊拆成好幾行，用 `message.id` 去重，取最後一行的 `usage`，每個 id 算一步。
  - 日期：`dayOf(Date.parse(timestamp))`。
  - 模型：`message.model`，略過 `<synthetic>`。
  - `input_tokens` → `input`，`cache_creation_input_tokens` → `cacheWrite`，`cache_read_input_tokens` → `cacheRead`，`output_tokens` → `output`。
- 派出：`.meta.json` 裡有 `agentType`、`description`、`model`（指定的模型）、`requestShape`、`toolUseId`。
  - 步數照主 session 的方式算。
  - `at`／`last`：第一步和最後一步的 timestamp。`model`：第一步的 `message.model`。`agentId`：取檔名。
  - `background`：`requestShape !== 'foreground'`。
  - 怎麼辨認 fork 還沒查證，實作時先找一個真的 fork 的 meta 來確認。
- session 的其他欄位：
  - `started`：第一行的 timestamp。
  - `updated`：最後一行的 timestamp，所以照常 90 天後剪掉。
  - `prompt`：第一則使用者文字（略過 `<` 開頭的指令或系統內容），經過 `promptSummary`。
  - `repo`：拿第一行的 `cwd`，用和 `session.start` 同一個函式算出主工作樹。失敗就直接用 `cwd`。
- 帳本加上選填欄位 `source?: 'transcript'`，用來分辨回填的資料，方便除錯。

### 結束

- 寫入 `backfill: { state: 'done', … }`，接著產生每日摘要。
- 補到至少一個 session 時跳 toast：`subagent-dispatch 已從 transcript 補上 N 個 session（M/D 起）`。沒補到就不跳。
- 錯誤照 ADR 0019：記進 debug log，單一檔案失敗就跳過、記進 `skipped`，不中斷整個回填。

### 預估

- 這台電腦約 300 個主 session、350 個派出，回填後 store 大約 200 KB。這跟即時記錄 90 天後的大小差不多。
- 實作完要量一次 `turn.step` 寫入的耗時，記進 ROADMAP「查證結果」。

## 測試

- `buildHeatmap`：
  - 週數依寬度決定，最多 53 週、最少 4 週，今天落在最後一欄。
  - 90 天以內讀帳本，更早讀 `day:` 摘要，兩段之間沒有缺口。
  - 跨月的月份標籤。
  - 快取讀取不計入。
  - 派出算在最後一步那天。
- 每日摘要：
  - 前天以前才產生，昨天和今天不產生。
  - 已有的行不重寫。
  - 超過 366 天刪掉。
  - 帳本被剪掉之後，摘要還在。
- 回填：
  - 測試環境能不能模擬 `$.fs`，要先查 plugin-authoring 的測試說明。不能的話，把解析抽成純函式 `parseTranscript(text)` 和 `parseSubagent(meta, text)` 來測。
  - message.id 去重。
  - sidechain 不算進主 session。
  - 已有帳本的 session 不覆蓋。
  - `running` 標記會擋住第二個 session。
  - 單一檔案壞掉時，其餘照樣補。
- pane：
  - 不同寬度畫出的週數不同；不到 12 格不畫熱圖。
  - 打開某一列之後不顯示。
  - 點格子或按 `j`／`k` 後，期間變成那一天，數字換成那天的；`p` 回到原本的期間。
  - 沒有資料、沒有用量、有用量三種格子畫法不同；選到前兩種時顯示各自的灰字。
- `buildHeatmap`：沒有資料回傳 `null`，沒有用量回傳 0。

## 文件

- DESIGN.md：先寫熱圖的版面與色階。
- `docs/mods/subagent-dispatch.md`、`.zh-TW.md`：寫熱圖、回填、`backfill` 子指令，以及「已知限制」（只回填這台電腦、約 30 天）。
- ADR 0024：每日摘要用整行重算，不即時累加，也不拉長帳本保留期。
- ADR 0025：在 `session.start` 回填並留標記，因為沒有安裝事件。
- CHANGELOG 0.8.0，ROADMAP「查證結果」。
