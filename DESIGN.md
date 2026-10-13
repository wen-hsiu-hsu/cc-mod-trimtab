# 介面規範

所有 mod 的畫面都照這份規範：顏色、版面、控制項、快捷鍵、用詞。新增或修改畫面時先對照這份文件；規範要改時先改這裡，再改程式。

畫的程式放在有畫面的 mod 各自的 `hooks/ui.tsx`（mod 不能 import 自己資料夾外的檔案），內容相同，由 `scripts/check-copies.sh` 檢查。目前有畫面的 mod：`subagent-dispatch`、`open-items`、`session-keeper`、`tool-guard`。只有 toast 和指令回應的 mod 不放 `ui.tsx`，照下面的「Toast」與「用詞」即可。

## 畫面種類

| 種類 | 用途 | 例子 |
| --- | --- | --- |
| Band（`AbovePrompt`） | 一兩行狀態或提問，畫在輸入框上方 | subagent-dispatch 中斷提醒、open-items 計數、session-keeper 快取列 |
| Pane | 要瀏覽或操作的內容 | subagent-dispatch 用量、open-items 清單 |
| 確認框（Pane） | 擋住 Claude、等使用者回答 | tool-guard 確認執行 |
| Toast | 發生了一件事，看過就好 | 遮蔽了密鑰、省略了輸出 |
| `ui.log` | 留在 transcript 裡的事件 | self-check 擋下「說完成卻沒驗證」 |
| status | 沒有 Band 的介面（不是 terminal、desktop）才顯示 | 背景 agent 數 |

## 顏色

### 語意色

終端機用 Ink 色名。顏色只加強，不單獨表達意思：文字本身要說得出狀態。

| 色 | 意思 | 用在 |
| --- | --- | --- |
| `yellow` | 要你處理：等你決定、等你確認 | band 的提問、確認框外框、`warn` 狀態 |
| `red` | 出錯、中斷、有風險 | 中斷的 agent、確認框的影響摘要、`hot` 狀態 |
| `dimColor` | 次要資訊 | 標籤、說明、提示列、空狀態、列上的按鈕 |
| `bold` | 數字總計、目前的位置 | 卡片總數、打開的那一列、切換鈕目前的值 |

不要用顏色表示「選到」：切換鈕目前的值用 `bold`，不用 `yellow`。

**鍵**：提示列的「鍵 動作」裡，鍵本身不加 `dimColor`，說明才加，讓眼睛先掃到鍵。例如 `d 完成` 的 `d` 是預設色，`完成` 是 `dimColor`。有 hotkey 的 `plain` 按鈕，終端機自己會在前面畫 `鍵: `（顏色是終端機的），不要再自己寫一次。

### 種類色

清單上的種類欄依種類上色，沿用語意色的意思；種類的字照樣寫出來，顏色只加強。

| 種類 | ink | 理由 |
| --- | --- | --- |
| `待決定` | `yellow` | 等你決定 |
| `bug` | `red` | 出錯 |
| `問　題` | `cyan` | 還沒答案，但不必馬上處理 |
| `延　後` | `dimColor` | 先放著 |

關掉的列（`strikethrough`）和超過 7 天的列，種類一律 `dimColor`。

計數長條和圖例也用這幾個顏色，順序同上表（待決定、bug、問題、延後）。延後在長條上是 `gray` 底色（`dimColor` 畫不出底色），desktop 依序是 `#c98a12`、`#c0504d`、`#2f8fb0`、`#8b8b93`。「最近 7 天完成」清單只用灰色系：完成 `white`（`#8b8b93`），不做 `gray`（`#4a4a4a`）。

### 資料色票

畫長條和圖例時，一個來源一個顏色，所有 mod 共用。終端機用 `ink`，desktop 的 `Svg` 用 `fill`。

| key | 意思 | ink | fill |
| --- | --- | --- | --- |
| `main` | 主 session | `magenta` | `#8a5cc7` |
| `sub` | subagent | `cyan` | `#2f8fb0` |
| `named` | 指定模型 | `yellow` | `#c98a12` |
| `default` | 沿用預設 | `gray` | `#8b8b93` |
| `fork` | fork | `green` | `#3f9a4f` |

同一個來源要再分（例如主 session 的各模型）時，用同色系輪流（`magenta`、`magentaBright`）。圖例一定有文字標籤。

## 版面

- **依 `e.props.bodyColumns` 排版**，不用 `padEnd` 補空白（中文字佔兩格）。欄位對齊用固定 `width` 的 `Box`，數字欄加 `justifyContent="flex-end"`。
- **斷點**：
  - 80 欄以上：一筆資料一行，表格上方加欄名列。
  - 60 欄以上：兩張卡並排，各佔 `floor((body - 2) / 2)`，中間 `gap={2}`。
  - 更窄：卡片上下排，長條另起一行。
- **間距**：
  - 同一行的文字片段：`gap={1}`；會折行的一排片段用 `columnGap`。
  - 一排按鈕：`gap={2}`。
  - 段落之間：`marginTop={1}`，不用空行。
  - 子項縮排：`paddingLeft`，數值對齊上一層的欄寬。
- **卡片**：`borderStyle="round" borderDimColor paddingX={1}`，標題 `dimColor`、總數 `bold`。
- **確認框外框**：`borderStyle="round" borderColor="yellow" paddingX={1}`。
- **單邊線**：Box 不能只畫一邊的邊框，要左側線就在每行前放一個上色的 `│`。
- **長條**：
  - 終端機：有底色的空格（`backgroundColor`），不用 `█`。
  - desktop：`Svg`。判斷用 `e.surface !== 'terminal'`，不看 `'Svg' in parts`（runtime 一律提供所有元件）。
  - 有值的部分至少一格。
- **標題列**（open-items pane）：最上面一行，`bold` 的 mod 名稱，空一格，後面一條 `dimColor` 的 `─` 填滿其餘寬度（依 `e.props.bodyColumns`），下面空一行。
- **計數列**：標題列下面，取代卡片（比卡片省高度）。
  - 第一行：`bold` 的總數，空一格，後面是填滿其餘寬度的比例長條，每個種類一段，顏色見「種類色」。
  - 第二行是圖例，縮排對齊長條的起點：`● 待決定 2`，`●` 上種類色，種類字 `dimColor`，數字 `bold`，項目之間空兩格，`wrap="wrap"`。數量是 0 的種類不畫。
  - 沒有項目時：總數 `0` 加 `dimColor`，長條是一整條 `gray` 底色，圖例換成一行 `dimColor` 的 `Resolved in the last 7 days: N`／`最近 7 天完成 N 項`（N `bold`）。
- **全文清單**（焦點列動作的清單，open-items）：不分斷點，要能塞進 55 欄（dock 時的 body 寬）。
  - 每一項都展開全文，下面一行 `dimColor` 的時間與 branch，用 ` · ` 隔開；項目之間空一行。全文依 `e.props.bodyColumns` 自己折行（中文算兩格），一行一個 `Box`，因為分組時每一行前要放 `│`。
  - id 是固定欄寬的一欄（按鈕，見「焦點列動作」），內文在它右邊折行，不回到 id 底下。
  - 種類用短字樣：`待決定`／`問　題`／`延　後`／`bug`，英文 `Decide`／`Question`／`Deferred`／`Bug`。兩個字的中文中間放一個全形空格，跟三個字的對齊。
  - **依種類分組**（預設）：組的順序是待決定、bug、問題、延後。最左一欄寫種類（種類色），右邊一條同色的 `│`（單邊線）從組的第一行畫到最後一行，連項目之間的空行也畫，把整組框成一塊；列上不再寫種類。組與組之間空一行。
  - 延後的組預設收起（只剩延後一組時不收），只畫一行 `m: Show N ▸`／`m: 展開 N 項 ▸`（`plain` 按鈕，hotkey `m`）；展開後最後一行是 `m: Hide`／`m: 收起`。
  - **不分組**：一行三欄：id、種類（種類色）、內文。
  - **依 branch 分組**：組名一行，`bold` 的 branch 名，後面 `dimColor` 的數量；目前的 branch 排第一，寫成 `current · N`／`目前 · N`，其他組依排序後第一次出現的順序。組底下每一行前放 `dimColor` 的 `│`，接 id、種類、內文；灰字只寫時間。沒有 branch 的項目組名是 `no branch`／`沒有 branch`。
  - 清單上方一行：左邊是切換鈕（清單 `v`、分組 `g`、排序 `s`），右邊是作用在整份清單的按鈕（`c: Copy all`／`c: 複製全部`）。都是有 hotkey 的 `plain` 按鈕（見「提示列」）；放不下時整排折行（`flexWrap="wrap"`，`columnGap={2}`）。
  - 空清單只留 `v`，不畫 `g`、`s`、`c`。
  - **最近 7 天完成**：同一份 repo 裡 7 天內完成或不做的項目（7 天和「超過 7 天變淡」同一個門檻），不分組，只有 `v` 和 `s`。種類欄換成結果（`完　成`／`不　做`，英文 `Done`／`Won't do`，`dimColor`），內文 `dimColor`，有決定或理由時接在內文後面（`內文 → 理由`）；灰字是「完成多久以前 · 種類 · branch」。計數列分完成、不做兩段。

## 控制項

- **按鈕裡只放文字**，不放 `Box`。
- **Band 的按鈕**：預設 variant，每顆都有 hotkey。
- **Pane 清單列上的操作按鈕**（略過、打開某一列）：`plain dimColor`，可以沒有 hotkey。返回、更多、切換這類導覽按鈕一律要有（見「快捷鍵」）。
- **焦點列動作**：每一列的動作都一樣時（open-items 的完成、不做、引用），不在每列放按鈕，改成清單下方一排，作用在焦點所在的那一列：
  - 每一列只有 id 是一顆 `plain` 按鈕（label 就是 id），`key` 寫成 `row:<id>`，Tab／↑↓ 在列之間移動。不把整行做成按鈕：按鈕裡不能放 `Box`，焦點列折行時對不齊內文那一欄。
  - 用 `ui.focus` 記下焦點在哪一列；焦點不在任何一列時，按動作不做事。
  - 動作按鈕 `plain`，每顆都有 hotkey，終端機畫成 `d: 完成  x: 不做  q: 引用`，放在清單下方 `marginTop={2}`（空兩行，跟清單分開），`gap={2}`。提示列不再列這些動作。
  - 動作列和提示列置底：清單後面放一個 `flexGrow={1}` 的空 `Box`；pane 在 dock 時（`e.props.placement === 'dock'`），最外層 `Box` 設 `minHeight={e.props.scroll.bodyRows}` 撐滿高度。inline 的 pane 外框跟著內容高度，不撐。
  - 關掉的列留在原位：`dimColor` 加 `strikethrough`，文字前加狀態（`Done`／`完成`、`Won't do`／`不做`），焦點不動；再按一次同一個動作就復原。切換清單或重開 pane 時才移走。
  - 「最近 7 天完成」清單的動作是重新打開（`d`）和引用（`q`）：重新打開的列一樣留在原位，結果欄空白，文字前加 `Reopened`／`重新打開`。
  - 焦點所在的那一列，id 由終端機畫成反白；列不另外展開（每一列本來就是全文）。
  - 不用 `$.ui.focus` 把焦點搬到下一列：實測焦點會落在剛按的動作按鈕上，或跳過一列。
- **切換**：不用下拉的 `Select`，它展開時會把下方畫面往下推。用 `ui.tsx` 的 `switcher`：
  - 終端機：一顆 `plain` 按鈕「‹ 值 ›」，按一次換下一個值，最後一個之後回到第一個，hotkey 也做同樣的事。
  - desktop：一排分段按鈕，目前的值 `variant="primary"`，其他 `dimColor`，hotkey 掛在目前值的下一顆。
- **確認框**：`plain` 按鈕，執行在前、取消在後，取消 `autoFocus`（預設拒絕）。旁邊一行 `dimColor` 說明 Claude 在等。沒辦法放 pane 時改用 `$.ui.ask`，取消放第一個選項。

## 快捷鍵

Pane 和 Band 上所有導覽按鈕和焦點列動作都要有 hotkey，並列在提示列（`plain` 按鈕上已經畫出 `鍵: ` 的除外）。每列各自的操作按鈕（略過、打開某一列）可以沒有。

| 鍵 | 動作 | 用在 |
| --- | --- | --- |
| `b` | 返回上一層 | subagent-dispatch |
| `m` | 顯示更多（open-items：展開、收起延後的組） | subagent-dispatch、open-items |
| `p` | 切換期間 | subagent-dispatch |
| `g` | 切換分組 | subagent-dispatch、open-items（依種類／不分組／依 branch） |
| `s` | 切換排序 | subagent-dispatch、open-items（舊到新／新到舊） |
| `c` | 複製全部 | open-items |
| `d` | 完成焦點那一列（最近 7 天完成清單：重新打開） | open-items |
| `x` | 不做焦點那一列 | open-items |
| `q` | 引用焦點那一列到輸入框 | open-items |
| `v` | 切換清單（未完成／最近 7 天完成） | open-items |
| `o` | 打開 pane | open-items band |
| `u` | 復原 | open-items band |
| `r` | 重派 | subagent-dispatch band |
| `d` | 略過這次提醒 | subagent-dispatch band |
| `h` | 交接到新 session | session-keeper band |
| `k` | 留在這裡繼續 | session-keeper band |
| `1`／`2` | 執行／取消 | 確認框（和 Claude Code 內建權限提示的 1 Yes、2 No 一致） |

- 同一個動作在每個 mod 用同一個鍵；新動作先查這張表，再加進來。
- 確認框用數字，其他一律用小寫字母。
- 不用 `Esc`、`Tab`、`Enter`、方向鍵：它們留給 pane 的焦點移動和關閉。
- 只有 Tab 和 ↑↓ 會移動焦點；←→ pane 不會攔下，按了會切到別的 session，不要指望它。
- `d` 在 subagent-dispatch band 是「略過這次提醒」，在 open-items pane 是「完成」。兩者同時出現時哪一個收到 `d` 還沒實測。

## Pane

- **開啟**：`$.ui.open({ id, title, focus: true, closeOnEscape: true })`。確認框不加 `closeOnEscape`，要明確按下執行或取消。
- **標題**：mod 名稱開頭，要說明用途時接一個名詞，用 `pick`，例如 `subagent-dispatch usage`／`subagent-dispatch 用量`、`tool-guard confirm`／`tool-guard 確認`。只有一個 pane、用途就是 mod 名稱時只寫 mod 名稱（`open-items`）。
- **提示列**：放在最下面，`marginTop={1}`，`<Text dimColor wrap="wrap">`。用 `ui.tsx` 的 `hintLine` 產生：
  - 每項寫成「鍵 動作」，項目之間用 ` · ` 分隔。
  - 最後一項是 `Esc closes`／`Esc 關閉`（確認框不列）。
  - `plain` 按鈕上已經畫出 `鍵: ` 的（例如 `v: ‹ 未完成 ›`），提示列不再列。
  - 有焦點列動作的清單，動作和切換都在按鈕前寫了鍵，提示列只剩 `Tab/↑↓ moves · Esc closes`／`Tab/↑↓ 移動 · Esc 關閉`；空清單只剩 `Esc 關閉`。
  - 按鈕上已經寫了動作的，寫成「‹ Back (b) returns」。
- **空狀態**：`<Text dimColor wrap="wrap">`，一句話說沒有什麼，需要時在括號裡說明什麼時候會出現。例如 `No open items (…).`、`No usage recorded yet (…).`。有計數列的 pane 照樣畫計數列（見「版面」的計數列）。

## Band

- 一行為主，文字用 `wrap="truncate-end"`，太長就截掉。
- 文字顏色依「語意色」：提問用 `yellow`，出錯或中斷用 `red`，狀態用 `dimColor`。
- 臨時開啟的功能，每個 mod 一行灰字（`<mod> on · <key> 1h42m`），畫在自己那段的最上面。
- `e.props.hasSurvey` 時讓位，不畫。
- 疊上 `next(e)` 的結果，不取代別人的 band。

## Toast

- 前綴 `<mod>: `（英文）／`<mod>：`（中文全形冒號），每一則都有前綴，失敗的也一樣。
- 句子描述發生了什麼；需要使用者做事時，在後面接指令，例如 `；關閉：/session-keeper off keep_warm`。
- 擋下類的寫成 `<mod>: blocked <什麼>`／`<mod>：擋下 <什麼>`。
- 時長：
  - 帶有後續動作（指令、復原）的：`timeoutMs: 8000`。
  - 其他不設，用預設值。
- `/<mod>` 註冊失敗時一定要跳 toast：`<mod>: /<mod> was not registered (<原因>)`。

## 用詞

- 畫面上看得到的字一律用 `pick(lang, { en, 'zh-TW': … })`，包括 pane 標題、`argumentHint`、toast 和空狀態。
- 下列保留英文，當成技術用語，不翻譯：
  - 名詞：`session`、`subagent`、`fork`、`repo`、`token`、`hook`、`pane`。
  - 快取列：`cache`、`warm`、`cold`、`kept`、`hit`、`miss`、`left`。
  - 臨時開啟灰字裡的 `on`。
  - 單位：時間的 `s`／`m`／`h`，數量的 `k`／`M`，大小的 `KB`／`MB`。
- 英文只有句首大寫，不用 Title Case（`Group by`、`Open items`，不是 `Group By`、`Open Items`）。
- 完整句子加句號（空狀態、指令回應），標籤和按鈕不加。

## 日期與數字

| 種類 | en | zh-TW | 程式 |
| --- | --- | --- | --- |
| 日期 | `Oct 12` | `10/12` | subagent-dispatch `ledger.ts` 的 `monthDay` |
| 日期加時間 | `Oct 12 02:11` | `10/12 02:11` | `stamp` |
| 區間 | `Sep 13 – Oct 12` | `9/13 至 10/12` | `range` |
| 多久以前 | `just now`、`5 min ago`、`3 h ago`、`2 d ago` | `剛剛`、`5 分鐘前`、`3 小時前`、`2 天前` | open-items `items.ts` 的 `ageText` |
| 時間長度 | `12s`、`3m05s`、`1h02m` | 同左 | `elapsed`、`fmtDuration`、`fmtLeft` |
| Pane 裡的數字 | `12,345` | 同左 | `n` |
| Band 裡的數字 | `1.2k`、`3M` | 同左 | session-keeper `meter.ts` 的 `fmtTokens` |

- 檔案內容和給模型的文字用 `YYYY-MM-DD HH:MM`，不受這張表限制。
- 百分比四捨五入成整數。

## 符號

| 符號 | 用法 |
| --- | --- |
| `‹ ›` | 切換鈕的值、返回鍵（`‹ Back`） |
| `▸` | 還有更多（`5 more ▸`） |
| `●` | 圖例和列前的色點 |
| `│` | 單邊線 |
| `─` | 標題列的分隔線 |
| `·` | 分隔項目（提示列、band 片段） |
| `→` | 流向（從哪個模型變成哪個） |

不用 emoji，也不用 `█`、`✓`、`✗` 當狀態：狀態用文字說。
