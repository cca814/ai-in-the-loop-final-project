// Existing Next dev server; model requests are intercepted, never sent externally.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { openTestWorkspace } from './browser-fixture.mjs';
import { reportHandler } from './http.js';
const { chromium } = createRequire(import.meta.url)('../slide-export/node_modules/playwright-chromium');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('**/api/reports/generate', async route => {
    const handler = reportHandler('generate', { production: false, complete: async () => JSON.stringify({ pages: [{ title: '目前成果', bullets: ['編輯器提供報告預覽。'], script: '說明報告編輯器的預覽能力。', source_ids: ['pr-41'] }] }) });
    const response = await handler(new Request(route.request().url(), { method: 'POST', body: route.request().postData() }));
    await route.fulfill({ status: response.status, json: await response.json() });
  });
  await openTestWorkspace(page, process.env.REPORT_TEST_URL || 'http://localhost:3000');
  assert.equal(await page.getByLabel('選擇歷史版本').count(), 1);
  await page.getByRole('button', { name: '生成報告', exact: true }).click();
  const editor = page.getByLabel('直接編輯 Markdown');
  await page.waitForFunction(() => document.querySelector('#report-markdown').value.includes('目前成果'));
  const source = '# 長報告\n\n' + Array.from({ length: 60 }, (_, i) => `## 段落 ${i}\n\n- **重點**與說明\n\n`).join('') + '| 項目 | 狀態 |\n| --- | --- |\n| 編輯 | 完成 |\n\n- [x] 預覽\n\n[連結](https://example.com)\n\n<script>window.untrustedCodeRan=true</script>\n\n## Speaker Notes\n\n保留講稿。';
  await editor.fill(source); await page.getByRole('button', { name: '雙欄', exact: true }).click();
  const preview = page.getByRole('region', { name: '報告預覽', exact: true });
  assert.equal(await preview.locator('table').count(), 1); assert.equal(await preview.locator('script').count(), 0);
  assert.equal(await page.evaluate(() => window.untrustedCodeRan), undefined);
  assert.ok((await preview.locator('a').getAttribute('rel')).includes('noopener'));
  for (const [selector, target, ratio] of [['#report-markdown', '.reports-markdownPreview', .45], ['.reports-markdownPreview', '#report-markdown', .8]]) {
    await page.locator(selector).evaluate((element, value) => { element.scrollTop = value * (element.scrollHeight - element.clientHeight); }, ratio);
    await page.waitForFunction(({ target, ratio }) => { const element = document.querySelector(target); return Math.abs(element.scrollTop / (element.scrollHeight - element.clientHeight) - ratio) < .015; }, { target, ratio });
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const size = await preview.evaluate(element => ({ height: element.clientHeight, range: element.scrollHeight - element.clientHeight }));
    assert.ok(size.height <= 560 && size.range > 0);
  }
  assert.equal(await editor.inputValue(), source);
  await page.getByRole('button', { name: '檢視', exact: true }).click(); assert.equal(await page.locator('#report-markdown').count(), 0);
  await page.getByRole('button', { name: '編輯', exact: true }).click(); assert.equal(await editor.inputValue(), source);
  console.log('Generic workspace: safe GFM preview, editor modes, bounded desktop/mobile heights and bidirectional scrolling passed.');
} finally { await browser.close(); }
