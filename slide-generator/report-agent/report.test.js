import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateReport } from './index.js';
import { prepareState } from './state.js';
import { createClient, createOpenAIClient } from './llm.js';

const example = name => JSON.parse(readFileSync(new URL(`../schemas/examples/${name}.json`, import.meta.url), 'utf8'));
const pages = state => ['Project Overview', 'Feature Progress', 'Recent Changes', 'Risks and Issues'].map(title => ({ title, bullets: ['Evidence supplied'], script: 'Review the snapshot.', source_ids: [state.trigger.source_ref_id] }));

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
