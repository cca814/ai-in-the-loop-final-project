import { openTestWorkspace } from './browser-fixture.mjs';
// Existing local Next server; all model calls are mocked in this process.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { reportHandler } from './http.js';

const require = createRequire(import.meta.url);
const { chromium } = require('../slide-export/node_modules/playwright-chromium');
const base = process.env.REPORT_TEST_URL || 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const generate = reportHandler('generate', { production: false, complete: async () => JSON.stringify({ pages: [{ title: '進度摘要', bullets: ['報告編輯支援預覽。'], script: '原講稿，保持已確認的事實。', source_ids: ['pr-41'] }] }) });
  await page.route('**/api/reports/generate', async route => {
    const response = await generate(new Request(route.request().url(), { method: 'POST', body: route.request().postData() }));
    await route.fulfill({ status: response.status, json: await response.json() });
  });
  await page.route('**/api/reports/revise', async route => {
    const body = route.request().postDataJSON();
    if (body.request === '等待測試') {
      await new Promise(resolve => setTimeout(resolve, 600));
      try { await route.fulfill({ json: { report: body.report.replace('精簡講稿', '不應套用的晚到回覆'), message: 'Late response' } }); } catch { /* Browser cancelled. */ }
      return;
    }
    const revise = reportHandler('revise', { production: false, complete: async () => JSON.stringify(body.request === '壞來源測試'
      ? { changes: [{ old: '精簡講稿', new: '[不明來源](https://unverified.example/proof)' }], message: 'Invalid' }
      : { changes: [{ old: '手動講稿', new: '精簡講稿' }], message: '只縮短目前講稿。' }) });
    const response = await revise(new Request(route.request().url(), { method: 'POST', body: JSON.stringify(body) }));
    await route.fulfill({ status: response.status, json: await response.json() });
  });
  await openTestWorkspace(page, base);
  assert.equal(await page.getByRole('checkbox', { name: '修改前先確認差異', exact: true }).isChecked(), true);
  await page.getByRole('button', { name: '生成報告', exact: true }).click();
  const editor = page.getByLabel('直接編輯 Markdown');
  await page.waitForFunction(() => document.querySelector('#report-markdown').value.includes('原講稿'));
  const generated = await editor.inputValue();
  const longBody = Array.from({ length: 45 }, (_, index) => `### 驗收項目 ${index + 1}\n\n- **重點**：報告編輯支援預覽。\n\n`).join('') + '| 項目 | 狀態 |\n| --- | --- |\n| 預覽 | 可用 |\n\n';
  await editor.fill(generated.replace('原講稿', '手動講稿').replace('## Speaker Notes', `${longBody}## Speaker Notes`));
  const manual = await editor.inputValue();
  await page.getByLabel('修改要求', { exact: true }).fill('縮短講稿');
  await page.getByRole('button', { name: '預覽修改', exact: true }).click();
  const reviewDialog = page.getByRole('dialog', { name: '確認修改後再套用', exact: true });
  await reviewDialog.waitFor();
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'revision-review-title');
  for (let index = 0; index < 10; index++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('dialog')), true);
  }
  const beforePreview = page.getByRole('region', { name: '修改前', exact: true });
  const afterPreview = page.getByRole('region', { name: '修改後', exact: true });
  assert.equal(await beforePreview.locator('h1').textContent(), '進度摘要');
  assert.equal(await afterPreview.locator('table').count(), 1);
  assert.equal(await beforePreview.locator('strong').count(), 45);
  assert.equal(await beforePreview.locator('pre').count(), 0);
  assert.ok((await afterPreview.locator('a').first().getAttribute('rel')).includes('noopener'));
  for (const [source, target, ratio] of [['before', 'after', .42], ['after', 'before', .77], ['before', 'after', 1], ['after', 'before', 0]]) {
    await page.getByRole('region', { name: source === 'before' ? '修改前' : '修改後', exact: true }).evaluate((element, value) => { element.scrollTop = value * (element.scrollHeight - element.clientHeight); }, ratio);
    await page.waitForFunction(({ target, ratio }) => {
      const element = document.querySelector(`[aria-labelledby="revision-${target}-label"]`);
      const range = element.scrollHeight - element.clientHeight;
      return range > 0 && Math.abs(element.scrollTop / range - ratio) < .015;
    }, { target, ratio });
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const bounds = await beforePreview.evaluate(element => ({ height: element.clientHeight, range: element.scrollHeight - element.clientHeight }));
    assert.ok(bounds.height > 200 && bounds.height < 1000 && bounds.range > 0);
    const modalBounds = await reviewDialog.boundingBox();
    assert.ok(modalBounds.width >= width * .9 && modalBounds.height >= 900);
    assert.ok(modalBounds.x >= 0 && modalBounds.y >= 0 && modalBounds.x + modalBounds.width <= width + 1);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log('Revision previews passed: rendered headings, emphasis, GFM table, safe links, bounded heights and bidirectional proportional scrolling.');
  assert.equal(await editor.inputValue(), manual);
  assert.equal(await page.getByRole('log').count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(await reviewDialog.isVisible(), false);
  assert.equal(await editor.inputValue(), manual);
  await page.getByRole('button', { name: '開啟修改預覽', exact: true }).click();
  await reviewDialog.waitFor();
  await page.getByRole('button', { name: '捨棄這次修改', exact: true }).click();
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
  assert.equal(await editor.inputValue(), manual);
  assert.equal(await page.getByLabel('修改要求', { exact: true }).inputValue(), '縮短講稿');
  await page.getByRole('button', { name: '預覽修改', exact: true }).click();
  await page.getByRole('button', { name: '接受這次修改', exact: true }).click();
  const accepted = manual.replace('手動講稿', '精簡講稿');
  assert.equal(await editor.inputValue(), accepted);
  assert.equal(await page.locator('.reports-chatLog strong').count(), 2);
  await page.getByRole('button', { name: '復原上一版', exact: true }).click();
  assert.equal(await editor.inputValue(), manual);
  assert.equal(await page.locator('.reports-chatLog strong').count(), 0);
  await page.getByRole('button', { name: '恢復剛才的修改', exact: true }).click();
  assert.equal(await editor.inputValue(), accepted);
  assert.equal(await page.locator('.reports-chatLog strong').count(), 2);
  assert.equal(await page.getByRole('button', { name: '檢查目前草稿', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '下載報告與審閱紀錄', exact: true }).count(), 0);
  await page.getByLabel('修改要求', { exact: true }).fill('壞來源測試');
  await page.getByRole('button', { name: '預覽修改', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'REVISION_SOURCE_INVALID' }).waitFor();
  assert.equal(await editor.inputValue(), accepted);
  await page.getByLabel('修改要求', { exact: true }).fill('等待測試');
  await page.getByRole('button', { name: '預覽修改', exact: true }).click();
  await page.getByRole('button', { name: '取消目前操作', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '操作已取消' }).waitFor();
  await page.waitForTimeout(800);
  assert.equal(await editor.inputValue(), accepted);
  assert.equal(await page.getByLabel('修改要求', { exact: true }).inputValue(), '等待測試');
  assert.equal(await page.getByRole('dialog', { name: '確認修改後再套用', exact: true }).count(), 0);
  let warned = false;
  page.once('dialog', async dialog => { warned = dialog.type() === 'beforeunload'; await dialog.dismiss(); });
  try { await page.reload({ timeout: 3000 }); } catch { /* Navigation correctly blocked. */ }
  assert.equal(warned, true);
  assert.equal(await editor.inputValue(), accepted);
  console.log('Optimization UI passed: review/reject/accept, undo/redo with history, quality and provenance download, State-only source rejection, cancellation with stale-response protection, and unload warning. No provider calls.');
} finally { await browser.close(); }
