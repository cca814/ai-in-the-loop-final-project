import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateReport } from './index.js';
import { prepareState } from './state.js';
import { createClient, createOpenAIClient } from './llm.js';
import { reportToSlides } from '../slide-export/convert.js';

const example = name => JSON.parse(readFileSync(new URL(`../schemas/examples/${name}.json`, import.meta.url), 'utf8'));
const pages = state => ['Project Overview', 'Feature Progress', 'Recent Changes', 'Risks and Issues'].map(title => ({ title, bullets: ['Evidence supplied'], script: 'Review the snapshot.', source_ids: [state.trigger.source_ref_id] }));

test('sources are optional per page while supplied identifiers remain validated', async () => {
  const state = example('normal');
  const sections = pages(state).slice(0, 3);
  delete sections[0].source_ids;
  sections[1].source_ids = [];
  const report = await generateReport(state, { complete: async () => JSON.stringify({ pages: sections }) });
  assert.equal((report.match(/## Speaker Notes/g) || []).length, 3);
  assert.equal((report.match(/## Sources/g) || []).length, 1);
  assert.equal((reportToSlides(report).match(/<!--/g) || []).length, 3);
  for (const source_ids of [['invented'], null, 'repository']) {
    await assert.rejects(generateReport(state, { maxCorrectionRetries: 0, complete: async () => JSON.stringify({ pages: [{ ...sections[0], source_ids }] }) }), error => error.code === 'GENERATION_SOURCE_INVALID');
  }
});

for (const name of ['normal', 'missing_risks', 'feature_done']) {
  test(`generates a sourced report for ${name}`, async () => {
    const state = example(name);
    const report = await generateReport(state, { complete: async messages => {
      assert.deepEqual(JSON.parse(messages[1].content), state);
      assert.match(messages[0].content, /not all changes in a reporting period/);
      assert.match(messages[0].content, /not assessed/);
      return JSON.stringify({ pages: pages(state) });
    } });
    assert.match(report, /# Project Overview/);
    assert.match(report, /# Risks and Issues/);
    assert.equal((report.match(/## Speaker Notes/g) || []).length, 4);
    assert.match(report, /https:\/\/github\.com/);
  });
}

test('distinguishes the example data gap from an assessed empty risk list in input', () => {
  const gap = prepareState(example('missing_risks'));
  assert.equal(gap.risks.length, 0);
  assert.ok(gap.data_gaps.some(item => item.section === 'risks'));
  gap.data_gaps = [];
  assert.ok(!prepareState(gap).data_gaps.some(item => item.section === 'risks'));
});

test('rejects invalid evidence and malformed model output', async () => {
  const state = example('feature_done');
  state.features[0].source_ref_ids = ['absent'];
  assert.throws(() => prepareState(state), /Unknown source/);
  const valid = example('normal');
  const badPages = pages(valid);
  badPages[0].source_ids = ['invented'];
  await assert.rejects(generateReport(valid, { complete: async () => JSON.stringify({ pages: badPages }) }), /Unknown response source/);
  await assert.rejects(generateReport(valid, { complete: async () => 'not JSON' }), /valid LLM JSON/);
});

test('requested structure can have one custom section and still convert to Slidev', async () => {
  const state = example('normal');
  const focus = '給主管的簡短更新，只要「編輯流程改善」，不要總覽或技術細節';
  const report = await generateReport(state, { focus, complete: async messages => {
    const input = JSON.parse(messages[1].content);
    assert.equal(input.generation_request, focus);
    assert.deepEqual(input.state, state);
    assert.match(messages[0].content, /there are no required business-section titles/);
    assert.ok(!messages[0].content.includes('keeping all four required'));
    return JSON.stringify({ pages: [{ title: '編輯流程改善', bullets: ['報告編輯已加入預覽，方便在修改時確認呈現效果。'], script: '目前可在編輯報告時預覽內容，報告版本儲存仍在規劃中。', source_ids: ['pr-41'] }] });
  } });
  assert.match(report, /^# 編輯流程改善/);
  assert.ok(!report.includes('# Project Overview'));
  const slides = reportToSlides(report);
  assert.match(slides, /# 編輯流程改善/);
  assert.match(slides, /github.com\/example-org\/demo-app\/pull\/41/);
});

test('default briefing instructions target a supervisor without enforcing a section count', async () => {
  const state = example('normal');
  const report = await generateReport(state, { complete: async messages => {
    assert.match(messages[0].content, /engineer reporting progress to a supervisor/);
    assert.match(messages[0].content, /Default to Traditional Chinese/);
    assert.match(messages[0].content, /not mandatory headings or a fixed section count/);
    assert.match(messages[0].content, /main\/master branch names/);
    assert.match(messages[0].content, /Completion of implementation is not proof of release/);
    return JSON.stringify({ pages: [
      { title: '近期成果', bullets: ['報告編輯已加入預覽。'], script: '編輯流程已新增預覽功能。', source_ids: ['pr-41'] },
      { title: '待確認事項', bullets: ['簡報下載所需的執行環境尚未驗證。'], script: '目前仍需確認簡報下載的執行環境，尚不能承諾交付時間。', source_ids: ['issue-7'] },
    ] });
  } });
  assert.equal((report.match(/^# /gm) || []).length, 2);
  assert.match(report, /待確認事項/);
  await assert.rejects(generateReport(state, { complete: async () => JSON.stringify({ pages: [] }) }), /nonempty pages/);
});

test('accepts paragraph-based speaker notes and preserves Slidev compatibility', async () => {
  const state = example('normal');
  const result = { pages: [{ title: '近期成果', bullets: ['已加入報告預覽。'], script: '報告已可預覽。\n\n版本儲存仍在規劃中。', source_ids: ['pr-41'] }] };
  const report = await generateReport(state, { complete: async () => JSON.stringify(result) });
  assert.match(report, /報告已可預覽。\n\n版本儲存仍在規劃中。/);
  assert.match(reportToSlides(report), /<!--\n報告已可預覽。/);
});

test('corrects a bad source once using the original evidence and exact allowed identifiers', async () => {
  const state = example('normal');
  const original = structuredClone(state);
  let calls = 0;
  const report = await generateReport(state, { focus: '匯報最近進度跟碰到的問題', complete: async messages => {
    calls++;
    const output = { pages: [{ title: '近期進度', bullets: ['報告編輯已加入預覽。'], script: '目前能預覽報告。', source_ids: calls === 1 ? ['made-up-source'] : ['pr-41'] }] };
    if (calls === 2) {
      const correction = JSON.parse(messages.at(-1).content);
      assert.equal(correction.correction_required, 'GENERATION_SOURCE_INVALID');
      assert.equal(correction.page, 1);
      assert.equal(correction.field, 'source_ids');
      assert.ok(correction.allowed_source_ids.includes('pr-41'));
      assert.ok(!JSON.stringify(correction).includes('made-up-source'));
      assert.deepEqual(JSON.parse(messages[1].content).state, state);
    }
    return JSON.stringify(output);
  } });
  assert.equal(calls, 2);
  assert.deepEqual(state, original);
  assert.match(report, /pull\/41/);
});

test('stops after one content correction and never resends provider errors', async () => {
  const state = example('normal');
  let calls = 0;
  await assert.rejects(generateReport(state, { complete: async () => {
    calls++;
    return JSON.stringify({ pages: [{ title: 'Report', bullets: ['Fact'], script: ['Wrong type'], source_ids: ['pr-41'] }] });
  } }), error => error.code === 'GENERATION_CONTENT_INVALID' && error.field === 'script');
  assert.equal(calls, 2);
  let providerCalls = 0;
  await assert.rejects(generateReport(state, { complete: async () => { providerCalls++; throw new Error('Provider unavailable'); } }), /Provider unavailable/);
  assert.equal(providerCalls, 1);
});

test('LLM adapter uses injected transport and does not expose error response bodies', async () => {
  const complete = createOpenAIClient({ apiKey: 'test', model: 'test-model', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(JSON.parse(options.body).model, 'test-model');
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) };
  } });
  assert.equal(await complete([]), '{}');
  const failing = createOpenAIClient({ apiKey: 'test', model: 'test', fetchImpl: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(failing([]), /HTTP 401/);
});

test('Groq uses its own endpoint and key', async () => {
  const complete = createClient({ provider: 'groq', apiKey: 'groq-test', model: 'example-model', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer groq-test');
    assert.deepEqual(JSON.parse(options.body).response_format, { type: 'json_object' });
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) };
  } });
  assert.equal(await complete([]), '{}');
  assert.throws(() => createClient({ provider: 'unknown' }), /LLM_PROVIDER/);
});

test('Gemini maps messages and returns JSON to the existing report pipeline', async () => {
  const state = example('normal');
  const complete = createClient({ provider: 'gemini', apiKey: 'gemini-test', model: 'test-model', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');
    assert.equal(options.headers['x-goog-api-key'], 'gemini-test');
    const body = JSON.parse(options.body);
    assert.match(body.systemInstruction.parts[0].text, /project report writer/);
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), state);
    assert.equal(body.contents[0].role, 'user');
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ pages: pages(state) }) }] } }] }) };
  } });
  assert.match(await generateReport(state, { complete }), /# Risks and Issues/);
});

test('Gemini rejects incomplete or failed responses without exposing response bodies', async () => {
  const client = result => createClient({ provider: 'gemini', apiKey: 'test', model: 'test', fetchImpl: async () => result });
  await assert.rejects(client({ ok: false, status: 429 })([]), /HTTP 429/);
  await assert.rejects(client({ ok: true, json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS' }] }) })([]), /did not complete/);
  await assert.rejects(client({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [] } }] }) })([]), /no content/);
  assert.throws(() => createClient({ provider: 'gemini', apiKey: 'test', model: '../bad' }), /model ID/);
});
