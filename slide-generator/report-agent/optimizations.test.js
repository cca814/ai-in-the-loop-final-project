import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generateReport } from './index.js';
import { reviseReport } from './revision.js';
import { wantsWholeChineseTranslation } from './revision-validation.js';
import { reportRequirements } from './requirements.js';
import { inspectReport } from './quality.js';
import { createOperation, readRequestJson, OperationError } from './operation.js';
import { conversationContext } from './conversation.js';
import { retrieveRepositoryContext } from './repository-context.js';
import { mergeHistorySources } from './merge-history.js';
import { createClient } from './llm.js';
import { createEvidenceCache } from './evidence-cache.js';

const state = JSON.parse(readFileSync(new URL('../schemas/examples/normal.json', import.meta.url)));
const page = title => ({ title, bullets: ['有證據支持的重點。'], script: '說明本頁重點。', source_ids: ['pr-41'] });
const markdown = title => `# ${title}\n\n- 原本的重點。\n\n## Speaker Notes\n\n原本的講稿。`;

test('explicit counts in Chinese and English are enforced with one bounded correction', async () => {
  for (const request of ['共2頁', '分成兩節', 'Use 2 slides', '改成二頁']) {
    assert.equal(reportRequirements(request).pages, 2);
    let calls = 0;
    const output = await generateReport(state, { focus: request, complete: async messages => {
      calls++;
      if (calls === 2) assert.equal(JSON.parse(messages.at(-1).content).requirements.pages, 2);
      return JSON.stringify({ pages: calls === 1 ? [page('第一頁')] : [page('第一頁'), page('第二頁')] });
    } });
    assert.equal(calls, 2);
    assert.equal((output.match(/^# /gm) || []).length, 2);
  }
  let calls = 0;
  await assert.rejects(generateReport(state, { focus: '共10頁', complete: async () => { calls++; return JSON.stringify({ pages: [page('只有一頁')] }); } }), error => error.code === 'GENERATION_REQUIREMENT_INVALID');
  assert.equal(calls, 2);
  assert.equal(reportRequirements('增加2頁').pages, undefined);
  assert.equal(reportRequirements('增加2頁', { currentPages: 4 }).pages, 6);
  assert.equal(reportRequirements('刪除2頁', { currentPages: 4 }).pages, 2);
  assert.equal(reportRequirements('只修改第2頁的講稿').pages, undefined);
  assert.throws(() => reportRequirements('共101頁'), error => error.code === 'REQUIREMENTS_AMBIGUOUS');
});

test('one page per directory is an allocation, while an explicit total remains a total', () => {
  for (const request of ['一個資料夾一頁', '每個資料夾各一頁', '資料夾各用1頁介紹', '1 page per directory', 'one page for each folder']) {
    assert.equal(reportRequirements(request).pages, undefined);
    assert.equal(reportRequirements(request).pagesPerDirectory, 1);
  }
  assert.equal(reportRequirements('每個資料夾一頁，總共三頁').pages, 3);
  assert.equal(reportRequirements('整份報告改成一頁').pages, 1);
});

test('evidence cache is isolated by all supplied context, bounded, expiring and returns copies', async () => {
  let now = 0, calls = 0;
  const cache = createEvidenceCache({ capacity: 2, ttlMs: 10, now: () => now });
  const load = async () => { calls++; return { files: [{ content: 'Verified excerpt' }] }; };
  const identity = { commit: 'a', request: 'Explain', model: 'one', report: 'Manual wording' };
  const first = await cache(identity, load); first.context.files[0].content = 'Mutated outside cache';
  assert.equal((await cache(identity, load)).context.files[0].content, 'Verified excerpt');
  assert.equal(calls, 1);
  await cache({ ...identity, request: 'Translate' }, load);
  await cache({ ...identity, model: 'two' }, load);
  assert.equal((await cache(identity, load)).hit, false);
  now = 20;
  assert.equal((await cache(identity, load)).hit, false);
  assert.equal(calls, 5);
});

test('State-only revisions reject fabricated URLs and changes outside an explicitly named page', async () => {
  const report = `${markdown('摘要')}\n\n---\n\n${markdown('進度')}`;
  await assert.rejects(reviseReport({ state, report, request: '修改說法' }, { complete: async () => JSON.stringify({ changes: [{ old: '# 摘要', new: '# 摘要 [link](https://unverified.example/proof)' }], message: 'Changed' }) }), error => error.code === 'REVISION_SOURCE_INVALID');
  await assert.rejects(reviseReport({ state, report, request: '只修改摘要' }, { complete: async () => JSON.stringify({ changes: [{ old: '# 進度', new: '# 無關內容被修改' }], message: 'Changed' }) }), error => error.code === 'REVISION_SCOPE_INVALID');
  const result = await reviseReport({ state, report, request: '只修改摘要' }, { complete: async () => JSON.stringify({ changes: [{ old: '# 摘要', new: '# 新摘要' }], message: 'Changed' }) });
  assert.ok(result.report.endsWith(markdown('進度')));
  assert.equal(wantsWholeChineseTranslation('請將整份報告翻成繁體中文，只改語言'), true);
});

test('language and page-count requests are checked after revisions; notes-only translation stays scoped', async () => {
  const english = '# Summary\n\n- The project is using a queue.\n\n## Speaker Notes\n\nThese are the original speaker notes.';
  await assert.rejects(generateReport(state, { focus: '用繁體中文', complete: async () => JSON.stringify({ pages: [{ title: 'Summary', bullets: ['The project is using a queue.'], script: 'This is the current implementation.' }] }) }), error => error.code === 'GENERATION_REQUIREMENT_INVALID');
  await assert.rejects(reviseReport({ state, report: markdown('摘要'), request: '改成2頁' }, { complete: async () => JSON.stringify({ changes: [], message: 'Already done' }) }), error => error.code === 'REVISION_REQUIREMENT_INVALID');
  const translated = await reviseReport({ state, report: english, request: '只將講稿翻成繁體中文' }, { complete: async () => JSON.stringify({ changes: [{ old: 'These are the original speaker notes.', new: '這是翻譯後的講稿。' }], message: 'Translated notes.' }) });
  assert.match(translated.report, /# Summary/);
});

test('quality review flags unsupported dates, density and duplicated notes without claiming factual proof', () => {
  const report = `${markdown('摘要')}\n\n---\n\n${markdown('進度').replace('- 原本的重點。', '- 2039-01-01 完成。' + '很長的內容'.repeat(220))}`;
  const quality = inspectReport(report, { state });
  assert.equal(quality.pageCount, 2);
  for (const code of ['CITATION_REVIEW', 'UNSUPPORTED_DATE', 'DENSE_SLIDE', 'REPEATED_NOTES']) assert.ok(quality.warnings.some(warning => warning.code === code));
  assert.equal(quality.provenance.stateId, state.event_id);
  assert.match(quality.provenance.verification, /human review/);
});

test('operation budgets enforce cancellation, deadlines and call limits without invoking extra work', async () => {
  let calls = 0;
  const operation = createOperation({ maxCalls: 1 });
  const complete = operation.wrap(async () => { calls++; return '{}'; });
  await complete([{ content: 'First', role: 'user' }]);
  await assert.rejects(complete([{ content: 'Second', role: 'user' }]), error => error.code === 'MODEL_BUDGET_EXCEEDED');
  assert.equal(calls, 1);
  const controller = new AbortController();
  const cancelled = createOperation({ signal: controller.signal }).wrap(async () => new Promise(() => {}));
  const promise = cancelled([{ role: 'user', content: 'Wait' }]); controller.abort();
  await assert.rejects(promise, error => error.code === 'OPERATION_CANCELLED');
  const timer = setTimeout(() => {}, 100);
  try { await assert.rejects(createOperation({ timeoutMs: 5 }).wrap(async () => new Promise(() => {}))([{ content: 'Wait' }]), error => error.code === 'OPERATION_TIMEOUT'); }
  finally { clearTimeout(timer); }
  const body = new Request('http://localhost/', { method: 'POST', body: JSON.stringify({ text: '中文'.repeat(100) }) });
  await assert.rejects(readRequestJson(body, 100), error => error instanceof OperationError && error.code === 'REQUEST_TOO_LARGE');
});

test('conversation context stays bounded, retains recent turns and reports omissions', () => {
  const history = Array.from({ length: 40 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: String(index).repeat(1000) }));
  const selected = conversationContext(history);
  assert.ok(selected.turns.length <= 16);
  assert.ok(selected.turns.reduce((size, turn) => size + turn.content.length, 0) <= 24000);
  assert.equal(selected.turns.at(-1).content, history.at(-1).content);
  assert.equal(selected.omitted + selected.turns.length, history.length);
});

test('generic repo and historical evidence work without p-limit fixture loaders', async () => {
  const custom = { ...structuredClone(state), source_commit_sha: 'a'.repeat(40), repository: { full_name: 'another/project', url: 'https://github.com/another/project' } };
  const content = 'export const implemented = true;';
  const sha = createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex');
  const context = await retrieveRepositoryContext({ state: custom, mode: 'generate' }, { loadSnapshot: async () => ({ repository: custom.repository.full_name, commit: { sha: custom.source_commit_sha }, files: { 'index.js': { content, sha } } }), complete: async () => JSON.stringify({ files: [{ path: 'index.js', start_line: 1, end_line: 1 }], reason: 'Inspect' }) });
  assert.equal(context.files[0].content, content);
  assert.match(context.files[0].url, /another\/project/);
  assert.equal(mergeHistorySources({ repository: custom.repository.full_name, start_commit: custom.source_commit_sha, end_commit: custom.source_commit_sha, merges: [{ commit: custom.source_commit_sha, pr_number: 123, source_id: 'merge-pr-123', url: 'https://github.com/another/project/pull/123', merged_at: '2026-01-01T00:00:00Z', summary: 'Implemented' }] }, custom).length, 1);
});

test('OpenAI-compatible provider rejects truncated output and reports usage without response bodies', async () => {
  const events = [];
  const complete = createClient({ provider: 'groq', apiKey: 'fake', model: 'fake-model', onUsage: event => events.push(event), fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }) }) });
  await assert.rejects(complete([{ role: 'user', content: 'Write' }]), error => error.code === 'PROVIDER_RESPONSE_INCOMPLETE');
  assert.ok(events.some(event => event.httpAttempts === 1));
});
