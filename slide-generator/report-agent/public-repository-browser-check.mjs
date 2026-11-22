// Existing Next server. Mock GitHub and LLM responses; exercise the real handlers.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { publicRepositoryClient, repositoryImportHandler } from './public-repository.js';
import { reportHandler } from './http.js';
const require = createRequire(import.meta.url);
const { chromium } = require('../slide-export/node_modules/playwright-chromium');
const commit = 'a'.repeat(40), tree = 'b'.repeat(40), content = '# Example\nThis library limits concurrent work.\n';
const sha = createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex');
const fetchImpl = async url => {
  const path = url.replace('https://api.github.com/repos/', '');
  const data = {
    'example/library': { private: false, full_name: 'example/library', name: 'library', default_branch: 'main' },
    'example/library/commits/main': { sha: commit, commit: { committer: { date: '2026-11-22T00:00:00Z' } } },
    [`example/library/commits/${commit}`]: { sha: commit, commit: { tree: { sha: tree }, committer: { date: '2026-11-22T00:00:00Z' } } },
    [`example/library/git/trees/${tree}?recursive=1`]: { sha: tree, truncated: false, tree: [{ type: 'blob', mode: '100644', path: 'README.md', sha, size: Buffer.byteLength(content) }] },
    [`example/library/git/blobs/${sha}`]: { sha, encoding: 'base64', content: Buffer.from(content).toString('base64') },
  }[path];
  assert.ok(data, path); return Response.json(data);
};
const importHandler = repositoryImportHandler({ production: false, fetchImpl });
const generate = reportHandler('generate', { production: false, publicClient: options => publicRepositoryClient({ ...options, fetchImpl }), complete: async messages => {
  const input = JSON.parse(messages[1].content);
  return JSON.stringify(input.available_files
    ? { files: [{ path: 'README.md', start_line: 1, end_line: 50 }], reason: 'Read purpose' }
    : { pages: [{ title: '目前能力', bullets: ['提供同時執行數量限制。'], script: '文件說明目前可限制同時執行的工作數量。', source_ids: ['repo-file-1'] }] });
} });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  for (const [name, handler] of [['repository', importHandler], ['generate', generate]]) await page.route(`**/api/reports/${name}`, async route => {
    const response = await handler(new Request(route.request().url(), { method: 'POST', body: route.request().postData() }));
    await route.fulfill({ status: response.status, json: await response.json() });
  });
  await page.goto(`${process.env.REPORT_TEST_URL || 'http://localhost:3000'}/reports`, { waitUntil: 'networkidle' });
  await page.getByLabel('公開 GitHub repo 網址', { exact: true }).fill('https://github.com/example/library');
  await page.getByRole('button', { name: '載入公開 repo', exact: true }).click();
  await page.getByText('Repo Snapshot（不是正式 Project State）。', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('允許按需讀取此版本 repo').isChecked(), true);
  assert.equal(await page.getByText('最近一次合併', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '生成報告', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#report-markdown').value.includes('目前能力'));
  const editor = page.getByLabel('直接編輯 Markdown'); const report = await editor.inputValue();
  assert.ok(report.includes(`/blob/${commit}/README.md`));
  // Failed import keeps the draft; rejected confirmation sends no import.
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('公開 GitHub repo 網址', { exact: true }).fill('https://localhost/private');
  await page.getByRole('button', { name: '載入公開 repo', exact: true }).click();
  await page.locator('.reports-importBox').getByRole('alert').waitFor(); assert.equal(await editor.inputValue(), report);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '載入公開 repo', exact: true }).click();
  assert.equal(await editor.inputValue(), report);
  // Same commit reload explicitly creates a fresh workspace.
  await page.getByLabel('公開 GitHub repo 網址', { exact: true }).fill('https://github.com/example/library');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '載入公開 repo', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#report-markdown').value === '');
  assert.deepEqual(errors, []);
  console.log('Public repo browser import, pinned generation, failed-import preservation and reload: PASS');
} finally { await browser.close(); }
