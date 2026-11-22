// Use an existing local Next server. Storage uses real HTTP + disk; only LLM is mocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { reportHandler } from '../report-agent/http.js';
import { mockStore } from './store.js';
const { chromium } = createRequire(import.meta.url)('../slide-export/node_modules/playwright-chromium');
const base = process.env.REPORT_TEST_URL || 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });
let testDatasetId;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('dialog', dialog => dialog.accept());
  const seed = await page.request.post(`${base}/api/reports/storage`, { data: { action: 'seed' } });
  assert.equal(seed.status(), 200);
  const seeded = (await seed.json()).datasets.find(item => item.label.includes('Schema'));
  assert.equal(new Set(seeded.snapshots.map(item => item.state.event_id)).size, 3);
  // Unique fixture imported via actual storage API; no existing draft is overwritten.
  const example = await import('node:fs/promises').then(fs => fs.readFile(new URL('../schemas/examples/normal.json', import.meta.url), 'utf8')).then(JSON.parse);
  const eventId = `mock-browser-${Date.now()}`;
  const state = { ...example, event_id: eventId };
  const registered = await page.request.post(`${base}/api/reports/storage`, { data: { action: 'dataset', dataset: { label: eventId, snapshots: [{ id: eventId, label: '瀏覽器測試', state }] } } });
  assert.equal(registered.status(), 200);
  const { dataset } = await registered.json();
  testDatasetId = dataset.id;
  await page.route('**/api/reports/generate', async route => {
    const response = await reportHandler('generate', { production: false, complete: async () => JSON.stringify({ pages: [{ title: '目前成果', bullets: ['提供報告預覽。'], script: '說明預覽能力。', source_ids: ['pr-41'] }] }) })(new Request(route.request().url(), { method: 'POST', body: route.request().postData() }));
    await route.fulfill({ status: response.status, json: await response.json() });
  });
  await page.route('**/api/reports/revise', route => route.fulfill({ json: { report: '# 更精簡的成果\n\n- 已提供報告預覽。\n\n## Speaker Notes\n\n重點說明。', message: '已縮短內容。' } }));
  await page.goto(`${base}/reports`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '載入 Mock 資料', exact: true }).click();
  await page.getByLabel('選擇專案資料', { exact: true }).selectOption(dataset.id);
  assert.equal(await page.getByLabel('允許按需讀取此版本 repo').isEnabled(), true);
  assert.equal(await page.getByLabel('允許按需讀取此版本 repo').isChecked(), true);
  await page.getByLabel('允許按需讀取此版本 repo').check();
  assert.equal(await page.getByLabel('允許按需讀取此版本 repo').isChecked(), true);
  // This storage-only test uses a fictional schema repo; API-level tests cover real reader orchestration.
  await page.getByLabel('允許按需讀取此版本 repo').uncheck();
  await page.getByRole('button', { name: '生成報告', exact: true }).click();
  const editor = page.getByLabel('直接編輯 Markdown', { exact: true });
  await page.waitForFunction(() => document.querySelector('#report-markdown')?.value.includes('目前成果'));
  const hasConversation = await page.getByLabel('修改要求', { exact: true }).count() > 0;
  if (hasConversation) {
    await page.getByLabel('修改前先確認差異').uncheck();
    await page.getByLabel('修改要求', { exact: true }).fill('縮短內容');
    await page.getByRole('button', { name: '套用修改', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#report-markdown')?.value.includes('更精簡'));
  }
  const manual = `${await editor.inputValue()}\n\n手動編輯也要保存。`;
  await editor.fill(manual);
  await page.getByLabel('報告生成需求（選填）').fill('給主管');
  const storageControls = page.locator('button').filter({ hasText: /^(儲存草稿|儲存草稿與對話|載入已存草稿)$/ });
  assert.equal(await storageControls.count(), 0);
  // Keep the original storage UI checks for a future re-enable.
  if (await storageControls.count()) {
  await page.getByRole('button', { name: hasConversation ? '儲存草稿與對話' : '儲存草稿', exact: true }).click();
  await page.getByText(/已儲存第 1 版/).waitFor();
  const query = `/api/reports/storage?${new URLSearchParams({ datasetId: dataset.id, snapshotId: eventId })}`;
  const saved = (await (await page.request.get(`${base}${query}`)).json()).draft;
  assert.equal(saved.report, manual); assert.equal(saved.history.length, hasConversation ? 2 : 0); assert.equal(saved.focus, '給主管');
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '載入 Mock 資料', exact: true }).click();
  await page.getByLabel('選擇專案資料', { exact: true }).selectOption(dataset.id);
  await page.getByRole('button', { name: '載入已存草稿', exact: true }).click();
  await page.getByText(/已載入第 1 版/).waitFor();
  assert.equal(await editor.inputValue(), manual);
  assert.equal(await page.getByLabel('報告生成需求（選填）').inputValue(), '給主管');
  if (hasConversation) assert.match(await page.getByLabel('對話紀錄').innerText(), /縮短內容/);
  else assert.equal(await page.getByLabel('對話紀錄').count(), 0);
  // Another client writes revision 2. Browser revision 1 must receive 409 and retain edits.
  const archivedHistory = [{ role: 'user', content: '保留的舊對話' }, { role: 'assistant', content: '保留的舊回覆' }];
  const concurrent = await page.request.post(`${base}/api/reports/storage`, { data: { action: 'save', datasetId: dataset.id, snapshotId: eventId, expectedRevision: 1, draft: { report: '另一頁面', history: archivedHistory, focus: '', request: '保留的舊要求' } } });
  assert.equal(concurrent.status(), 200);
  await editor.fill(`${manual}\n本頁未儲存變更`);
  await page.getByRole('button', { name: hasConversation ? '儲存草稿與對話' : '儲存草稿', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '另一個頁面更新' }).waitFor();
  assert.match(await editor.inputValue(), /本頁未儲存變更/);
  await page.getByRole('button', { name: '載入已存草稿', exact: true }).click();
  await page.getByText(/已載入第 2 版/).waitFor();
  await editor.fill('另一頁面的手動編輯');
  await page.getByRole('button', { name: hasConversation ? '儲存草稿與對話' : '儲存草稿', exact: true }).click();
  await page.getByText(/已儲存第 3 版/).waitFor();
  const retained = (await (await page.request.get(`${base}${query}`)).json()).draft;
  assert.deepEqual(retained.history, archivedHistory);
  assert.equal(retained.request, '保留的舊要求');
  } else {
    const current = await editor.inputValue();
    assert.ok(current.trim());
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '載入 Mock 資料', exact: true }).click();
    await page.getByLabel('選擇專案資料', { exact: true }).selectOption(dataset.id);
    assert.equal(await editor.inputValue(), '');
    assert.equal(await storageControls.count(), 0);
  }
  const storedState = (await (await page.request.get(`${base}/api/reports/storage`)).json()).datasets.find(item => item.id === dataset.id).snapshots[0].state;
  assert.deepEqual(storedState, state);
  console.log('PASS: Mock State loading, generation/manual editing, hidden draft controls, refresh clears report and State remains unchanged. Storage persistence is covered by unit tests. No paid LLM calls.');
} finally {
  try { await browser.close(); }
  finally { if (testDatasetId) await mockStore().removeBrowserTestDatasets([testDatasetId]); }
}
