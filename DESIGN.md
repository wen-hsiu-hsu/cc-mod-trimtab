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

不要用顏色表示「選到」：切換鈕目前的值用 `bold`，不用 `yellow`。唯一的例外是期間只有 1 天時熱圖上的那一格（見下方「熱圖色階」）：`■` 加粗看不出差別，格子只能靠顏色標出來，下方的標註行再用文字（`▲ 10/02（五）`）說一次。

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

### 熱圖色階

subagent-dispatch stats 的日曆熱圖，一格一天。`Text` 的 `color` 吃 hex（型別檔 `Color`：「a raw color (a name such as "red", or hex)」），所以終端機和 desktop 用同一組值。

| 格子 | 終端機 | desktop（`Svg`） |
| --- | --- | --- |
| 沒有資料 | `dimColor` 的 `·`，不畫 `■` | 虛線外框，不填色 |
| 沒有用量 | `#4a4a52` 的 `■` | `#8b8b93`（`default.fill`）25% 實心 |
| 有用量 1–4 級 | `#1f5a6d`、`#2a7f9c`、`#3aa6cc`、`#86d6f0` 的 `■` | `#2f8fb0`（`sub.fill`），透明度依級數 35%、55%、75%、100% |
| 期間只有 1 天時的那天 | `bold` 的 `#ff8c42` `■` | `#ff8c42` 實心 |
| 今天以後 | 空白 | 不畫 |

- 級數依畫出來的那幾週裡有用量的日子分四分位：≤ 第一四分位 1 級，以此類推。寬度改變時週數變，顏色可能跟著變。
- 青色系越亮越多，跟資料色票的 `sub` 同一色系。1 天的期間用橘色，是青色的互補色，一眼跳出來。

## 版面

- **依 `e.props.bodyColumns` 排版**，不用 `padEnd` 補空白（中文字佔兩格）。欄位對齊用固定 `width` 的 `Box`，數字欄加 `justifyContent="flex-end"`。
- **斷點**：要依寬度增減的表格（subagent-dispatch stats 總覽清單）不用固定斷點，改成依欄位的重要程度省略（見「欄位清單」）。
- **間距**：
  - 同一行的文字片段：`gap={1}`；會折行的一排片段用 `columnGap`。
  - 一排按鈕：`gap={2}`。
  - 段落之間：`marginTop={1}`，不用空行。
  - 子項縮排：`paddingLeft`，數值對齊上一層的欄寬。
- **卡片**：`borderStyle="round" borderDimColor paddingX={1}`，標題 `dimColor`、總數 `bold`。
- **確認框外框**：`borderStyle="round" borderColor="yellow" paddingX={1}`。
- **單邊線**：Box 不能只畫一邊的邊框，要左側線就在每行前放一個上色的 `│`。
- **長條**：
  - 終端機：上下隔著文字的長條（摘要）用有底色的空格（`backgroundColor`）；上下相鄰的長條（清單的每一列）用前景色的 `▆`（下 6/8 方塊），不用佔滿整格高度的字元，讓兩列之間留一道空隙。都不用 `█`。
  - 只有上下相鄰的長條才用 `▆`：它在格子裡偏下，上方留空、下方貼著下一行，摘要這類長條改用它時，下一行的字看起來會跟上面的長條是一組。
  - desktop：`Svg`。判斷用 `e.surface !== 'terminal'`，不看 `'Svg' in parts`（runtime 一律提供所有元件）。
  - 有值的部分至少一格。
  - `▆` 和 `■` 一樣是 East Asian Ambiguous 寬度：終端機設成「ambiguous 當全形」時會錯位。
- **標題列**（open-items pane、subagent-dispatch stats pane）：最上面一行，`bold` 的 mod 名稱，空一格，後面一條 `dimColor` 的 `─` 填滿其餘寬度（依 `e.props.bodyColumns`），下面空一行。subagent-dispatch stats 在最右邊放 `dimColor` 的 `更新於 19:04:05`／`Updated 19:04:05`（讀用量的時間），放不下時只寫時間。
- **清單上方的橫線**（subagent-dispatch stats 打開一列後）：清單和上面的摘要之間一條 `dimColor` 的 `─` 填滿 `e.props.bodyColumns`，橫線下第一行是排序的切換鈕。
- **摘要**（subagent-dispatch stats 總覽與打開一列後）：不用卡片框，一個數字兩行。
  - 第一行：左邊是 `bold` 的總數（`k`／`M` 縮寫）加 `dimColor` 的單位（`token`、`次派出`／`spawns`），右邊是組成：`主 8.4M  sub 4.0M`、`指定 14 預設 24 fork 8`，名稱上資料色票的 `ink`，項目之間空兩格。右邊放不下時不畫。
  - 第二行：填滿整行寬度的長條，每個組成一段。
  - 派出是 0 時不畫派出那兩行。最後一行 `dimColor` 的 `快取讀取 182M 另計`／`Cache read 182M, not counted`。
  - 打開依 session 分組的一列時，token 那行右邊依模型列出主 session 的用量（各模型同色系輪流），後面接 `sub`。
- **欄位清單**（subagent-dispatch stats 總覽的四種分組）：一列一行，不用卡片框。
  - 第一行是欄名列：最左邊是分組的切換鈕，各欄的欄名 `dimColor` 對齊各欄；欄名列下面一條 `dimColor` 的 `─`。
  - 左右順序：名稱、token、佔比、長條、sub、派出、指定/預設/fork、分組自己的兩欄、快取讀取。欄與欄之間空兩格，數字靠右，各欄寬度是欄名與每一列值裡最寬的。最後一欄貼齊右邊，多出來的寬度留在名稱欄後面。
  - 分組自己的兩欄：repo 是 `session`（session 數）、`上次`；session 是 `repo`（靠左，最寬 14 欄）、`開始`；模型與種類是 `平均/次`（每次派出的平均 token，沒有派出寫 `—`）、`上次`。「上次」是期間內這一列最後一次有 token 用量的日期，取自用量明細的 step 與派出。
  - 依寬度省略：名稱欄至少留 16 欄（也要放得下分組的切換鈕），其餘依重要程度由高到低放進去：token、派出、長條、佔比、sub、分組自己的兩欄、指定/預設/fork、快取讀取。遇到第一個放不下的欄位就停，不跳過它去放後面的。依 repo 分組時大約 110 欄全部放得下。
  - 長條寬度是 `bodyColumns` 的 12%，介於 6 到 14 欄，主 session 與 subagent 兩段（`▆`，見「長條」），長度依這一列 token 與最多那一列的比例。
  - 名稱是一顆 `plain` 按鈕，打開這一列；依顯示寬度先截好，再少兩格（見「控制項」）。依 session 分組時名稱是第一則 prompt。
  - 一次列 10 列，其餘用 `m: 還有 N 筆 ▸` 再列 10 列。
- **麵包屑**：`b: ‹ 返回`、`分組 ›` 都 `flexShrink={0}`，只有後面的名稱 `truncate-end`，名稱再長也不讓前面折行。
- **提示列置底**：清單後面放一個 `flexGrow={1}` 的空 `Box`；pane 在 dock 時（`e.props.placement === 'dock'`），最外層 `Box` 設 `minHeight={e.props.scroll.bodyRows}` 撐滿高度，提示列（有焦點列動作時連同動作列）落在最下面。inline 的 pane 外框跟著內容高度，不撐。
- **計數列**：標題列下面，取代卡片（比卡片省高度）。
  - 第一行：`bold` 的總數，空一格，後面是填滿其餘寬度的比例長條，每個種類一段，顏色見「種類色」。
  - 第二行是圖例，縮排對齊長條的起點：`● 待決定 2`，`●` 上種類色，種類字 `dimColor`，數字 `bold`，項目之間空兩格，`wrap="wrap"`。數量是 0 的種類不畫。
  - 沒有項目時：總數 `0` 加 `dimColor`，長條是一整條 `gray` 底色，圖例換成一行 `dimColor` 的 `Resolved in the last 7 days: N`／`最近 7 天完成 N 項`（N `bold`）。
- **日曆熱圖**（subagent-dispatch stats 總覽）：標題列下面、`期間` 那一行上面；打開某一列之後不畫。格子的顏色只表示用量，不跟著期間改變：期間以外的格子不調暗，因為 Ink 的 `dimColor` 會把青色混成灰色，看起來跟「沒有用量」一樣；期間只靠標註行的括號標出，1 天時那格用橘色。由上而下：
  - 月份列：左邊空 4 格，在每個月第一次出現的那一欄（那週的週日落在新的月份）標 `Jul`／`7月`。第一欄只在週一剛好是 1 號時標。
  - 7 列格子，週一在最上面，左邊 4 格寫 `Mon`／`Wed`／`Fri`（`一`／`三`／`五`），`dimColor`。一欄一週，今天落在最後一欄。終端機每一列是一個 `Text`，每格是裡面一段上色的字（沒有 `key`，測試用列與週的位置找格子），格與格之間空 1 格，所以一週佔 2 欄。格子不是按鈕：371 顆按鈕讓縮放時的重畫太慢，Tab 也要先走過所有格子（見 ADR 0026）。
  - 週數 = `min(53, floor((bodyColumns - 4) / 2))`，至少 4 週：80 欄 38 週，110 欄 53 週。`bodyColumns` 不到 12 不畫。
  - 標註行：期間標記與圖例共用一行。
    - 期間多天時，用 `└──── 30 天 ────┘` 標出期間涵蓋的週（期間第一天那週到最後一天那週；第一天在熱圖以前時從第一欄起）；括號裡放不下長度時只畫 `└───┘`，只有一欄時畫 `▲`。期間 1 天時，在那一欄下面用 `bold` 的 `#ff8c42` 寫 `▲ 10/02（五）`／`▲ Fri Oct 2`；靠右放不下時改成 `10/02（五） ▲`，`▲` 仍對齊那一欄。期間在熱圖範圍以外時不畫標記。
    - 圖例依序是 `少 ■■■■ 多`、`無用量 ■`、`無資料 ·`、`最多 10/02 1.2M`（`Less ■■■■ More`、`None ■`、`No data ·`、`Most Oct 2 1.2M`），字 `dimColor`、格子用色階，項目之間空兩格。遇到放不下的那一項就停，不跳過它去放後面的。先試標記左邊（從第 4 欄起，跟標記隔兩格），一項都放不下時整組移到標記右邊、靠右對齊，兩邊都放不下就不畫。大約 80 欄全部放得下，55 欄放到「無資料」，40 欄放到「無用量」。
    - 「最多」是畫出來的那幾週裡最多的一天，不跟著期間變。數字用 `k`／`M` 縮寫（band 的寫法）。
  - 下面空一行，接 `期間` 那一行。
  - desktop：同樣的週數畫成一張 `Svg`（格子 10px、間距 2px，月份標在上方）。格子的顏色同樣不跟著期間改變；期間括號、長度和 1 天的 `▲ 10/14（三）` 都畫在 Svg 裡、格子下面（Svg 的寬度跟欄寬對不上，不能用文字行對齊）。圖例是 Svg 下面的一行文字，項目同上。
  - `■` 是 East Asian Ambiguous 寬度：終端機設成「ambiguous 當全形」時格子會錯位。
- **期間**（subagent-dispatch stats 總覽）：熱圖下面一行 `期間 p: ‹ 30 天 ›  h: ‹ 09/15 – 10/14 l: ›`，最右邊一直有 `t: 今天`（`Period`、`Today`）。格子不能點。
  - `p` 依序切換 1／7／30／90 天，期間的最後一天不變。`stats` 給了其他天數（例如 14）時，它照大小排進選項裡，按 `p` 之後就不再出現。
  - `h`／`l` 一次移一個期間長度（1 天移 1 天、7 天移一週）；`l` 移到今天為止，`h` 移到熱圖最多保存的 366 天為止。
  - `t` 直接跳到「今天這 1 天」。
  - 日期 `bold`；期間 1 天時用 `#ff8c42`，是今天時前面加 `今天 `／`Today, `。
  - 太窄時依序省略：先拿掉 `期間 `，再把日期寫成 `09/15–10/14` 並把中間的兩格空白縮成一格。還是放不下時 `t` 折到下一行。
  - 摘要與清單都換成這個期間。期間沒有用量或沒有資料時，摘要的位置改成一句 `dimColor`：`10/11（日）沒有用量。`、`05/17（日）沒有資料。`（多天時日期寫成 `09/15 – 10/14 `），不畫清單；整份用量都還沒有紀錄時改用空狀態的長句。期間全在用量明細保存的 90 天以前時，摘要照畫（取自每日摘要），清單的位置改成 `06/25 – 07/01 的詳細資料保存超過 90 天，已刪除。`。
- **打開一列之後**（subagent-dispatch stats）：標題列、麵包屑 `b: ‹ 返回  repo › 名稱`、只顯示不能操作的期間行 `期間 30 天 · 09/15 – 10/14`（1 天時 `期間 1 天 · 10/14（三）`）、摘要（見「摘要」）。下面是清單上方的橫線、排序、欄名列、派出清單、`m: 還有 N 筆 ▸`、提示列。
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
- **按鈕的文字自己截斷**：`Button` 裡的 `truncate-end` 在中英混合時會折行，不能靠它。依顯示寬度先截好（中文算兩格，結尾 `…`，見 subagent-dispatch `ledger.ts` 的 `fit`），再比可用寬度少兩格；同一行右邊要保留的字放在固定寬度、`flexShrink={0}` 的 `Box`。見 ROADMAP「查證結果」16。
- **Band 的按鈕**：預設 variant，每顆都有 hotkey。
- **Pane 清單列上的操作按鈕**（略過、打開某一列）：`plain dimColor`，可以沒有 hotkey。返回、更多、切換這類導覽按鈕一律要有（見「快捷鍵」）。
- **焦點列動作**：每一列的動作都一樣時（open-items 的完成、不做、引用），不在每列放按鈕，改成清單下方一排，作用在焦點所在的那一列：
  - 每一列只有 id 是一顆 `plain` 按鈕（label 就是 id），`key` 寫成 `row:<id>`，Tab／↑↓ 在列之間移動。不把整行做成按鈕：按鈕裡不能放 `Box`，焦點列折行時對不齊內文那一欄。
  - 用 `ui.focus` 記下焦點在哪一列；焦點不在任何一列時，按動作不做事。
  - 動作按鈕 `plain`，每顆都有 hotkey，終端機畫成 `d: 完成  x: 不做  q: 引用`，放在清單下方 `marginTop={2}`（空兩行，跟清單分開），`gap={2}`。提示列不再列這些動作。
  - 動作列和提示列置底（見「版面」的提示列置底）。
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
| `p` | 切換期間長度 | subagent-dispatch |
| `h` | 期間往前移一個長度 | subagent-dispatch |
| `l` | 期間往後移一個長度 | subagent-dispatch |
| `t` | 跳到今天這 1 天 | subagent-dispatch |
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
- `d` 在 subagent-dispatch band 是「略過這次提醒」，在 open-items pane 是「完成」。兩者不衝突：hotkey 只在有焦點的區塊生效，band 和 pane 是不同區塊，同一時間只有一個有焦點。只有同一個區塊裡兩顆按鈕用同一個鍵時才會後畫的贏，所以 band 的鍵在所有 mod 間不可重複。`h` 在 session-keeper band 是「交接到新 session」，在 subagent-dispatch stats pane 是「期間往前移」，同理不衝突。

## Pane

- **開啟**：`$.ui.open({ id, title, focus: true, closeOnEscape: true })`。確認框不加 `closeOnEscape`，要明確按下執行或取消。
- **標題**：mod 名稱開頭，要說明用途時接一個名詞，用 `pick`，例如 `subagent-dispatch usage`／`subagent-dispatch 用量`、`tool-guard confirm`／`tool-guard 確認`。只有一個 pane、用途就是 mod 名稱時只寫 mod 名稱（`open-items`）。
- **提示列**：放在最下面，`marginTop={1}`，`<Text dimColor wrap="wrap">`。用 `ui.tsx` 的 `hintLine` 產生：
  - 每項寫成「鍵 動作」，項目之間用 ` · ` 分隔。
  - 最後一項是 `Esc closes`／`Esc 關閉`（確認框不列）。
  - `plain` 按鈕上已經畫出 `鍵: ` 的（例如 `v: ‹ 未完成 ›`），提示列不再列。
  - subagent-dispatch stats 的期間、平移、今天、分組、排序、更多、返回都是畫出鍵的 `plain` 按鈕，提示列只剩 `Tab moves · Enter opens a row · Esc closes`／`Tab 移動 · Enter 打開一列 · Esc 關閉`（沒有列可以打開時拿掉 Enter；打開一列後是 `Tab 移動 · Enter 展開一筆 · Esc 關閉`）。
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
| stats pane 的日期 | `Oct 2`、`Sat Oct 11` | `10/02`、`10/11（日）` | `shortDay`、`dayHead` |
| stats pane 的區間 | `Sep 15 – Oct 14`（窄：`Sep 15–Oct 14`） | `09/15 – 10/14`（窄：`09/15–10/14`） | `span` |
| 多久以前 | `just now`、`5 min ago`、`3 h ago`、`2 d ago` | `剛剛`、`5 分鐘前`、`3 小時前`、`2 天前` | open-items `items.ts` 的 `ageText` |
| 時間長度 | `12s`、`3m05s`、`1h02m` | 同左 | `elapsed`、`fmtDuration`、`fmtLeft` |
| Pane 裡的數字 | `12,345`（subagent-dispatch stats 的摘要、清單與圖例用 `1.2k`、`3M`） | 同左 | `n` |
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
| `■` | 熱圖的一格（有紀錄的日子） |
| `▲` | 熱圖標註行指向 1 天的期間那一欄 |
| `└─┘` | 熱圖標註行框出期間涵蓋的週 |
| `▆` | 上下相鄰的清單長條 |

不用 emoji，也不用 `█`、`✓`、`✗` 當狀態：狀態用文字說。
