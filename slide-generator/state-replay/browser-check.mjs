import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, rm } from 'node:fs/promises';
import { sep } from 'node:path';
import { sample } from './testing/sample.js';
import { runReplay } from './replay.js';
import { localReportHandler } from './integration.js';
import { defaultRoot, replayStore } from './store.js';
import { retrieveRepositoryContext } from '../report-agent/repository-context.js';
import { validateState } from './validation.js';

const { chromium } = createRequire(import.meta.url)('../slide-export/node_modules/playwright-chromium');
const fixture = sample(3, `example/history-ui-${process.pid}-${Date.now()}`);
const options = { client: fixture.client, complete: fixture.complete, now: () => fixture.plan.collected_at, run: true };
const first = await runReplay(fixture.plan.repository.url, { ...options, limit: 1 });
const store = replayStore(first.id);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.setDefaultTimeout(20_000);
  const model = async messages => {
    const payload = JSON.parse(messages[1].content);
    if (payload.available_files) return JSON.stringify({ files: [{ path: 'index.js', start_line: 1, end_line: 3 }], reason: 'Read selected implementation' });
    assert.equal(payload.state.source_commit_sha, fixture.plan.merges[2].commit);
    assert.deepEqual(payload.merge_history.merges.map(merge => merge.pr_number), [3, 12]);
    if (payload.current_request) {
      assert.ok(payload.current_report.includes('手動講稿'));
      return JSON.stringify({ changes: [{ old: '手動講稿', new: '精簡講稿' }], message: '保留事實，精簡講稿。' });
    }
    assert.equal(payload.repository_context.commit, fixture.plan.merges[2].commit);
    return JSON.stringify({ pages: [{ title: '近期成果', bullets: ['工作執行實作更新。'], script: '原講稿', source_ids: ['repo-file-1', 'merge-pr-3', 'merge-pr-12'] }] });
  };
  for (const mode of ['generate', 'revise']) {
    const handler = localReportHandler(mode, { production: false, complete: model, retrieveContext: (args, dependencies) => retrieveRepositoryContext(args, { ...dependencies, loadSnapshot: async state => fixture.snapshots.find(item => item.commit.sha === state.source_commit_sha) }) });
    await page.route(`**/api/reports/${mode}`, async route => {
      assert.equal(route.request().postDataJSON().replayId, first.id);
      const response = await handler(new Request(route.request().url(), { method: 'POST', body: route.request().postData() }));
      await route.fulfill({ status: response.status, json: await response.json() });
    });
  }
  await page.goto(`${process.env.REPORT_TEST_URL || 'http://localhost:3000'}/reports`, { waitUntil: 'networkidle' });
  await page.getByLabel('公開 GitHub repo 網址', { exact: true }).fill(fixture.plan.repository.url);
  await page.getByRole('button', { name: '載入已重建的歷史 State', exact: true }).click();
  await page.locator('#state-history > summary').click();
  await page.getByLabel('選擇合併快照').waitFor();
  assert.equal(await page.getByLabel('選擇合併快照').locator('option').count(), 1);
  assert.ok((await page.getByLabel('選擇專案資料').textContent()).includes('1/3'));
  await runReplay(fixture.plan.repository.url, { ...options, limit: 3 });
  await page.getByRole('button', { name: '載入已重建的歷史 State', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#state-snapshot')?.options.length === 3);
  assert.equal(await page.locator('#state-history').getAttribute('open'), null);
  await page.locator('#state-history > summary').click();
  const snapshot = page.getByLabel('選擇合併快照');
  assert.equal(await snapshot.inputValue(), fixture.states[2].event_id);
  await snapshot.selectOption(fixture.states[2].event_id);
  await page.getByRole('checkbox', { name: '彙整合併區間', exact: true }).check();
  await page.getByLabel('區間開始快照（含）').selectOption('1');
  await page.getByLabel('允許按需讀取此版本 repo').check();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: '下載 Project State', exact: true }).click();
  const downloaded = JSON.parse(await readFile(await (await downloading).path(), 'utf8')); validateState(downloaded);
  assert.equal(downloaded.source_commit_sha, fixture.plan.merges[2].commit);
  await page.getByRole('button', { name: '生成報告', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#report-markdown').value.includes('原講稿'));
  const editor = page.getByLabel('直接編輯 Markdown'); await editor.fill((await editor.inputValue()).replace('原講稿', '手動講稿'));
  if (await page.getByLabel('修改要求', { exact: true }).count()) {
    await page.getByLabel('修改要求', { exact: true }).fill('精簡講稿'); await page.getByRole('button', { name: '預覽修改', exact: true }).click();
    await page.getByRole('button', { name: '接受這次修改', exact: true }).click(); assert.ok((await editor.inputValue()).includes('精簡講稿'));
  } else assert.ok((await editor.inputValue()).includes('手動講稿'));
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: '上一版', exact: true }).click();
  assert.equal(await snapshot.inputValue(), fixture.states[2].event_id);
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '上一版', exact: true }).click();
  assert.equal(await snapshot.inputValue(), fixture.states[1].event_id); assert.equal(await editor.inputValue(), '');
  await page.getByRole('button', { name: '回到最新狀態', exact: true }).click();
  assert.equal(await snapshot.inputValue(), fixture.states[2].event_id);
  assert.equal(await page.getByRole('button', { name: '回到最新狀態', exact: true }).count(), 0);
  console.log('Historical State UI: actual local import, partial/full progress, version/range selection, validated download, pinned reporting, manual edits and safe switching passed.');
} finally {
  await browser.close();
  if (!store.directory.startsWith(defaultRoot + sep)) throw new Error('Unexpected cleanup path');
  await rm(store.directory, { recursive: true, force: true });
}
