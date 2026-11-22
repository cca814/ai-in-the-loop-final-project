// Compile real routes, then exercise their exported POST in an isolated process.
// The temporary synthetic replay is removed; all model and GitHub calls are mocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
import { sample } from '../state-replay/testing/sample.js';
import { runReplay } from '../state-replay/replay.js';
import { defaultRoot, replayStore } from '../state-replay/store.js';
import { historyImportHandler } from '../state-replay/integration.js';

const base = process.env.REPORT_TEST_URL || 'http://localhost:3000';
for (const mode of ['generate', 'revise', 'history']) assert.equal((await fetch(`${base}/api/reports/${mode}`)).status, 405);
const fixture = sample(3, `example/check-${process.pid}-${Date.now()}`);
const result = await runReplay(fixture.plan.repository.url, { root: defaultRoot, run: true, limit: 3, client: fixture.client, complete: fixture.complete, now: () => fixture.plan.collected_at });
const store = replayStore(result.id);
try {
  process.env.NODE_ENV = 'development'; process.env.LLM_PROVIDER = 'gemini';
  process.env.GEMINI_API_KEY = 'fake-compiled-route-key'; process.env.GEMINI_MODEL = 'test-model';
  let modelCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (url.startsWith('https://api.github.com/')) return fixture.fetchImpl(url, options);
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');
    modelCalls++;
    const payload = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
    const reply = payload.available_files ? { files: [{ path: 'index.js', start_line: 1, end_line: 3 }], reason: 'Read selected version' }
      : payload.current_request ? { changes: [{ old: '原講稿', new: '新講稿' }], message: '已修改。' }
      : { pages: [{ title: '區間成果', bullets: ['工作執行實作更新。'], script: '原講稿', source_ids: ['repo-file-1', 'merge-pr-7', 'merge-pr-12'] }] };
    if (payload.merge_history) assert.equal(payload.merge_history.merges.length, 3);
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(reply) }] } }] });
  };
  const require = createRequire(import.meta.url);
  const compiled = mode => require(`../.next/dev/server/app/api/reports/${mode}/route.js`).routeModule.userland.POST;
  const body = { state: fixture.states.at(-1), replayId: result.id, focus: '說明成果', useRepository: true, mergeRange: { startCommit: fixture.plan.merges[0].commit, endCommit: fixture.plan.merges.at(-1).commit } };
  const request = value => new Request(`${base}/api/reports/generate`, { method: 'POST', body: JSON.stringify(value) });
  const generated = await compiled('generate')(request(body)); const output = await generated.json();
  assert.equal(generated.status, 200, JSON.stringify(output)); assert.ok(output.report.includes('原講稿')); assert.equal(output.mergeRange.count, 3);
  const revised = await compiled('revise')(request({ ...body, useRepository: false, report: output.report, request: '修改講稿', history: [] }));
  assert.equal(revised.status, 200); assert.ok((await revised.json()).report.includes('新講稿'));
  const imported = await compiled('history')(request({ url: fixture.plan.repository.url })); assert.equal(imported.status, 200);
  // Check the actual running Next server reads the same default directory too.
  const live = await historyImportHandler({ production: false })(request({ url: fixture.plan.repository.url })); assert.equal(live.status, 200);
  assert.equal(modelCalls, 3);
  console.log('Compiled generic history/generate/revise routes: pinned sources, full range and latest State passed; model/GitHub calls mocked.');
} finally { await rm(store.directory, { recursive: true, force: true }); }
