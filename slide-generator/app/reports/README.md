# Report workspace：本機啟動與驗收

既有 Next.js 專案的 `/reports` 目前以 walking skeleton 為主：讀取 State → 生成報告 → 手動編輯與下載 Markdown → Slidev 網頁、PPTX 或可攜式 ZIP。草稿儲存／載入、對話修改與前後審閱視窗已從網頁停用，相關底層功能、API、測試及既存資料保留。`workspace.tsx` 的 `conversationEnabled = false` 與 `draftStorageEnabled = false` 控制入口，沒有公開網址或瀏覽器儲存開關可啟用。正式入口不包含 p-limit 專用資料；本機 Mock 可載入忽略目錄中的測試 States。組員之後可從授權資料層提供 `WorkspaceDataset[]`，不用建立第二套網站。

## 安裝與啟動

需要 Node.js 22.12 以上。在 Repository 根目錄：

```powershell
Set-Location slide-generator
npm.cmd ci
Push-Location slide-export
npm.cmd ci
Pop-Location
Push-Location state-replay
npm.cmd ci
Pop-Location
```

三個 `ci` 各自使用 lockfile 安裝網站、Slidev 與歷史重建工具。不要在服務運行時重新安裝它使用的 node_modules。PPTX／溢出檢查需要 Chromium；若尚未安裝，從 `slide-export` 執行：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) 'node_modules/.playwright-browsers'
node node_modules/playwright-chromium/cli.js install chromium
```

在編輯器設定 `slide-generator/.env.local`，例如（只放佔位文字）：

```dotenv
LLM_PROVIDER=gemini
GEMINI_API_KEY=replace-locally
GEMINI_MODEL=replace-with-an-available-model
```

沿用 Report Agent 的 Groq／OpenAI 設定也可以。Key 只在伺服器環境中；`.env.local` 已被 Git 忽略，不要貼出或提交。CLI 使用 `--env-file`，Next.js 自動載入。

從 `slide-generator` 執行 `npm.cmd run dev`，開啟終端機列出的本機 `/reports`。本頁不會呼叫 Firebase；其他頁面及 `/api/health` 的 Firebase 建置設定仍由基礎架構負責人提供。報告／簡報／歷史載入 API 在 production 保持禁用，尚未完成正式授權、持久化與部署。

## 資料來源與歷史重建

輸入 `https://github.com/owner/repo`。只接受公開 GitHub root URL（可含 `.git` 或結尾 `/`），不接受任意主機、私有庫、認證資訊、分支路徑或 query。

- **載入公開 repo**：固定預設分支目前 commit，建立獨立 Repo Snapshot。不是正式 Project State，不能從單一版本推論近期進度；功能、里程碑及風險尚未評估。
- **載入已重建的歷史 State**：讀取 [state-replay](../../state-replay/README.md) 的本機有效結果。先以獨立工具逐版分析，再載入網頁。可以載入尚未全部完成的結果，選單明示 `X/Y`。網頁不啟動長時間的重建工作。

歷史工具保留每一版、`latest.json`、合併時間與進度紀錄，支援續跑；產物均被忽略，不提交 Git。每版符合原有 Schema，但 generator 明示歷史重建，評估不完整處有 data_gaps。`updated_at` 是實際收集／分析時間；選單日期是原始合併時間。最新版代表最後成功重建的 merge，不一定是今日 HEAD。

## 手動驗收

1. 載入 repo 現況，或已重建的歷史 State。歷史模式可選結束版、勾選「彙整合併區間」並選開始版；兩端包含，最多 100 次合併。報告的目前狀態取結束版，區間另供逐筆變更證據。
2. 填寫報告生成需求，預設先介紹整份專案的用途與架構，再呈現近期成果與待處理問題；可自行指定對象、章節、語言或頁數。留空也沿用相同方向，不會虛構缺少證據的進度或問題。有 code-only 資料時只說明能證實的現況。
3. 有可讀 repo 的資料來源預設開啟按需讀取，可自行取消。模型先看檔案清單選片段，後端驗證 Git blob hash，再提供正文；固定到所選 commit，不自動開啟任意來源連結。
4. 切換編輯／檢視／雙欄並手動編輯，雙欄依捲動比例同步。確認網頁沒有對話欄、修改要求、預覽修改或接受修改入口；版面改為資料來源與報告雙欄，手機單欄。
5. 測試「復原上一版／恢復剛才的修改」及下載 Markdown。生成、手動編輯、復原／恢復版本後自動執行本機基本檢查，僅有格式問題或規則提醒時顯示內容，不顯示頁數／分鐘／待核對數摘要，也沒有手動檢查按鈕。不呼叫 LLM、不改寫報告；規則檢查不能證明事實正確。資料來源旁可展開查看功能、風險與資料缺口的定義。草稿儲存／載入已從網頁停用；重新整理會清除目前草稿。每頁需保留非空講稿；Sources 選用。
6. 確認內容後產生 Slidev 原稿。預設另請 LLM 安排轉場／逐項顯示／基本版面；固定轉場可不呼叫模型。展開「檢查 Slidev Markdown」，可直接「編輯 slides.md」的文字、講稿、分頁、基本版面、轉場及縮放；不會變更上方報告或 State。下載、播放、PPTX、ZIP 與溢出檢查直接使用編輯後的原稿，不另呼叫模型。修改原稿會清除舊播放連結與檢查結果；重新生成前會確認是否取代手動修改。原稿同樣只存在目前頁面，需下載保留。
7. 驗收網頁播放、兩種 PPTX、可攜式 ZIP，及「檢查投影片溢出」。溢出檢查實際逐頁量測，不自動改文或拆頁，也不代表排版美觀／事實正確。
8. 改報告／轉場後，重新生成原稿及播放連結。切換資料前會提醒；失敗載入／生成／修改不應清除目前草稿。

目前網頁停用所有來源的草稿儲存／載入。草稿與最多 20 個復原版本只在頁面記憶體，重新整理會清除，請下載需保留的 Markdown。既有已存草稿及底層儲存 API 保留。播放連結約有效兩小時，需要本機 Next.js 持續執行。可攜式 ZIP 解壓後執行 `start.cmd`，播放電腦需有 Node.js；目前不支援圖片打包。PPTX 不保留網頁動畫，請人工確認字型與排版。

## 模型與讀取限制

載入資料、預覽、選區間、手動編輯、下載與渲染不呼叫 LLM。生成／修改報告會呼叫；開啟 repo 讀取通常再加一次選檔。兩個步驟各至多修正一次，整次報告操作最多 4 次模型呼叫。相同輸入可命中最多 20 組、5 分鐘的已驗證 context 快取；不快取報告。

公開 repo 使用匿名 GitHub GET，可能限流。檔案清單需完整未截斷，最多 1,500 個符合條件的文字檔；單檔最多 256,000 bytes；供模型的片段最多 4 段、各 180 行、總共 24,000 字元。環境／敏感名稱檔案、依賴與建置目錄、lockfile、symlink、submodule、binary、LFS 指標不讀取。檔名目前限 ASCII 安全字元、正文 UTF-8。限流、過大資料或完整性失敗會明確停止，不能把局部資料說成完整分析。

## 自動驗收與交接

從 `slide-generator` 執行：

```powershell
node report-agent/verify.mjs
```

加入 `--browser` 驗證實際本機網頁、歷史載入與 compiled routes；加入 `--render` 會再實際建置 Slidev、匯出兩種 PPTX／ZIP、檢查正常與溢出頁。兩者均需先啟動既有 Next.js。所有模型回覆均模擬，不讀取真實 Key 或發送模型 API 請求。歷史測試使用小型模擬 repo，不需要下載第三方歷史資料。

自動測試不能代替真實模型的品質驗收。正式 PR 前應手動重建少量合併、核對 State chain／最新版／來源，再在網頁驗收報告。完整建置與部署仍需組員協調。請參考 [PR 交接](PR-HANDOFF.md)、[改善紀錄](OPTIMIZATIONS.md)、[Report Agent](../../report-agent/README.md) 和 [Slidev 匯出](../../slide-export/README.md)。
## Local Mock storage

The latest stored State is selected by default. Older versions and supported merge-range controls are collapsed under **歷史版本／報告區間**; **回到最新狀態** returns from a historical selection. `base_state_id` links snapshots, while each State's `trigger` describes only its own merge. Selecting one State does not automatically send all history to the model. Mock datasets with accepted merge metadata support inclusive range aggregation in both generation and revision, independently of repo file reads; States without merge metadata support only version selection. See the Mock README for metadata import. Saved Mock drafts also restore the chosen range.

The report workspace now offers local file-backed Mock storage for Project State and report drafts, with the existing conversation storage retained internally. Use **載入 Mock 資料** (or **建立 Mock 範例資料** for the schema examples) to load State. Draft save/load is currently disabled in the website; download Markdown before refreshing. Storage APIs and previously saved drafts are retained internally. See [Mock setup, contract and tests](../../mock-firebase/README.md). This does not test real Firebase or change the teammate's Firebase initialization or health route.
