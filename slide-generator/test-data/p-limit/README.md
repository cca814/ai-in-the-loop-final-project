# p-limit 歷史 Project State 測試資料

來源：[sindresorhus/p-limit](https://github.com/sindresorhus/p-limit)。本資料集將收集時已合併的每一個 PR，依 `merged_at` 由早到晚重建一版 Project State，提供 Report Agent 與簡報流程使用。這是根據實際歷史程式碼整理的測試 fixture，**不是正式 Intent Supervisor 的輸出或實作**，也不是歷史 CI 通過紀錄。本次沒有呼叫付費 LLM、修改來源 repository 或寫入 Firebase。

## 從哪裡看

- [TIMELINE.md](TIMELINE.md)：21 次 merge 的時間線及各版 State 連結。
- [states/](states/)：符合正式 Schema 的 21 份 Project State JSON，可直接交給 Report Agent。
- [inputs/](inputs/)：每次 merge SHA 對應的完整 repository 文字檔、Git blob SHA、tree SHA、commit parent，以及該次 merge commit patch。
- [inventory.json](inventory.json)：實際收集時間、來源 GET URL、分頁結束紀錄、排除的未合併 PR，以及檔名順序。
- [replay.mjs](replay.mjs)：僅供此資料集的離線回放建置器。

收集到 38 個 closed PR，其中 21 個 merged、17 個 closed without merge；第二頁為空。Closed 不等於 merged，未合併 PR 不產生 State。涵蓋從 PR #1（2016-10-31）到 PR #109（2026-08-31）的 merge。歷史上 default branch 曾叫 `master`，後來改名 `main`；兩者皆納入。PR #83 的合併時間早於 #79，因此依序是 #83、#79，而不是按 PR 編號排序。

## 每版如何產生

```text
上一版 Project State（第一版為 null）
       +
這次 merge 的完整 repository 檔案、SHA 與 patch
       ↓
buildState(previous, input)
       ↓
本次完整 Project State
```

建置器每次只接收上一版 State 與該版 input，不讀其他版本的 State 或後來的原始檔。它依當時檔案重新檢查能力是否存在，沿用穩定的 feature ID 與仍適用的已合併 PR 證據。當次 trigger 摘要及影響的功能由逐一核對 merge patch 後的固定註記提供；這些規則只適用於此 repository，不是通用的專案分析演算法。來源不使用今日 `main`；所有文件與程式碼連結固定到當版 merge SHA。

第一版反映 PR #1 合併後的整個 repository，不是空專案。沒有追溯到對應 merged PR 的既有能力，即使檔案中看得見，也依 Schema 的 done 證據要求標為 `unknown`，並說明原因。`unknown` 不代表功能不存在或壞掉。

兩次 PR merge 中間可能包含維護者直接提交的變更，因此本版檔案不一定等於「上一版加上本次 PR patch」。例如 package version、Node.js 最低版本、ES Module 匯出方式，以及 `rejectOnClear` 都可能在兩版間改變：State 反映當時檔案，trigger 僅描述此次 PR。PR #108 的 `rejectOnClear` 能力因此可見，但不歸功於修正 map 的 #108。

PR 標題、內文、留言與 issue 狀態可能在合併後被修改。因此分析輸入使用 immutable commit message/patch 及 GitHub 記錄的 merge 時間與 SHA，不使用今天的 PR 內文或 issue 開關狀態推測當時情況。

## 時間與資料缺口

- `updated_at` 採用 merge 時間作為**測試回放的模擬時鐘／資料截止點**，不是宣稱系統在當年已產生 State。實際下載時間另記在 `inventory.json` 的 `collection_time_utc`。`generator.name` 為 `historical-replay-fixture`，避免冒充真實上游資料。
- `base_state_id` 精確連到前一個 merge 的 `event_id`。資料集第一版為 `null`。這是連續回放的初始狀態，不代表 repository 剛建立。
- 未重建歷史 GitHub milestone、open issue/PR 規劃、完整安全評估與 CI 結果。三個 section 都有對應 `data_gaps`；不填猜測期限，也不將缺資料寫成「沒有風險」。
- State 裡的 `done` 表示當時已合併且有程式碼與 PR 證據；不表示已發布 npm、沒有 bug，或本次跑過該專案測試。
- 唯一自動列出的風險是可由當時程式碼靜態推導的清佇列後 Promise 維持 pending 問題，敘述明示分析方式。嚴重程度為 `unknown`；沒有憑空評估商業衝擊。後來有 `rejectOnClear` 時同步更新其緩解方式。
- 這是回溯的程式碼狀態測試集，不能代替有完整當時事件、議題與執行結果的正式分析。

## 重建與驗證

在 repository 根目錄執行：

```powershell
node slide-generator/test-data/p-limit/replay.mjs
node --test slide-generator/test-data/p-limit/replay.test.mjs
python slide-generator/test-data/p-limit/validate_schema.py
```

Node.js 回放與測試只用內建模組以及既有 `prepareState`，不連網、不讀 `.env.local`、不呼叫 LLM。回放會更新本資料夾的 `states/*.json` 與 `TIMELINE.md`。

Python Schema 驗證需要 `jsonschema` 4.x（本次使用 4.26.0），使用原有 `schemas/project_state.schema.json`，不修改 Schema。需要時可在自選 Python 虛擬環境中安裝 `python -m pip install "jsonschema>=4.26,<5"`。驗證器啟用 Draft 2020-12 與日期、時間、URL 格式檢查。

測試涵蓋完整 merge 數量與順序、State chain、不讀未來版本的引用、文件 SHA 固定、回放可重現且不修改輸入、重要能力出現的時間，以及每個檔案的 Git blob hash 與整個 Git tree hash。完整 tree hash 比對可確認保存的不是只有 PR diff 或部分挑選的原始檔。

## 交給 Report Agent

如要測第一個 merge，在 `slide-generator/report-agent/` 執行：

```powershell
node --env-file=../.env.local cli.js ../test-data/p-limit/states/001-pr-1.json report-p-limit-pr-1.md
```

最後一個 merge 可用 `../test-data/p-limit/states/021-pr-109.json`。這兩個指令會使用你設定的 LLM API；產生 fixture 和自動驗證本身不會呼叫 API。批次逐版生成報告尚未加入；網頁可選合併區間彙整 trigger。

## 在網頁測試

啟動既有 Next.js 開發網站後，開啟 `/reports`：

1. 在「選擇專案資料」選 **p-limit · 21 次真實 PR merge**。
2. 在「選擇合併快照」挑一版；選單依 merge 時間排序，也可使用「上一版／下一版」。預設進入第一版 PR #1。
3. 左側顯示資料截止點、event ID、上一版 ID、commit 與 PR 來源。可展開完整 JSON，或按「下載 Project State」。
4. 可填「報告生成需求（選填）」並勾選「允許按需讀取此版本 repo」。模型會先選檔，再根據對應 merge SHA 的片段生成或修改報告；不讀今天的 main。開啟時每次增加一次選檔模型請求，即使最後判斷不需要檔案。成功後可展開「本次 repo 讀取紀錄」查看讀到的檔案與行號。詳細行為見 [Report Agent README](../../report-agent/README.md#optional-repository-evidence-p-limit-historical-snapshots)。
5. 按「生成報告」，再測試手動編輯、檢視／雙欄、對話修改及三種簡報輸出。生成與修改報告會呼叫既有伺服器 LLM 設定；選快照和 Markdown 預覽不呼叫 LLM。產生 Slidev 原稿預設另由 LLM 安排轉場與特效；選擇預設或固定轉場可不呼叫 LLM。後續網頁建置、PPTX 與 ZIP 匯出沿用原稿設定，不再呼叫模型。完整安裝與驗收步驟見 [Report workspace 指南](../../app/reports/README.md)。
6. 切換快照或專案時，若已有報告會先提醒。確認後清除該份草稿、對話及簡報快照；需要保留的內容請先下載。

目前專案狀態使用所選的**單一結束版** Project State。如要彙整多次 merge，勾選「彙整合併區間」並選開始版；上方合併快照是結束版，兩端都包含。後續生成與修改會另收到所選區間的逐筆 merge 紀錄，不會用舊版功能狀態覆蓋結束版，也不包含直接提交。區間選擇不會自動改寫已有報告；可要求「Recent Changes 包含所選區間每次 merge，逐筆列出日期、PR 與摘要」。區間功能不必開啟 repo 讀取，也不增加額外模型請求。

網頁只載入 `states/`；`inputs/` 的歷史原始碼只在伺服器側按需讀取。原有三個 Demo App 範例仍可從專案選單切回。

選單在 `app/reports/state-datasets.ts` 明確列出這 21 版；若未來增加歷史版本，需同步更新選單。既有 `report-agent/web-check.mjs` 會逐一驗證選單中的 21 版與 fixture 相同、JSON 下載一致、生成與修改使用正確 State、簡報轉換及切換時的草稿保護；所有 LLM 呼叫均被攔截成測試回覆，不消耗 API 額度。

## 來源與授權

資料僅透過 GitHub 唯讀 GET API 取得，沒有 clone/fetch/checkout。下載的原始檔內容以 JSON 字串存放於 `inputs/`，不會被當成程式執行。每版均保留來源 repository 的 `license` 檔（MIT 授權）；若再散布此資料集，請一併保留授權內容。
