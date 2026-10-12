# output-trimmer

[English](output-trimmer.md) | 繁體中文 · [所有 mod](../../README.zh-TW.md#mods)

Bash 指令印出太多內容時，只給模型開頭、結尾與錯誤行；完整輸出存成檔案，什麼都不會丟，context 也不會被建置 log 塞滿。

| 用模型 | CLI | Desktop | 雲端 |
| --- | --- | --- | --- |
| 否 | 是 | 是 | 否 |

## 做什麼

- Bash 輸出超過 150 行或 15k 字元（`max_lines`、`max_chars`）時，只給模型開頭、結尾與錯誤行。
- 完整輸出存到 `$TMPDIR/claude-output-trimmer/`，截短的結果會註明位置，toast 顯示省略了幾行。
- 讀檔類指令不處理。
- 指令加 `# notrim` 取得完整輸出。

## 設定

| key | 預設 | 範圍 | repo 檔案 | 意思 |
| --- | --- | --- | --- | --- |
| `max_lines` | 150 | 50–5000 | 可設定 | Bash 輸出超過這麼多行時截短 |
| `max_chars` | 15000 | 2000–200000 | 可設定 | 超過這麼多字元時同樣處理 |

`/output-trimmer status`、`set`、`unset` 查看與修改。分層見[設定](../settings.zh-TW.md)。

## 已知限制

- 只改模型讀到的內容，畫面上仍顯示完整輸出。
