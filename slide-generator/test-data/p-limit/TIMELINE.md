# p-limit historical replay

| 序號 | 合併時間（UTC） | PR | 當次變更 | State |
| --- | --- | --- | --- | --- |
| 1 | 2016-10-31T11:11:32Z | [#1](https://github.com/sindresorhus/p-limit/pull/1) | 移除 README 使用範例中未使用的 delay import；未變更執行期依賴。 | [JSON](states/001-pr-1.json) |
| 2 | 2018-01-04T00:21:27Z | [#4](https://github.com/sindresorhus/p-limit/pull/4) | 透過 p-try 接受同步回傳及同步拋錯的函式，新增對應測試。 | [JSON](states/002-pr-4.json) |
| 3 | 2018-06-06T15:59:27Z | [#7](https://github.com/sindresorhus/p-limit/pull/7) | 直接將函式交給 pTry，移除額外匿名函式包裝。 | [JSON](states/003-pr-7.json) |
| 4 | 2018-06-14T17:42:52Z | [#8](https://github.com/sindresorhus/p-limit/pull/8) | 支援 limit(fn, ...args) 參數轉送，更新實作、文件與測試。 | [JSON](states/004-pr-8.json) |
| 5 | 2018-12-25T14:12:19Z | [#9](https://github.com/sindresorhus/p-limit/pull/9) | 新增 activeCount 與 pendingCount 唯讀計數器及對應測試。 | [JSON](states/005-pr-9.json) |
| 6 | 2019-03-02T19:13:29Z | [#11](https://github.com/sindresorhus/p-limit/pull/11) | 新增 TypeScript 定義與型別測試，調整 CommonJS/default 匯出。 | [JSON](states/006-pr-11.json) |
| 7 | 2019-04-26T04:53:44Z | [#12](https://github.com/sindresorhus/p-limit/pull/12) | 將 Node.js 12 加入 Travis 測試設定；設定存在不代表歷史 CI 已通過。 | [JSON](states/007-pr-12.json) |
| 8 | 2020-04-05T15:37:34Z | [#20](https://github.com/sindresorhus/p-limit/pull/20) | 新增 clearQueue() 以丟棄尚未執行的工作，並補上文件與型別。 | [JSON](states/008-pr-20.json) |
| 9 | 2020-05-18T06:57:35Z | [#28](https://github.com/sindresorhus/p-limit/pull/28) | 排入佇列後等待 microtask 再啟動工作，使限流函式一律非同步執行。 | [JSON](states/009-pr-28.json) |
| 10 | 2020-06-06T16:18:38Z | [#30](https://github.com/sindresorhus/p-limit/pull/30) | 改用 TypeScript namespace 與 export = pLimit，以對齊 CommonJS 匯出。 | [JSON](states/010-pr-30.json) |
| 11 | 2020-07-12T13:35:19Z | [#35](https://github.com/sindresorhus/p-limit/pull/35) | 無效 concurrency 改為同步拋出 TypeError，而非回傳 rejected Promise。 | [JSON](states/011-pr-35.json) |
| 12 | 2020-11-25T07:28:52Z | [#47](https://github.com/sindresorhus/p-limit/pull/47) | 以 yocto-queue 取代陣列佇列；未從程式變更推算效能提升幅度。 | [JSON](states/012-pr-47.json) |
| 13 | 2021-02-23T06:21:35Z | [#50](https://github.com/sindresorhus/p-limit/pull/50) | 調整內部參數傳遞為 args 陣列的重構。 | [JSON](states/013-pr-50.json) |
| 14 | 2023-11-01T06:13:46Z | [#71](https://github.com/sindresorhus/p-limit/pull/71) | 使用 AsyncResource.bind 保留非同步上下文，新增 AsyncLocalStorage 測試及瀏覽器 stub。 | [JSON](states/014-pr-71.json) |
| 15 | 2024-07-04T11:52:03Z | [#83](https://github.com/sindresorhus/p-limit/pull/83) | 改以內部 Promise resolver 保留非同步上下文，移除 AsyncResource 與 stub。 | [JSON](states/015-pr-83.json) |
| 16 | 2024-07-08T12:02:18Z | [#79](https://github.com/sindresorhus/p-limit/pull/79) | 新增可讀寫的 concurrency 屬性，調整限流數值時更新待執行工作。 | [JSON](states/016-pr-79.json) |
| 17 | 2024-12-19T15:35:28Z | [#88](https://github.com/sindresorhus/p-limit/pull/88) | 新增 limitFunction()，為單一函式建立獨立的併發限制包裝。 | [JSON](states/017-pr-88.json) |
| 18 | 2025-08-14T14:51:00Z | [#93](https://github.com/sindresorhus/p-limit/pull/93) | 調整 activeCount 更新順序並移除額外的排程 microtask，新增非同步執行測試。 | [JSON](states/018-pr-93.json) |
| 19 | 2025-10-19T15:16:26Z | [#98](https://github.com/sindresorhus/p-limit/pull/98) | 將 limit.map 的輸入從陣列擴大為 iterable，新增 Set 與 iterator 測試。 | [JSON](states/019-pr-98.json) |
| 20 | 2026-07-20T20:12:34Z | [#108](https://github.com/sindresorhus/p-limit/pull/108) | 修正拆出 limit.map 後呼叫時對 this 的依賴，維持使用原本 limiter。 | [JSON](states/020-pr-108.json) |
| 21 | 2026-08-31T16:47:35Z | [#109](https://github.com/sindresorhus/p-limit/pull/109) | 在 limitFunction 回傳的函式上暴露 clearQueue，補上型別、文件與測試。 | [JSON](states/021-pr-109.json) |
