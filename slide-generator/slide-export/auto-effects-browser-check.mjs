// Uses the existing local Next server. All model responses are mocked; builds
// and downloads use the real compiled Next routes and installed Slidev CLI.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-chromium';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { slideHandler } from './http.js';

const base = process.env.REPORT_TEST_URL || 'http://localhost:3000';
const report = '# Progress summary\n\n- First confirmed result\n- Second confirmed result\n\n## Speaker Notes\n\nKeep these exact speaker notes.\n\n---\n\n# Current situation\n\n- Existing open item\n\n## Speaker Notes\n\nDescribe the existing open item.\n\n## Sources\n\n- [Evidence](https://example.com/evidence)';
const plan = { pages: [
  { transition: 'fade', layout: 'default', reveal: true, clickAnimation: 'up' },
  { transition: 'slide-left', layout: 'center', reveal: false, clickAnimation: 'fade' },
] };
let modelCalls = 0;
const handler = slideHandler('slides', { production: false, complete: async () => { modelCalls++; return JSON.stringify(plan); } });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('**/api/reports/generate', route => route.fulfill({ json: { report } }));
  await page.route('**/api/reports/slides', async route => {
    const response = await handler(new Request(route.request().url(), { method: 'POST', body: route.request().postData() }));
    await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
  });
  await page.goto(`${base}/reports`, { waitUntil: 'networkidle' });
  assert.equal(await page.getByLabel('網頁播放轉場').inputValue(), 'auto');
  await page.getByRole('button', { name: '生成報告', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#report-markdown').value.includes('First confirmed result'));
  await page.getByRole('checkbox', { name: '我已確認目前報告內容' }).check();
  await page.getByRole('button', { name: '產生 Slidev 原稿', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#slides-markdown')?.value.includes('<v-clicks>'));
  const source = await page.locator('#slides-markdown').inputValue();
  assert.equal(modelCalls, 1);
  assert.equal(await page.getByLabel('直接編輯 Markdown').inputValue(), report);

  const webRequest = page.waitForRequest('**/api/reports/web');
  await page.getByRole('button', { name: '建立網頁簡報', exact: true }).click();
  assert.deepEqual((await webRequest).postDataJSON().presentationPlan, plan);
  const link = page.getByRole('link', { name: '開啟播放', exact: true });
  await link.waitFor({ timeout: 150000 });
  const player = await browser.newPage();
  await player.goto(new URL(await link.getAttribute('href'), base).href, { waitUntil: 'networkidle' });
  await player.evaluate(() => {
    window.observedTransitions = [];
    new MutationObserver(records => {
      for (const record of records) for (const name of record.target.classList || []) if (/^(fade|slide-left)-(enter|leave)/.test(name)) window.observedTransitions.push(name);
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  const first = player.getByText('First confirmed result', { exact: true }).first();
  const second = player.getByText('Second confirmed result', { exact: true }).first();
  assert.equal(await first.evaluate(el => el.classList.contains('slidev-vclick-hidden')), true);
  assert.equal(await first.evaluate(el => el.classList.contains('slidev-vclick-anim-up')), true);
  await player.keyboard.press('ArrowRight');
  await player.waitForTimeout(400);
  assert.equal(await first.evaluate(el => el.classList.contains('slidev-vclick-hidden')), false);
  assert.equal(await second.evaluate(el => el.classList.contains('slidev-vclick-hidden')), true);
  await player.keyboard.press('ArrowRight');
  await player.waitForTimeout(400);
  assert.equal(await second.evaluate(el => el.classList.contains('slidev-vclick-hidden')), false);
  await player.keyboard.press('ArrowRight');
  await player.waitForTimeout(500);
  assert.ok(await player.getByRole('heading', { name: 'Current situation', exact: true }).isVisible());
  assert.ok(await player.evaluate(() => window.observedTransitions.length > 0));
  console.log('Automatic web effects passed: real built slides, click-by-click reveal, animation preset, transition and navigation; confirmed report unchanged.');

  // Compiled endpoints must reconstruct exactly the same source without calling
  // any provider, and static exports must include the final revealed state.
  for (const format of ['pptx', 'pptx-editable']) {
    const response = await page.request.post(`${base}/api/reports/export`, { data: { report, transition: 'auto', presentationPlan: plan, format }, timeout: 150000 });
    assert.equal(response.status(), 200, `PPTX export failed (${format})`);
    const zip = await JSZip.loadAsync(await response.body());
    const slideFiles = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    assert.equal(slideFiles.length, 2);
    const notesFiles = Object.keys(zip.files).filter(name => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name));
    assert.equal(notesFiles.length, 2);
    const notes = (await Promise.all(notesFiles.map(name => zip.file(name).async('string')))).join('\n');
    assert.match(notes, /Keep these exact speaker notes/);
    if (format === 'pptx-editable') {
      const text = (await Promise.all(slideFiles.map(name => zip.file(name).async('string')))).join('\n');
      assert.match(text, /First confirmed result/);
      assert.match(text, /Second confirmed result/);
      assert.match(text, /Existing open item/);
    }
    console.log(`${format} passed: two final-state pages and exact speaker notes.`);
  }
  const portable = await page.request.post(`${base}/api/reports/portable`, { data: { report, transition: 'auto', presentationPlan: plan }, timeout: 150000 });
  assert.equal(portable.status(), 200);
  const archive = await JSZip.loadAsync(await portable.body());
  const slidesFile = Object.keys(archive.files).find(name => name.endsWith('/slides.md'));
  assert.ok(slidesFile);
  assert.equal(await archive.file(slidesFile).async('string'), source);
  assert.ok(Object.keys(archive.files).some(name => name.endsWith('/site/index.html')));
  assert.equal(modelCalls, 1);
  console.log('Portable ZIP passed: same Slidev source, effects and offline build; exports made no additional model calls.');

  await page.getByRole('button', { name: '產生 Slidev 原稿', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].find(button => button.textContent === '產生 Slidev 原稿')?.disabled === false);
  assert.equal(modelCalls, 2);
  assert.equal(await page.getByRole('link', { name: '開啟播放', exact: true }).count(), 0);
  console.log('Regenerated effects invalidate the previous playback link.');

  // A failed regeneration must leave the existing downloadable source intact.
  await page.unroute('**/api/reports/slides');
  await page.route('**/api/reports/slides', route => route.fulfill({ status: 502, json: { error: 'Mock effect planning failure' } }));
  await page.getByRole('button', { name: '產生 Slidev 原稿', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Mock effect planning failure' }).waitFor();
  assert.equal(await page.locator('#slides-markdown').inputValue(), source);
  assert.equal(await page.getByLabel('直接編輯 Markdown').inputValue(), report);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '下載 slides.md', exact: true }).click();
  assert.equal(await readFile(await (await downloaded).path(), 'utf8'), source);
  console.log('Failed regeneration preserves existing report and generated slides. No real LLM requests were sent.');
} finally {
  await browser.close();
}
