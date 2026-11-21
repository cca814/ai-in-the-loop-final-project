# Report workspace：本機啟動與驗收

這是既有 Next.js 專案的 `/reports` 頁面，不是另一套網站。它串接 Project State 範例、報告生成、手動與多輪對話修改，以及 Slidev 網頁簡報、PPTX 和可攜式網頁 ZIP。

## 安裝與啟動

以下 PowerShell 指令從 Repository 根目錄開始。Slidev 需要 Node.js 22.12 以上；本機使用 Node.js 22.22.3 完成測試。若共用 Firebase 套件有額外 Node 版本要求，請與基礎架構負責人確認。

```powershell
Set-Location slide-generator
npm.cmd ci
Push-Location slide-export
npm.cmd ci
Pop-Location
```

第一個 `npm.cmd ci` 安裝網站與 Markdown 預覽套件；第二個安裝 Slidev 與匯出套件。`ci` 使用各自的 lockfile，並重建該目錄的 `node_modules`，不要在開發服務執行中重裝。PPTX 匯出需要 Playwright Chromium；若安裝時未下載瀏覽器，在 `slide-export` 執行：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) 'node_modules/.playwright-browsers'
node node_modules/playwright-chromium/cli.js install chromium
```

在編輯器建立或更新 `slide-generator/.env.local`，只填入所用 Provider 的設定，例如：

```dotenv
LLM_PROVIDER=gemini
GEMINI_API_KEY=replace-locally
GEMINI_MODEL=replace-with-an-available-model
```

這些只是佔位值。請自行填入帳號可用的模型與 Key；不要提交或分享實際 `.env.local`。Groq 與 OpenAI 的設定見 [Report Agent README](../../report-agent/README.md)。Next.js 會讀取 `.env.local`，不需要 `--env-file`；變更環境設定後請重啟開發服務。

從 `slide-generator` 啟動：

```powershell
npm.cmd run dev
```

開啟 `http://localhost:3000/reports`；若 3000 已被使用，依終端機印出的連接埠開啟 `/reports`。本頁目前使用本機 fixture，不會呼叫 Firebase。其他頁面與 `/api/health` 的 Firebase 設定由基礎架構負責人提供；完整 `next build` 仍需該設定，不能以本頁可開啟代替正式建置驗收。

## 手動驗收

1. 選擇 Demo 範例或 p-limit 歷史快照。p-limit 可勾選「彙整合併區間」，選開始版；上方選取的快照是結束版，兩端都包含。
2. 填寫「報告生成需求」或留空，按「生成報告」。留空時會以工程師向主管匯報近期進度的方式撰寫；架構不固定。需要實作細節時，可開啟 p-limit 的按需 repo 讀取，僅讀結束版 commit 的已收錄歷史片段。
3. 切換編輯、檢視與雙欄；手動修改，再連續提出兩次對話修改，確認使用最新草稿且保留必要上下文。
4. 測試新增、拆分或合併頁面。每頁以 `#` 標題開始，需有非空的 Speaker Notes／講稿；Sources 每頁選用。缺少講稿等格式問題會要求模型修正一次，失敗則保留原稿。
5. 確認報告內容後勾選確認框，按「產生 Slidev 原稿」。預設由 LLM 選擇每頁轉場、逐項顯示與基本版面，保留文字、講稿與來源。若要不呼叫 LLM 的轉換，選擇「預設（不呼叫 LLM）」或固定轉場。
6. 分別測試網頁播放、兩種 PPTX 格式、可攜式 ZIP。它們沿用已生成的設定，不再次請模型安排特效。網頁中用方向鍵測試逐項顯示與換頁；PPTX 是每頁的最終靜態內容，不保留網頁動畫。ZIP 解壓縮後執行其中的 `start.cmd`，播放電腦需有 Node.js 22.12 以上。
7. 修改報告或轉場後，先重新產生原稿再匯出；成功重新產生原稿後，需重新建立網頁播放連結。

草稿、對話與特效設定只保留在目前頁面，重新整理會清除；需要保留的內容請先下載。網頁播放連結約有效兩小時，且需要本機 Next.js 持續運行。可攜式 ZIP 不依賴原網站，但目前不支援圖片打包。

## 哪些操作會呼叫 LLM

| 操作 | LLM 請求 |
| --- | --- |
| 選快照、選區間、查看 State、手動編輯、Markdown 預覽與下載 | 不呼叫 |
| 生成報告或對話修改 | 呼叫；格式錯誤時至多一次修正 |
| 開啟按需 repo 讀取 | 另加一次選檔；選檔格式錯誤時至多一次修正，即使最後不需讀檔仍有選檔請求 |
| LLM 自動安排簡報特效 | 另加一次安排請求；格式錯誤時至多一次修正 |
| 固定轉場的 Markdown 轉換、建立網頁、PPTX 或 ZIP 匯出 | 不呼叫；使用已確認的報告與特效設定 |

Provider 的 HTTP 重試另計。503 表示供應商暫時無法服務，本程式對明確的暫時性 HTTP 錯誤最多嘗試三次；不會自動換模型或要求升級付費。失敗時會標示選檔／生成／修改階段，保留原稿與尚未送出的修改要求。

## 不消耗 API 額度的檢查

從 `slide-generator` 執行：

```powershell
npm.cmd run lint
node node_modules/typescript/bin/tsc --noEmit --incremental false
Push-Location report-agent
node --test
Pop-Location
Push-Location slide-export
node --test
Pop-Location
Push-Location test-data/p-limit
node --test
Pop-Location
```

需要測試實際網頁時，先保持現有 Next.js 開發服務執行，再開另一個終端機，從 `slide-generator` 執行：

```powershell
$env:REPORT_TEST_URL = 'http://localhost:3000'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) 'slide-export/node_modules/.playwright-browsers'
Push-Location report-agent
node web-check.mjs
node repository-next-check.mjs
Pop-Location
Push-Location slide-export
node auto-effects-browser-check.mjs
Pop-Location
```

請依服務實際連接埠調整 URL；若 Chromium 使用預設安裝位置，可省略 `PLAYWRIGHT_BROWSERS_PATH`。這些檢查模擬 LLM 回覆，不讀取實際 API Key，也不向 Provider 發送請求。特效檢查會真的建置簡報、開啟 Chromium、匯出兩種 PPTX 與 ZIP，所需時間較長。自動測試不保證真實模型的文字品質、頁數遵從程度或服務可用性，仍需手動驗收。

## 本版範圍與後續整合

- 已串接本機 fixture、報告編輯與對話、歷史區間、按需 repo 片段及三種簡報輸出。
- 尚未接上 Firestore 讀取與草稿／對話持久化，也未完成登入、額度控管或正式 Vercel 匯出部署。
- 報告與簡報 API 目前在 production 禁用。Firebase 與部署環境須與基礎架構負責人協調。
- 上游負責完整 Project State Schema 驗證；Report Agent 只檢查本模組需要的資料關係與來源，不代替完整 Schema 驗證。

詳見 [Report Agent](../../report-agent/README.md)、[Slidev 匯出](../../slide-export/README.md) 與 [p-limit 歷史資料](../../test-data/p-limit/README.md)。
