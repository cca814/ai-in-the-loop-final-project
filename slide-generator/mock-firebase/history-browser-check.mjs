// Real Next storage + disk; generation/revision handlers use an injected model.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { sample } from '../state-replay/testing/sample.js';
import { localReportHandler } from '../state-replay/integration.js';
import { mockStore } from './store.js';
const { chromium } = createRequire(import.meta.url)('../slide-export/node_modules/playwright-chromium');
const base = process.env.REPORT_TEST_URL || 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });
let testDatasetId;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('dialog', dialog => dialog.accept());
  const fixture = sample();
  const runId = Date.now();
  const states = fixture.states.map((state, i) => ({ ...state, project_id: `test-history-${runId}`, event_id: `mock-history-${runId}-${i}`, base_state_id: i ? `mock-history-${runId}-${i - 1}` : null }));
  const response = await page.request.post(`${base}/api/reports/storage`, { data: { action: 'dataset', dataset: { label: `mock-history-browser-${runId}`, snapshots: states.map(state => ({ id: state.event_id, label: state.event_id, state })), mergeMetadata: fixture.plan.merges.map(item => ({ commit: item.commit, pr_number: item.pr_number, merged_at: item.merged_at })) } } });
  assert.equal(response.status(), 200);
  const { dataset } = await response.json(); assert.equal(dataset.supportsHistory, true);
  testDatasetId = dataset.id;
  const seen = [];
  for (const mode of ['generate', 'revise']) await page.route(`**/api/reports/${mode}`, async route => {
    const handler = localReportHandler(mode, { production: false, complete: async messages => {
      const payload = JSON.parse(messages[1].content);
      seen.push({ mode, history: payload.merge_history });
      assert.deepEqual(payload.merge_history.merges.map(item => item.pr_number), [3, 12]);
      return JSON.stringify(mode === 'generate'
        ? { pages: [{ title: '期間成果', bullets: ['工作執行實作已更新。'], script: '原始期間講稿。', source_ids: ['merge-pr-3', 'merge-pr-12'] }] }
        : { changes: [{ old: '原始期間講稿。', new: '調整後的期間講稿。' }], message: '依區間紀錄調整講稿。' });
    } });
    const result = await handler(new Request(route.request().url(), { method: 'POST', body: route.request().postData() }));
    await route.fulfill({ status: result.status, json: await result.json() });
  });
  await page.goto(`${base}/reports`, { waitUntil: 'networkidle' });
  await page.getByLabel('Project ID', { exact: true }).fill(states[0].project_id);
  await page.getByRole('button', { name: '載入專案 States', exact: true }).click();
  await page.getByText(`已載入專案 ${states[0].project_id} 的全部 3 版 State。`, { exact: true }).waitFor();
  assert.equal(await page.getByLabel('選擇專案資料', { exact: true }).locator('option').count(), 1);
  // Successful IDs survive refresh; choosing one only fills the input, then the user loads it.
  await page.reload({ waitUntil: 'networkidle' });
  const recent = page.getByLabel('最近載入的 Project ID', { exact: true });
  await recent.selectOption(states[0].project_id);
  assert.equal(await page.getByLabel('Project ID', { exact: true }).inputValue(), states[0].project_id);
  assert.equal(await page.getByLabel('選擇專案資料', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '載入專案 States', exact: true }).click();
  await page.getByText(`已載入專案 ${states[0].project_id} 的全部 3 版 State。`, { exact: true }).waitFor();
  assert.equal(await recent.locator('option').count(), 2); // Placeholder plus one deduplicated ID.
  // Invalid IDs preserve the already loaded project and its historical controls.
  await page.getByLabel('Project ID', { exact: true }).fill('unknown-project');
  await page.getByRole('button', { name: '載入專案 States', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '找不到此 project ID' }).waitFor();
  assert.equal(await recent.locator('option[value="unknown-project"]').count(), 0);
  assert.equal(await page.getByLabel('選擇專案資料', { exact: true }).inputValue(), dataset.id);
  assert.equal(await page.getByLabel('允許按需讀取此版本 repo').isChecked(), true);
  await page.getByLabel('允許按需讀取此版本 repo').uncheck(); // This check isolates stored history; no external GitHub reads.
  assert.equal(await page.locator('#state-snapshot').inputValue(), states.at(-1).event_id);
  await page.locator('#state-history > summary').click();
  await page.getByLabel('彙整合併區間', { exact: true }).check();
  await page.getByLabel('區間開始快照（含）', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: '生成報告', exact: true }).click();
  const editor = page.getByLabel('直接編輯 Markdown', { exact: true });
  await page.waitForFunction(() => document.querySelector('#report-markdown')?.value.includes('原始期間講稿'));
  const before = await editor.inputValue();
  const hasConversation = await page.getByLabel('修改要求', { exact: true }).count() > 0;
  if (hasConversation) {
  await page.getByLabel('修改要求', { exact: true }).fill('說明所選期間的變更，調整講稿');
  await page.getByRole('button', { name: '預覽修改', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '確認修改後再套用', exact: true });
  await dialog.waitFor();
  const bounds = await dialog.boundingBox(); assert.ok(bounds.width > 1300 && bounds.height > 900);
  assert.equal(await editor.inputValue(), before);
  await page.getByRole('button', { name: '稍後再確認', exact: true }).click();
  assert.equal(await dialog.isVisible(), false);
  await page.getByRole('button', { name: '開啟修改預覽', exact: true }).click();
  await page.getByRole('button', { name: '接受這次修改', exact: true }).click();
  assert.ok((await editor.inputValue()).includes('調整後的期間講稿'));
  } else {
    await editor.fill(before.replace('原始期間講稿。', '手動調整期間講稿。'));
    assert.equal(await page.getByRole('dialog').count(), 0);
  }
  const storageControls = page.locator('button').filter({ hasText: /^(儲存草稿|儲存草稿與對話|載入已存草稿)$/ });
  assert.equal(await storageControls.count(), 0);
  // Keep the original storage UI checks for a future re-enable.
  if (await storageControls.count()) {
  await page.getByRole('button', { name: hasConversation ? '儲存草稿與對話' : '儲存草稿', exact: true }).click();
  await page.getByText(/已儲存第 1 版/).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '載入 Mock 資料', exact: true }).click();
  await page.getByLabel('選擇專案資料', { exact: true }).selectOption(dataset.id);
  await page.getByRole('button', { name: '載入已存草稿', exact: true }).click();
  await page.getByText(/已載入第 1 版/).waitFor();
  await page.locator('#state-history > summary').click();
  assert.equal(await page.getByLabel('彙整合併區間', { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel('區間開始快照（含）', { exact: true }).inputValue(), '1');
  } else {
    const current = await editor.inputValue();
    assert.ok(current.trim());
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '載入 Mock 資料', exact: true }).click();
    await page.getByLabel('選擇專案資料', { exact: true }).selectOption(dataset.id);
    assert.equal(await editor.inputValue(), '');
    assert.equal(await storageControls.count(), 0);
  }
  assert.deepEqual(seen.map(item => item.mode), hasConversation ? ['generate', 'revise'] : ['generate']);
  console.log('PASS: Mock history metadata, selected generation range, manual editing, hidden draft controls and refresh clears report. No provider/GitHub calls.');
} finally {
  try { await browser.close(); }
  finally { if (testDatasetId) await mockStore().removeBrowserTestDatasets([testDatasetId]); }
}
