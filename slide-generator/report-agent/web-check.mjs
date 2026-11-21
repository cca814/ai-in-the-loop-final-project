// Optional browser smoke test. Uses sibling slide-export's existing Playwright.
// No .env.local is loaded, and all generation/revision calls are intercepted.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { reportHandler } from './http.js';

const require = createRequire(import.meta.url);
const { chromium } = require('../slide-export/node_modules/playwright-chromium');
const cwd = fileURLToPath(new URL('../', import.meta.url));
const baseUrl = process.env.REPORT_TEST_URL || 'http://127.0.0.1:39462';
const server = process.env.REPORT_TEST_URL ? null : spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '39462'], {
  cwd,
  env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, USERPROFILE: process.env.USERPROFILE, NODE_ENV: 'test', NEXT_TELEMETRY_DISABLED: '1' },
  stdio: ['pipe', 'ignore', 'ignore'],
});
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let ready = false;
  for (let attempt = 0; attempt < 35; attempt++) {
    try { await page.goto(`${baseUrl}/reports`, { waitUntil: 'networkidle', timeout: 15000 }); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  if (!ready) throw new Error('Next.js preview did not start');
  await page.getByRole('heading', { name: '專案進度報告' }).waitFor();
  const layout = await page.locator('main').evaluate(element => ({
    className: element.className,
    padding: getComputedStyle(element).paddingTop,
    background: getComputedStyle(element).backgroundColor,
  }));
  assert.notEqual(layout.padding, '0px', `Workspace styling is missing: ${JSON.stringify(layout)}`);
  assert.equal(layout.background, 'rgb(243, 245, 248)');
  if (process.env.REPORT_TEST_SCREENSHOT) await page.screenshot({ path: process.env.REPORT_TEST_SCREENSHOT, fullPage: true });
  const editor = page.getByLabel('直接編輯 Markdown');
  const original = '# 專案概述\n\n- Example fact\n\n## 講者備忘\n\nOriginal note.\n\n## 來源\n\n- [Example source](https://example.com/source)\n\n---\n\n# 功能進度\n\n- Another fact\n\n## 講者備忘\n\nSecond note.\n\n## 來源\n\n- [Example source](https://example.com/source)';
  let revisionCount = 0;
  await page.route('**/api/reports/generate', route => route.fulfill({ json: { report: original } }));
  await page.route('**/api/reports/revise', route => {
    const body = route.request().postDataJSON();
    revisionCount++;
    assert.ok(body.report.includes('Manual edit'));
    if (revisionCount === 1) {
      assert.equal(body.history.length, 0);
      return route.fulfill({ json: { report: body.report.replace('Original note.', 'Short note.'), message: 'Shortened.' } });
    }
    assert.equal(body.history.length, 2);
    return route.fulfill({ status: 502, json: { error: '模擬供應商暫時不可用', code: 'PROVIDER_UNAVAILABLE' } });
  });
  await page.getByRole('button', { name: '生成報告', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#report-markdown').value.includes('Original note.'));
  await editor.fill(`${original}\nManual edit`);
  await page.getByLabel('修改要求', { exact: true }).fill('Shorten notes');
  await page.getByRole('button', { name: '套用修改', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#report-markdown').value.includes('Short note.'));
  assert.ok((await editor.inputValue()).includes('Manual edit'));
  // Display modes must preserve the exact report used by revision/export.
  const edited = await editor.inputValue();
  const preview = page.getByRole('region', { name: '報告預覽', exact: true });
  await page.getByRole('button', { name: '檢視', exact: true }).click();
  await preview.getByRole('heading', { name: '專案概述', exact: true }).waitFor();
  assert.equal(await editor.count(), 0);
  assert.equal(await preview.getByRole('link', { name: 'Example source', exact: true }).first().getAttribute('href'), 'https://example.com/source');
  await page.getByRole('button', { name: '雙欄', exact: true }).click();
  assert.equal(await editor.inputValue(), edited);
  await editor.fill(edited.replace('Example fact', '**Live preview fact**'));
  await preview.locator('strong').filter({ hasText: 'Live preview fact' }).waitFor();
  const richText = '# 預覽測試\n\n| 功能 | 狀態 |\n| --- | --- |\n| 編輯器 | 完成 |\n\n- [x] Checked\n\n```js\nconst example = 1;\n```\n\n<script>window.previewExecuted = true</script>\n\n[Unsafe](javascript:alert(1))';
  await editor.fill(richText);
  await preview.locator('table').waitFor();
  assert.equal(await preview.getByRole('checkbox').isChecked(), true);
  assert.equal(await preview.getByRole('checkbox').isDisabled(), true);
  assert.match(await preview.locator('pre code').innerText(), /const example = 1/);
  assert.equal(await preview.locator('script').count(), 0);
  assert.equal(await preview.locator('a[href^="javascript:"]').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.equal(await page.locator('.reports-markdownWorkspace').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(await page.locator('.reports-markdownWorkspace').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 2);
  await editor.fill(edited);
  await page.getByRole('button', { name: '編輯', exact: true }).click();
  assert.equal(await editor.inputValue(), edited);
  assert.equal(await preview.count(), 0);
  console.log('Markdown editor modes passed: live preview, source preservation, GFM tables/tasks/code, safe rendering and responsive split layout.');
  await page.getByLabel('修改要求', { exact: true }).fill('Another revision');
  await page.getByRole('button', { name: '套用修改', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '模擬供應商暫時不可用' }).waitFor();
  assert.match(await page.locator('.reports-error').innerText(), /PROVIDER_UNAVAILABLE/);
  assert.ok((await editor.inputValue()).includes('Short note.'));
  assert.equal(await page.getByLabel('修改要求', { exact: true }).inputValue(), 'Another revision');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下載 Markdown' }).click();
  assert.match((await download).suggestedFilename(), /report\.md$/);
  await page.getByLabel('網頁播放轉場').selectOption('fade');
  await page.getByRole('checkbox', { name: '我已確認目前報告內容' }).check();
  await page.getByRole('button', { name: '產生 Slidev 原稿', exact: true }).click();
  await page.getByRole('button', { name: '下載 slides.md' }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === '下載 slides.md').disabled);
  const slidesDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下載 slides.md' }).click();
  assert.match((await slidesDownload).suggestedFilename(), /slides\.md$/);
  if (process.env.REPORT_TEST_WEB === '1') {
    await page.getByRole('button', { name: '建立網頁簡報', exact: true }).click();
    await Promise.race([
      page.getByRole('link', { name: '開啟播放', exact: true }).waitFor({ timeout: 140000 }),
      page.locator('.reports-error').waitFor({ state: 'visible', timeout: 140000 }).then(async () => { throw new Error(await page.locator('.reports-error').innerText()); }),
    ]);
    const url = await page.getByRole('link', { name: '開啟播放', exact: true }).getAttribute('href');
    const presentation = await browser.newPage();
    await presentation.goto(new URL(url, baseUrl).href, { waitUntil: 'networkidle' });
    await presentation.getByRole('heading', { name: '專案概述', exact: true }).waitFor();
    await presentation.evaluate(() => {
      window.transitionClasses = [];
      new MutationObserver(records => {
        for (const record of records) if (record.target.classList) for (const name of record.target.classList) if (/^fade-(enter|leave)/.test(name)) window.transitionClasses.push(name);
      }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] });
    });
    await presentation.keyboard.press('ArrowRight');
    await presentation.getByRole('heading', { name: '功能進度', exact: true }).waitFor();
    await presentation.waitForTimeout(600);
    assert.ok(await presentation.evaluate(() => window.transitionClasses.length > 0));
    await presentation.reload({ waitUntil: 'networkidle' });
    await presentation.getByRole('heading', { name: '功能進度', exact: true }).waitFor();
    await presentation.close();
    console.log('Browser Slidev web playback passed: built assets, navigation, fade transition and direct slide reload.');
  }
  if (process.env.REPORT_TEST_PPTX === '1') {
    await page.getByLabel('簡報形式', { exact: true }).selectOption('pptx');
    for (const format of ['pptx', 'pptx-editable']) {
      await page.getByLabel('PPTX 格式', { exact: true }).selectOption(format);
      const pptxDownload = page.waitForEvent('download', { timeout: 140000 });
      await page.getByRole('button', { name: '下載 PPTX', exact: true }).click();
      const outcome = await Promise.race([
        pptxDownload.then(file => ({ file })),
        page.locator('.reports-error').waitFor({ state: 'visible', timeout: 140000 }).then(async () => ({ error: await page.locator('.reports-error').innerText() })),
      ]);
      if ('error' in outcome) throw new Error(outcome.error);
      assert.match(outcome.file.suggestedFilename(), /\.pptx$/);
      const data = await readFile(await outcome.file.path());
      assert.equal(data.subarray(0, 2).toString(), 'PK');
      console.log(`Browser PPTX download passed: ${format}`);
    }
  }
  if (process.env.REPORT_TEST_PORTABLE === '1') {
    await page.getByLabel('簡報形式', { exact: true }).selectOption('portable');
    const download = page.waitForEvent('download', { timeout: 140000 });
    await page.getByRole('button', { name: '下載可攜式資料夾', exact: true }).click();
    const outcome = await Promise.race([
      download.then(file => ({ file })),
      page.locator('.reports-error').waitFor({ state: 'visible', timeout: 140000 }).then(async () => ({ error: await page.locator('.reports-error').innerText() })),
    ]);
    if ('error' in outcome) throw new Error(outcome.error);
    assert.match(outcome.file.suggestedFilename(), /portable\.zip$/);
    const JSZip = require('../slide-export/node_modules/jszip');
    const zip = await JSZip.loadAsync(await readFile(await outcome.file.path()));
    const directory = await mkdtemp(new URL('../slide-export/node_modules/portable-check-', import.meta.url));
    let portableServer;
    const context = await browser.newContext();
    try {
      for (const [name, entry] of Object.entries(zip.files)) {
        assert.ok(name.split('/').every(part => part !== '..' && !part.includes('\\') && !part.includes(':')));
        const path = join(directory, name);
        if (entry.dir) await mkdir(path, { recursive: true });
        else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, await entry.async('nodebuffer')); }
      }
      const entry = join(directory, 'presentation/serve.mjs');
      portableServer = spawn(process.execPath, [entry], { env: { SystemRoot: process.env.SystemRoot }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const address = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Portable server startup timeout')), 10000);
        portableServer.once('error', error => { clearTimeout(timeout); reject(error); });
        portableServer.once('exit', () => { clearTimeout(timeout); reject(new Error('Portable server exited before startup')); });
        portableServer.stdout.on('data', chunk => {
          const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+\//);
          if (match) { clearTimeout(timeout); resolve(match[0]); }
        });
      });
      const externalRequests = [];
      await context.route('**/*', route => {
        if (route.request().url().startsWith(address)) return route.continue();
        externalRequests.push(route.request().url());
        return route.abort();
      });
      const deck = await context.newPage();
      await deck.goto(address, { waitUntil: 'networkidle' });
      await deck.getByRole('heading', { name: '專案概述', exact: true }).waitFor();
      await deck.evaluate(() => {
        window.fadeSeen = false;
        new MutationObserver(records => {
          for (const record of records) if (record.target.classList && [...record.target.classList].some(name => /^fade-(enter|leave)/.test(name))) window.fadeSeen = true;
        }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] });
      });
      await deck.keyboard.press('ArrowRight');
      await deck.getByRole('heading', { name: '功能進度', exact: true }).waitFor();
      await deck.waitForTimeout(600);
      assert.ok(await deck.evaluate(() => window.fadeSeen));
      await deck.reload({ waitUntil: 'networkidle' });
      await deck.getByRole('heading', { name: '功能進度', exact: true }).waitFor();
      assert.deepEqual(externalRequests, [], 'Portable playback requested an external resource');
      console.log('Portable ZIP passed: extracted launcher, independent server, offline playback, fade transition, navigation and direct slide reload.');
    } finally {
      await context.close();
      if (portableServer && portableServer.exitCode === null) {
        const stopped = new Promise(resolve => portableServer.once('exit', resolve));
        portableServer.kill();
        await stopped;
      }
      await rm(directory, { recursive: true, force: true });
    }
  }
  await editor.fill((await editor.inputValue()) + '\nAnother manual change');
  assert.equal(await page.getByRole('button', { name: process.env.REPORT_TEST_PORTABLE === '1' ? '下載可攜式資料夾' : process.env.REPORT_TEST_PPTX === '1' ? '下載 PPTX' : '建立網頁簡報', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('link', { name: '開啟播放', exact: true }).count(), 0);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByLabel('選擇範例快照').selectOption('featureDone');
  assert.equal(await page.getByLabel('選擇範例快照').inputValue(), 'normal');
  // Exercise the actual historical State fixtures, never real model requests.
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('選擇專案資料').selectOption('p-limit');
  assert.equal(await editor.inputValue(), '');
  assert.equal(await page.getByRole('checkbox', { name: '我已確認目前報告內容' }).isChecked(), false);
  assert.equal(await page.getByRole('button', { name: '下載 slides.md' }).isDisabled(), true);
  assert.equal(await page.locator('.reports-chatLog strong').count(), 0);
  assert.equal(await page.getByRole('button', { name: '上一版', exact: true }).isDisabled(), true);
  const inventory = JSON.parse(await readFile(new URL('../test-data/p-limit/inventory.json', import.meta.url)));
  let latest;
  const snapshot = page.getByLabel('選擇合併快照');
  assert.equal(await snapshot.locator('option').count(), inventory.entries.length);
  for (const entry of inventory.entries) {
    await snapshot.selectOption(`p-limit-pr-${entry.pr}`);
    const expected = JSON.parse(await readFile(new URL(`../test-data/p-limit/states/${entry.file}`, import.meta.url)));
    const displayed = JSON.parse(await page.locator('.reports-details pre').textContent());
    assert.deepEqual(displayed, expected);
    assert.equal(await page.locator('.reports-summary strong').innerText(), 'p-limit');
    latest = expected;
  }
  assert.equal(await page.getByRole('button', { name: '下一版', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '上一版', exact: true }).click();
  assert.equal(await snapshot.inputValue(), 'p-limit-pr-108');
  await page.getByRole('button', { name: '下一版', exact: true }).click();
  assert.equal(await snapshot.inputValue(), 'p-limit-pr-109');
  const stateDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下載 Project State', exact: true }).click();
  const stateFile = await stateDownload;
  assert.match(stateFile.suggestedFilename(), /^p-limit-pr-109-.*\.json$/);
  assert.deepEqual(JSON.parse(await readFile(await stateFile.path(), 'utf8')), latest);
  const historicalReport = `# p-limit\n\n- ${latest.trigger.summary}\n\n## Speaker Notes\n\nHistorical note.\n\n## Sources\n\n- [PR #109](https://github.com/sindresorhus/p-limit/pull/109)`;
  await page.route('**/api/reports/generate', route => {
    assert.deepEqual(route.request().postDataJSON().state, latest);
    return route.fulfill({ json: { report: historicalReport } });
  });
  await page.getByRole('button', { name: '生成報告', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#report-markdown').value.includes('Historical note.'));
  await page.route('**/api/reports/revise', route => {
    const body = route.request().postDataJSON();
    assert.deepEqual(body.state, latest);
    assert.equal(body.report, historicalReport);
    assert.deepEqual(body.history, []);
    return route.fulfill({ json: { report: historicalReport.replace('Historical note.', 'Revised historical note.'), message: 'Revised p-limit note.' } });
  });
  await page.getByLabel('修改要求', { exact: true }).fill('Shorten the note');
  await page.getByRole('button', { name: '套用修改', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#report-markdown').value.includes('Revised historical note.'));
  await page.getByRole('checkbox', { name: '我已確認目前報告內容' }).check();
  await page.getByRole('button', { name: '產生 Slidev 原稿', exact: true }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === '下載 slides.md').disabled);
  assert.match(await page.getByLabel('簡報原稿（唯讀）').inputValue(), /github.com\/sindresorhus\/p-limit\/pull\/109/);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '上一版', exact: true }).click();
  assert.equal(await snapshot.inputValue(), 'p-limit-pr-109');
  assert.ok((await editor.inputValue()).includes('Revised historical note.'));
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '上一版', exact: true }).click();
  assert.equal(await snapshot.inputValue(), 'p-limit-pr-108');
  assert.equal(await editor.inputValue(), '');
  assert.equal(await page.getByRole('button', { name: '下載 slides.md' }).isDisabled(), true);
  assert.equal(await page.locator('.reports-chatLog strong').count(), 0);
  assert.equal(await page.getByRole('checkbox', { name: '我已確認目前報告內容' }).isChecked(), false);
  await page.getByLabel('選擇專案資料').selectOption('demo');
  assert.equal(await page.getByLabel('選擇範例快照').inputValue(), 'normal');
  assert.equal(await page.locator('.reports-summary strong').innerText(), 'Demo App');
  await page.getByLabel('選擇專案資料').selectOption('p-limit');
  console.log('p-limit UI passed: all 21 snapshots, chronological navigation, exact JSON download, State forwarded to generation/revision, slide conversion and safe draft switching.');
  // Use the real archive retrieval + report modules, with only model replies mocked.
  await page.getByLabel('選擇合併快照').selectOption('p-limit-pr-109');
  await page.getByRole('checkbox', { name: '允許按需讀取此版本 repo', exact: true }).check();
  await page.getByLabel('報告生成需求（選填）').fill('Explain clearQueue implementation');
  await page.getByRole('checkbox', { name: '彙整合併區間', exact: true }).check();
  await page.getByLabel('區間開始快照（含）').selectOption('19');
  await page.getByText(/含開始與結束共 2 次 merge/).waitFor();
  const contextComplete = async messages => {
    const input = JSON.parse(messages[1].content);
    if (input.available_files) {
      assert.equal(input.commit, latest.source_commit_sha);
      return JSON.stringify({ files: input.current_request.includes('Translate') ? [] : [{ path: 'index.js', start_line: 118, end_line: 130 }], reason: 'Mock selection' });
    }
    assert.equal(input.repository_context.commit, latest.source_commit_sha);
    assert.deepEqual(input.merge_history.merges.map(merge => merge.pr_number), [108, 109]);
    if (input.current_report) {
      if (input.current_request.includes('Translate')) return JSON.stringify({ changes: [], message: 'No changes needed.' });
      assert.ok(input.current_report.includes('Manual repo edit'));
      assert.ok(input.repository_context.files[0].content.includes("Object.defineProperty(limitedFunction, 'clearQueue'"));
      return JSON.stringify({ changes: [{ old: 'Repository note 0.', new: 'Explained repository note.' }], message: 'Updated using archived code.' });
    }
    assert.equal(input.generation_request, 'Explain clearQueue implementation');
    assert.deepEqual(input.state, latest);
    return JSON.stringify({ pages: ['Project Overview', 'Feature Progress', 'Recent Changes', 'Risks and Issues'].map((title, index) => ({ title, bullets: title === 'Recent Changes' ? input.merge_history.merges.map(merge => `PR ${merge.pr_number}: ${merge.summary}`) : ['Repository-backed fact'], script: `Repository note ${index}.`, source_ids: title === 'Recent Changes' ? input.merge_history.merges.map(merge => merge.source_id) : ['repo-file-1'] })) });
  };
  for (const mode of ['generate', 'revise']) {
    const handler = reportHandler(mode, { production: false, complete: contextComplete });
    await page.route(`**/api/reports/${mode}`, async route => {
      const body = route.request().postDataJSON();
      assert.equal(body.useRepository, true);
      assert.equal(body.mergeRange.startCommit, inventory.entries[19].source_commit_sha);
      assert.equal(body.mergeRange.endCommit, latest.source_commit_sha);
      const response = await handler(new Request(route.request().url(), { method: 'POST', body: JSON.stringify(body) }));
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
    });
  }
  await page.getByRole('button', { name: '生成報告', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#report-markdown').value.includes('Repository note 0.'));
  await page.getByText('本次 repo 讀取紀錄', { exact: true }).click();
  const evidenceLink = page.getByRole('link', { name: 'index.js:118-130', exact: true });
  await evidenceLink.waitFor();
  assert.match(await evidenceLink.getAttribute('href'), new RegExp(`${latest.source_commit_sha}/index.js#L118-L130$`));
  assert.ok((await editor.inputValue()).includes(await evidenceLink.getAttribute('href')));
  assert.ok((await editor.inputValue()).includes('https://github.com/sindresorhus/p-limit/pull/108'));
  assert.ok((await editor.inputValue()).includes('https://github.com/sindresorhus/p-limit/pull/109'));
  await editor.fill((await editor.inputValue()) + '\nManual repo edit');
  await page.getByLabel('修改要求', { exact: true }).fill('Explain clearQueue with the implementation');
  await page.getByRole('button', { name: '套用修改', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#report-markdown').value.includes('Explained repository note.'));
  assert.ok((await editor.inputValue()).includes('Manual repo edit'));
  await page.getByLabel('修改要求', { exact: true }).fill('Translate the last note');
  await page.getByRole('button', { name: '套用修改', exact: true }).click();
  await page.getByText(/模型判斷本次不需要讀取檔案/).waitFor();
  await page.getByText('本次未修改報告，請查看對話回覆。', { exact: true }).waitFor();
  assert.equal(await evidenceLink.count(), 0);
  assert.ok((await editor.inputValue()).includes('Manual repo edit'));
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('選擇專案資料').selectOption('demo');
  assert.equal(await page.getByRole('checkbox', { name: '允許按需讀取此版本 repo', exact: true }).isDisabled(), true);
  assert.equal(await page.getByText('本次 repo 讀取紀錄', { exact: true }).count(), 0);
  await page.getByLabel('選擇專案資料').selectOption('p-limit');
  assert.equal(await page.getByRole('checkbox', { name: '彙整合併區間', exact: true }).isChecked(), false);
  console.log('Repository-assisted UI passed: generation focus, archived excerpt selection, pinned citations, source trace, multi-turn revision with manual edits, no-file decision and reset on source change.');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const badRequest = await page.request.post(`${baseUrl}/api/reports/generate`, { data: { state: null } });
  assert.equal(badRequest.status(), 400);
  console.log('Browser check passed: report generation/revision, history, error preservation, downloads, Slidev conversion, stale export protection, mobile layout and API input validation.');

  const failurePage = await browser.newPage();
  let generationAttempt = 0;
  await failurePage.route('**/api/reports/generate', route => {
    generationAttempt++;
    if (generationAttempt === 2) return route.fulfill({ json: { report: original } });
    if (generationAttempt === 4) return route.fulfill({ json: { report: '   ' } });
    return route.fulfill({ status: 502, json: { error: 'HTTP 503，已嘗試 3 次', code: 'PROVIDER_UNAVAILABLE', stage: 'report_generation' } });
  });
  await failurePage.goto(`${baseUrl}/reports`, { waitUntil: 'networkidle' });
  await failurePage.getByRole('button', { name: '生成報告', exact: true }).click();
  await failurePage.getByRole('alert').filter({ hasText: '報告生成階段：' }).waitFor();
  assert.equal(await failurePage.getByLabel('直接編輯 Markdown').inputValue(), '');
  assert.match(await failurePage.locator('.reports-status').innerText(), /本次尚未產生報告/);
  assert.ok(!(await failurePage.locator('.reports-status').innerText()).includes('報告已生成'));
  await failurePage.getByRole('button', { name: '生成報告', exact: true }).click();
  await failurePage.waitForFunction(() => document.querySelector('#report-markdown').value.includes('Original note.'));
  await failurePage.getByLabel('直接編輯 Markdown').fill(original + '\nKeep manual wording');
  failurePage.on('dialog', dialog => dialog.accept());
  await failurePage.getByRole('button', { name: '重新生成報告', exact: true }).click();
  await failurePage.getByRole('alert').filter({ hasText: '報告生成階段：' }).waitFor();
  assert.match(await failurePage.locator('.reports-status').innerText(), /目前報告與對話已保留/);
  assert.ok(!(await failurePage.locator('.reports-status').innerText()).includes('報告已生成'));
  assert.equal(await failurePage.getByLabel('直接編輯 Markdown').inputValue(), original + '\nKeep manual wording');
  await failurePage.getByRole('button', { name: '重新生成報告', exact: true }).click();
  await failurePage.getByRole('alert').filter({ hasText: '報告為空' }).waitFor();
  assert.equal(await failurePage.getByLabel('直接編輯 Markdown').inputValue(), original + '\nKeep manual wording');
  console.log('Provider-failure UI passed: stage label, truthful empty-draft status, no stale success message, and manual draft preserved on 503 or empty responses.');
} finally {
  if (browser) await browser.close();
  server?.kill();
}
