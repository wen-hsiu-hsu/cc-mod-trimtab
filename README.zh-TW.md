# cc-mod-trimtab

[English](README.md) | 繁體中文

**讓 Claude Code 不弄丟你的工作、不外流你的密鑰、不浪費你的 token 的小型 mod。**

trim tab（配平片）是舵上那片小小的板子，用很小的力氣帶動整艘船。這些 mod 也一樣：每個只是幾個 hook，平常安靜待在 session 裡，只在快要出錯的那一刻介入。要哪個裝哪個，彼此不互相依賴。

- **少出錯**：危險的 git 與 `rm` 指令執行前，先列出會毀掉什麼；Claude 改完程式要說完成前，會被要求先驗證。
- **省 token**：過長的指令輸出先截短再給模型讀；開啟 `session-keeper` 後，離開座位時 prompt cache 保持溫熱，context 太大時建議交接到新 session，不硬撐。
- **容錯**：被中斷的背景 agent 按一個鍵就重派；待決定的問題撐過 `/clear`；開啟 `project-memory` 後，這個 session 學到的事，下個 session 還在。
- **不多送資料、不偷偷花錢**：mod 不連到任何自己的服務。少數會呼叫模型的功能經由 Claude Code 本身的模型 API、用你的帳號，而且預設關，你打開才會用。

## Mods

| Mod | 幫你做什麼 |
| --- | --- |
| [`secret-scrub`](docs/mods/secret-scrub.zh-TW.md) | 送出前遮蔽 prompt 裡的 API key、token 與私鑰，不進 transcript，也不進 prompt cache。 |
| [`tool-guard`](docs/mods/tool-guard.zh-TW.md) | 攔下 `git reset --hard`、force push、`rm -rf` 與 migration，列出確切會丟掉哪些檔案或 commit（或會跑哪些 migration），讓你決定；不會造成損失的直接放行。 |
| [`output-trimmer`](docs/mods/output-trimmer.zh-TW.md) | Bash 指令印出上千行時，模型只讀開頭、結尾與錯誤行，完整輸出存成檔案。 |
| [`subagent-dispatch`](docs/mods/subagent-dispatch.zh-TW.md) | 被中斷的背景 agent 按一個鍵就重派，並列出 token 花在哪：主 session、subagent、各模型、每一次派出。 |
| [`open-items`](docs/mods/open-items.zh-TW.md) | 把待決定的問題與延後的項目存在 context 之外，在輸入框上方顯示數量，按一個鍵就引用回來。 |
| [`session-keeper`](docs/mods/session-keeper.zh-TW.md) | 在 desktop 顯示 prompt cache 狀態；開啟後，離開時讓 1h 快取保持溫熱，context 變貴時提議交接到新 session。 |
| [`self-check`](docs/mods/self-check.zh-TW.md) | 同一個工具連續兩次同樣失敗時，請 Claude 先找原因；改了程式要說「完成」前，請它先驗證。 |
| [`project-memory`](docs/mods/project-memory.zh-TW.md) | 開啟後在背景把對話整理進 Claude Code 內建的 memory 與進度檔；在多個 session 證實過的規則，會先問你再寫進 CLAUDE.md。 |

## 快速開始

需要 Claude Code 2.1.296 以上，CLI 或 desktop（雲端 session 目前無法載入 mod）。

```bash
claude plugin marketplace add wen-hsiu-hsu/cc-mod-trimtab
```

然後在 Claude Code 裡安裝要用的 mod。`secret-scrub` 要第一個裝，它才會比其他 mod 先看到每則 prompt：

```
/plugin install secret-scrub@cc-mod-trimtab
/plugin install tool-guard@cc-mod-trimtab
/plugin install output-trimmer@cc-mod-trimtab
```

裝好就能用，預設值都是安全的。會呼叫模型的功能（`session-keeper` 與 `project-memory`）預設關，用 `/<mod> on` 或在 `/config` 開啟。`/<mod> status` 看 mod 目前的設定。

## 文件

- [安裝與更新](docs/install.zh-TW.md)：版本、更新方式、安裝順序、雲端 session。
- [設定](docs/settings.zh-TW.md)：設定分層、介面語言、開關用模型的功能、commit 進 repo 的檔案能改什麼。
- 各 mod 的頁面（上表的連結）：所有行為、指令、設定、費用與已知限制。
- [變更紀錄](CHANGELOG.md)與[安全性](SECURITY.md)。
- 參與開發：[開發指南](docs/development.md)、[架構決策（ADR）](docs/adr/README.md)、[介面規範](DESIGN.md)與 [ROADMAP](ROADMAP.md)。

## License

[MIT](LICENSE)。部分程式改寫自 [cablate/ctx-handoff-mod](https://github.com/cablate/ctx-handoff-mod)（MIT），見 [NOTICE](NOTICE)。
