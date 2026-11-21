// Offline, repository-specific test fixture builder. This is not Intent Supervisor.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { prepareState } from '../../report-agent/state.js';

// Reviewed against immutable merge-commit patches, not mutable PR descriptions.
const triggers = {
  1: ['移除 README 使用範例中未使用的 delay import；未變更執行期依賴。', ['docs']],
  4: ['透過 p-try 接受同步回傳及同步拋錯的函式，新增對應測試。', ['core', 'sync-functions', 'tests']],
  7: ['直接將函式交給 pTry，移除額外匿名函式包裝。', ['core', 'sync-functions']],
  8: ['支援 limit(fn, ...args) 參數轉送，更新實作、文件與測試。', ['arguments', 'core', 'docs', 'tests']],
  9: ['新增 activeCount 與 pendingCount 唯讀計數器及對應測試。', ['counts', 'docs', 'tests']],
  11: ['新增 TypeScript 定義與型別測試，調整 CommonJS/default 匯出。', ['types', 'core', 'tests']],
  12: ['將 Node.js 12 加入 Travis 測試設定；設定存在不代表歷史 CI 已通過。', ['ci']],
  20: ['新增 clearQueue() 以丟棄尚未執行的工作，並補上文件與型別。', ['clear-queue', 'types', 'docs', 'tests']],
  28: ['排入佇列後等待 microtask 再啟動工作，使限流函式一律非同步執行。', ['async-scheduling', 'counts', 'tests']],
  30: ['改用 TypeScript namespace 與 export = pLimit，以對齊 CommonJS 匯出。', ['types']],
  35: ['無效 concurrency 改為同步拋出 TypeError，而非回傳 rejected Promise。', ['core', 'tests']],
  47: ['以 yocto-queue 取代陣列佇列；未從程式變更推算效能提升幅度。', ['queue-implementation', 'core']],
  50: ['調整內部參數傳遞為 args 陣列的重構。', ['core', 'arguments']],
  71: ['使用 AsyncResource.bind 保留非同步上下文，新增 AsyncLocalStorage 測試及瀏覽器 stub。', ['async-context', 'core', 'tests']],
  83: ['改以內部 Promise resolver 保留非同步上下文，移除 AsyncResource 與 stub。', ['async-context', 'core', 'tests']],
  79: ['新增可讀寫的 concurrency 屬性，調整限流數值時更新待執行工作。', ['dynamic-concurrency', 'types', 'docs', 'tests']],
  88: ['新增 limitFunction()，為單一函式建立獨立的併發限制包裝。', ['limited-function', 'types', 'docs', 'tests']],
  93: ['調整 activeCount 更新順序並移除額外的排程 microtask，新增非同步執行測試。', ['core', 'async-scheduling', 'counts', 'tests']],
  98: ['將 limit.map 的輸入從陣列擴大為 iterable，新增 Set 與 iterator 測試。', ['map', 'types', 'docs', 'tests']],
  108: ['修正拆出 limit.map 後呼叫時對 this 的依賴，維持使用原本 limiter。', ['map', 'tests']],
  109: ['在 limitFunction 回傳的函式上暴露 clearQueue，補上型別、文件與測試。', ['limited-function-clear', 'types', 'docs', 'tests']],
};

export function buildState(previous, input) {
  const { pr, commit, files } = input;
  if (commit.sha !== pr.merge_commit_sha || !triggers[pr.number]) throw new Error('Unknown or mismatched merge input');
  if (previous && Date.parse(previous.updated_at) >= Date.parse(pr.merged_at)) throw new Error('Replay must be chronological');
  const text = path => files[path]?.content || '';
  const code = text('index.js');
  const pkg = JSON.parse(text('package.json'));
  const [summary, changed] = triggers[pr.number];
  const refs = new Map();
  const currentPr = { id: `pr-${pr.number}`, type: 'pull_request', number: pr.number, url: pr.url, title: pr.title_at_commit };
  refs.set(currentPr.id, currentPr);
  const document = path => {
    if (!files[path]) throw new Error(`Missing evidence: ${path}`);
    const id = `doc-${path.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
    refs.set(id, { id, type: 'document', path, title: path, url: `https://github.com/sindresorhus/p-limit/blob/${commit.sha}/${path}` });
    return id;
  };
  const features = [];
  function feature(key, name, description, paths) {
    const prior = previous?.features.find(item => item.id === `feature-${key}`);
    const evidence = [];
    if (changed.includes(key)) evidence.push(currentPr.id);
    else if (prior) {
      const priorPr = prior.source_ref_ids.map(id => previous.source_refs.find(ref => ref.id === id)).find(ref => ref?.type === 'pull_request');
      if (priorPr) { refs.set(priorPr.id, priorPr); evidence.push(priorPr.id); }
    }
    const status = evidence.length ? 'done' : 'unknown';
    features.push({ id: `feature-${key}`, name, status, summary: description + (status === 'unknown' ? ' 當時檔案可確認此能力，但本次回放未取得對應的已合併 PR 證據，故不標記 done。' : ''), source_ref_ids: [...evidence, ...paths.map(document)] });
  }
  const mode = pkg.type === 'module' ? 'ES Module' : 'CommonJS';
  feature('core', 'Promise 併發限制', `以佇列限制同時執行的工作，回傳 Promise。當時 package.json 宣告版本 ${pkg.version}、Node.js ${pkg.engines.node}、${mode}；這是檔案宣告，非 npm 發布或相容性測試結果。`, ['index.js', 'readme.md', 'package.json']);
  feature('docs', '使用說明', 'README 提供安裝方式、使用範例及當時公開 API 說明。', ['readme.md']);
  feature('tests', '自動化測試設定', `當時 scripts.test 為 ${pkg.scripts.test}；包含 test.js${files['index.test-d.ts'] ? ' 與型別測試' : ''}。本次僅讀取測試程式，未執行該版本的測試或重建歷史 CI 結果。`, ['package.json', 'test.js']);
  const ci = files['.github/workflows/main.yml'] ? '.github/workflows/main.yml' : '.travis.yml';
  feature('ci', 'CI 工作流程設定', `當時 repository 包含 ${ci} 測試設定；未取得當時的執行結果。`, [ci]);
  if (/pTry\(|async \(\) => (?:fn|function_)\(/.test(code)) feature('sync-functions', '同步回傳與拋錯處理', '限流工作經 pTry 或 async 包裝轉成 Promise，對應同步回傳值及拋錯。', ['index.js', 'test.js']);
  if (/### limit\(fn, \.\.\.args\)/.test(text('readme.md'))) feature('arguments', '工作參數轉送', 'limit(fn, ...args) 可將參數轉送給工作函式。', ['index.js', 'readme.md']);
  if (/\n\s*activeCount: \{/.test(code)) feature('counts', '執行中與等待中計數', '公開 activeCount 與 pendingCount getter，分別反映執行中與排隊中的工作數。', ['index.js', 'readme.md']);
  if (files['index.d.ts']) feature('types', 'TypeScript 型別定義', `存在 index.d.ts${/export = pLimit/.test(text('index.d.ts')) ? '，使用 export = pLimit' : ''}及型別測試；不代表本次已執行型別檢查。`, ['index.d.ts', 'index.test-d.ts']);
  if (/\n\s*clearQueue: \{/.test(code)) feature('clear-queue', '清除等待佇列', `clearQueue() 丟棄尚未開始的工作，不會取消執行中的工作。${/rejectOnClear/.test(code) ? '支援 rejectOnClear 選項；預設 false，啟用時以 AbortError 拒絕等待中的 Promise。' : '目前只清除佇列，未加入 rejectOnClear 選項。'}`, ['index.js', 'readme.md']);
  if (/await Promise\.resolve\(\)|new Promise\(internalResolve/.test(code)) feature('async-scheduling', '非同步工作啟動', /new Promise\(internalResolve/.test(code) ? '工作經內部 Promise 的 then 啟動；佇列工作非同步執行。' : 'enqueue 等待 Promise microtask 後才啟動工作。', ['index.js', 'test.js']);
  if (/new Queue\(\)/.test(code)) feature('queue-implementation', '佇列資料結構', '使用 yocto-queue 儲存等待中的工作；未執行效能量測，沒有量化速度改善。', ['index.js', 'package.json']);
  if (/AsyncResource\.bind|preserve (?:the )?asynchronous (?:execution )?context/.test(code)) feature('async-context', '非同步上下文傳遞', /AsyncResource\.bind/.test(code) ? '使用 AsyncResource.bind 及當時的 async-hooks stub 路徑保留上下文。' : '以內部 Promise resolver 保留非同步上下文，不依賴 AsyncResource.bind。', ['index.js', 'test.js']);
  if (/\n\s*concurrency: \{/.test(code)) feature('dynamic-concurrency', '動態調整併發限制', 'concurrency getter/setter 可讀寫併發上限，並驗證新的數值。', ['index.js', 'readme.md']);
  if (/export function limitFunction\(/.test(code)) feature('limited-function', '單一函式限流包裝', 'limitFunction() 回傳具獨立併發限制的函式，透過內部 limiter 執行工作。', ['index.js', 'readme.md']);
  if (/\n\s*map: \{/.test(code)) feature('map', '批次限流映射', `limit.map 使用 ${/Array\.from\(iterable/.test(code) ? 'iterable' : '陣列'} 建立工作並回傳 Promise.all 結果。${/=> generator\(function_, value, index\)/.test(code) ? '呼叫不依賴 this，可將 map 從 limiter 拆出使用。' : '目前實作透過 this 呼叫 limiter；本版未提供拆出呼叫的修正。'}`, ['index.js', 'readme.md']);
  if (/rejectOnClear/.test(code)) feature('reject-on-clear', '清佇列時拒絕 Promise 選項', '已存在 rejectOnClear 選項與 AbortError 拒絕等待工作的實作；預設 false。回放區間未取得此選項引入時的對應 PR 證據，不將它歸功於其他 PR。', ['index.js', 'readme.md']);
  if (/Object\.defineProperty\(limitedFunction, 'clearQueue'/.test(code)) feature('limited-function-clear', '包裝函式的清佇列方法', 'limitFunction 回傳函式暴露內部 limiter 的 clearQueue 方法，並具有對應型別。', ['index.js', 'index.d.ts', 'readme.md']);
  const risks = [];
  if (/\n\s*clearQueue: \{/.test(code)) risks.push({
    id: 'risk-cleared-promises-unsettled', kind: 'risk', title: '清除佇列可能留下未完成的 Promise', severity: 'unknown',
    description: '靜態程式分析：clearQueue 清除等待項目時，若沒有逐項 resolve/reject，對應 Promise 會維持 pending。' + (/rejectOnClear/.test(code) ? '目前可透過 rejectOnClear: true 避免，預設 false 仍有此限制。' : '當時實作尚未提供 rejectOnClear 選項。'),
    impact: '等待這些 Promise 的 Promise.all 等流程可能無法結束；嚴重程度依呼叫端使用方式而定，尚未評估。',
    source_ref_ids: [document('index.js'), document('readme.md')],
  });
  return prepareState({
    event_id: `p-limit-pr-${pr.number}-${commit.sha.slice(0, 12)}`, project_id: 'p-limit', project_name: 'p-limit',
    repository: { full_name: 'sindresorhus/p-limit', url: 'https://github.com/sindresorhus/p-limit' },
    source_commit_sha: commit.sha, base_state_id: previous?.event_id || null, updated_at: pr.merged_at,
    generator: { name: 'historical-replay-fixture', version: '1.0.0' },
    milestones: [], features, trigger: { source_ref_id: currentPr.id, summary, feature_ids: changed.map(key => `feature-${key}`).filter(id => features.some(feature => feature.id === id)) },
    risks, source_refs: [...refs.values()], data_gaps: [
      { section: 'milestones', reason: '本次未重建當時 GitHub milestone 狀態；repository 檔案未提供可據以填入的專案里程碑與期限，不以版本號推測。' },
      { section: 'features', reason: '僅根據當時完整檔案、此次 merge patch 與上一版 State 重建已觀察到的能力；未重建當時 open issues/PR 的規劃清單。缺少已合併 PR 證據的既有能力標記 unknown，不表示實作不存在。' },
      { section: 'risks', reason: '未重建當時 issues、討論、CI 結果或完整安全評估。僅列出可由當時程式碼推導的限制；空陣列不表示當時沒有風險。' },
    ],
  });
}

export async function replay() {
  const inventory = JSON.parse(await readFile(new URL('./inventory.json', import.meta.url)));
  await mkdir(new URL('./states/', import.meta.url), { recursive: true });
  let previous = null;
  const rows = ['# p-limit historical replay', '', '| 序號 | 合併時間（UTC） | PR | 當次變更 | State |', '| --- | --- | --- | --- | --- |'];
  for (const entry of inventory.entries) {
    const input = JSON.parse(await readFile(new URL(`./inputs/${entry.file}`, import.meta.url)));
    const state = buildState(previous, input);
    await writeFile(new URL(`./states/${entry.file}`, import.meta.url), JSON.stringify(state, null, 2) + '\n');
    rows.push(`| ${entry.sequence} | ${entry.merged_at} | [#${entry.pr}](https://github.com/sindresorhus/p-limit/pull/${entry.pr}) | ${state.trigger.summary} | [JSON](states/${entry.file}) |`);
    previous = state;
  }
  await writeFile(new URL('./TIMELINE.md', import.meta.url), rows.join('\n') + '\n');
  console.log(`Wrote ${inventory.entries.length} chronological Project States without network or LLM calls.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await replay();
