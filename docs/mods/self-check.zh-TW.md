# self-check

[English](self-check.md) | 繁體中文 · [所有 mod](../../README.zh-TW.md#mods)

給 Claude 的防呆提醒，不擋使用者：抓出 Claude 原樣重試失敗的呼叫，以及沒驗證就說程式「完成」。

| 用模型 | CLI | Desktop | 雲端 |
| --- | --- | --- | --- |
| 否 | 是 | 是 | 否 |

## 做什麼

- **重複失敗**（`retry_nudge`）：同一個工具連續兩次因同樣原因失敗（錯誤文字去掉路徑與數字後相同）時，在第二次的結果後面請 Claude 先找出原因、不要原樣重試。
- **說完成卻沒驗證**（`done_check`）：這一輪改過程式檔（Edit／Write，不含 `.md` `.txt` 等文件、不含子代理改的）、之後沒跑測試、建置或檢查，回覆卻說完成時，擋下這次停止一次請 Claude 驗證。回覆已說明沒驗證的不擋。
- 出錯時跳過，不影響工具呼叫與停止。

## 設定

| key | 預設 | repo 檔案 | 意思 |
| --- | --- | --- | --- |
| `retry_nudge` | 開 | 可設定 | 重複失敗的提醒 |
| `done_check` | 開 | 可設定 | 說完成卻沒驗證的檢查 |

`/self-check status`、`set`、`unset` 查看與修改。分層見[設定](../settings.zh-TW.md)。

## 已知限制

- 擋下停止時，畫面會顯示成 Stop hook error（Claude Code 對 Stop hook `block` 的呈現），之後 Claude 會接著驗證。
- 用 Bash 改檔（`sed -i`、`python3`）還不算改過程式檔。
- 「完成」的判斷只看回覆的開頭與結尾是否有「完成了」「已修好」「all done」等說法，換個說法會漏掉。
