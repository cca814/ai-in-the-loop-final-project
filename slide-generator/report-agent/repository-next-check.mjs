// Optional regression check against the actual Next/Turbopack compiled routes.
// Run while the existing Next.js development server is available.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const baseUrl = process.env.REPORT_TEST_URL || 'http://localhost:3000';
// GET only compiles the POST routes; it cannot enter the model request handler.
for (const mode of ['generate', 'revise']) {
  const response = await fetch(new URL(`/api/reports/${mode}`, baseUrl));
  assert.equal(response.status, 405, `Compile ${mode} using the running development server first`);
}

// These changes affect this isolated test process only. No .env file is read.
process.env.NODE_ENV = 'development';
process.env.LLM_PROVIDER = 'gemini';
process.env.GEMINI_API_KEY = 'fake-key-for-compiled-route-test';
process.env.GEMINI_MODEL = 'test-model';
let modelCalls = 0;
let expectedState;
let expectedExcerpt;
let expectedMerges;
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');
  assert.equal(options.headers['x-goog-api-key'], 'fake-key-for-compiled-route-test');
  modelCalls++;
  const input = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
  assert.deepEqual(input.state, expectedState);
  let reply;
  if (input.available_files) {
    assert.equal(input.commit, expectedState.source_commit_sha);
    reply = { files: [{ path: 'index.js', start_line: 1, end_line: 2 }], reason: 'Inspect this historical version.' };
  } else {
    assert.deepEqual(input.merge_history.merges.map(merge => merge.commit), expectedMerges);
    assert.equal(input.repository_context.commit, expectedState.source_commit_sha);
    assert.equal(input.repository_context.files[0].content, expectedExcerpt);
    reply = input.current_report
      ? { changes: [{ old: 'Original note 0.', new: 'Updated note.' }], message: 'Revised using this commit.' }
      : { pages: ['Project Overview', 'Feature Progress', 'Recent Changes', 'Risks and Issues'].map((title, index) => ({ title, bullets: ['Historical source evidence.'], script: `Original note ${index}.`, source_ids: ['repo-file-1'] })) };
  }
  return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(reply) }] } }] });
};

const require = createRequire(import.meta.url);
const generate = require('../.next/dev/server/app/api/reports/generate/route.js').routeModule.userland.POST;
const revise = require('../.next/dev/server/app/api/reports/revise/route.js').routeModule.userland.POST;
const fixtureRoot = new URL('../test-data/p-limit/', import.meta.url);
const inventory = JSON.parse(await readFile(new URL('inventory.json', fixtureRoot)));
const request = (mode, body) => new Request(new URL(`/api/reports/${mode}`, baseUrl), { method: 'POST', body: JSON.stringify(body) });

for (const [index, entry] of inventory.entries.entries()) {
  expectedState = JSON.parse(await readFile(new URL(`states/${entry.file}`, fixtureRoot)));
  const original = structuredClone(expectedState);
  const snapshot = JSON.parse(await readFile(new URL(`inputs/${entry.file}`, fixtureRoot)));
  expectedExcerpt = snapshot.files['index.js'].content.split('\n').slice(0, 2).join('\n');
  expectedMerges = inventory.entries.slice(0, index + 1).map(item => item.source_commit_sha);
  const mergeRange = { startCommit: inventory.entries[0].source_commit_sha, endCommit: entry.source_commit_sha };
  const response = await generate(request('generate', { state: expectedState, useRepository: true, mergeRange }));
  const result = await response.json();
  assert.equal(response.status, 200, `Generation for PR #${entry.pr}: ${result.code}`);
  assert.equal(result.repository.commit, entry.source_commit_sha);
  assert.equal(result.repository.status, 'read');
  assert.equal(result.mergeRange.count, index + 1);
  assert.ok(result.report.includes(`/blob/${entry.source_commit_sha}/index.js#L1-L2`));
  const revised = await revise(request('revise', { state: expectedState, report: result.report + '\nManual edit', request: 'Explain using the code', history: [], useRepository: true, mergeRange }));
  const revision = await revised.json();
  assert.equal(revised.status, 200, `Revision for PR #${entry.pr}: ${revision.code}`);
  assert.equal(revision.repository.commit, entry.source_commit_sha);
  assert.ok(revision.report.includes('Updated note.'));
  assert.ok(revision.report.endsWith('Manual edit'));
  assert.deepEqual(expectedState, original);
}
assert.equal(modelCalls, inventory.entries.length * 4);
console.log(`Next/Turbopack compiled routes passed for all ${inventory.entries.length} snapshots: correct commit, exact archived excerpts, inclusive merge history, generation, revision and manual edit preservation. ${modelCalls} model calls were mocked; no provider network requests were sent.`);

// Reproduce the screenshot's exact range and State-only configuration.
const rangeState = JSON.parse(await readFile(new URL(`states/${inventory.entries[10].file}`, fixtureRoot)));
let rangeCalls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');
  const contents = JSON.parse(options.body).contents;
  const input = JSON.parse(contents[0].parts[0].text);
  assert.deepEqual(input.state, rangeState);
  assert.deepEqual(input.merge_history.merges.map(merge => merge.pr_number), [9, 11, 12, 20, 28, 30, 35]);
  assert.ok(!input.repository_context);
  rangeCalls++;
  if (rangeCalls === 2) assert.equal(JSON.parse(contents.at(-1).parts[0].text).correction_required, 'GENERATION_CONTENT_INVALID');
  const reply = { pages: [{ title: '近期成果與待處理事項', bullets: ['已加入工作數量追蹤與佇列清除能力。'], script: rangeCalls === 1 ? ['Incorrect JSON type'] : '此期間持續改善工作排程能力。\n\n清除等待工作時仍需留意呼叫端的等待流程。', source_ids: ['merge-pr-9', 'merge-pr-35'] }] };
  return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(reply) }] } }] });
};
const rangeResponse = await generate(request('generate', { state: rangeState, focus: '匯報最近的進度跟碰到的問題', useRepository: false, mergeRange: { startCommit: inventory.entries[4].source_commit_sha, endCommit: rangeState.source_commit_sha } }));
const rangeResult = await rangeResponse.json();
assert.equal(rangeResponse.status, 200, rangeResult.code);
assert.equal(rangeCalls, 2);
assert.equal(rangeResult.mergeRange.count, 7);
assert.match(rangeResult.report, /\n\n清除等待工作/);
console.log('Compiled screenshot regression passed: PR #9–#35, seven merges, repository reading off, one format correction, custom structure and multi-paragraph notes. Both model calls were mocked.');

// Full-history screenshot: invalid repo ranges must be corrected before writing.
const fullState = JSON.parse(await readFile(new URL(`states/${inventory.entries.at(-1).file}`, fixtureRoot)));
let selectionCalls = 0;
let writerCalls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');
  const contents = JSON.parse(options.body).contents;
  const input = JSON.parse(contents[0].parts[0].text);
  assert.deepEqual(input.state, fullState);
  let reply;
  if (input.available_files) {
    selectionCalls++;
    assert.equal(input.commit, fullState.source_commit_sha);
    if (selectionCalls === 2) assert.equal(JSON.parse(contents.at(-1).parts[0].text).correction_required, 'SELECTION_RANGE_INVALID');
    reply = { files: [{ path: 'index.js', start_line: 1, end_line: selectionCalls === 1 ? 1000 : 2 }], reason: 'Read a bounded implementation excerpt.' };
  } else {
    writerCalls++;
    assert.equal(input.merge_history.merges.length, 21);
    assert.equal(input.repository_context.files[0].end_line, 2);
    assert.equal(input.repository_context.commit, fullState.source_commit_sha);
    reply = { pages: [{ title: '專案歷史摘要', bullets: ['依所選合併紀錄彙整。'], script: '這份報告涵蓋所選的二十一次合併紀錄。', source_ids: ['repo-file-1', 'merge-pr-109'] }] };
  }
  return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(reply) }] } }] });
};
const fullResponse = await generate(request('generate', { state: fullState, focus: '弄出整個專案歷史的完整報告', useRepository: true, mergeRange: { startCommit: inventory.entries[0].source_commit_sha, endCommit: fullState.source_commit_sha } }));
const fullResult = await fullResponse.json();
assert.equal(fullResponse.status, 200, fullResult.code);
assert.equal(fullResult.mergeRange.count, 21);
assert.equal(selectionCalls, 2);
assert.equal(writerCalls, 1);
assert.equal(fullResult.repository.files[0].end_line, 2);
console.log('Compiled full-history regression passed: 21 merges, repo enabled, one invalid range corrected, pinned excerpt and report generated. All three model calls were mocked.');
