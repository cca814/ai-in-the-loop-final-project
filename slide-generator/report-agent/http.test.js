import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reportHandler } from './http.js';
import { ConfigurationError, ModelOutputError, ProviderError } from './errors.js';
import { createClient } from './llm.js';

const state = JSON.parse(readFileSync(new URL('../schemas/examples/normal.json', import.meta.url), 'utf8'));
const request = (body, origin = 'http://localhost:3000') => new Request('http://localhost:3000/api/reports/generate', { method: 'POST', headers: { origin }, body: JSON.stringify(body) });

test('provider failures identify selection, generation and revision stages without exposing internals', async () => {
  for (const [mode, useRepository, stage] of [['generate', true, 'repository_selection'], ['generate', false, 'report_generation'], ['revise', false, 'report_revision']]) {
    const fail = async () => { throw new ProviderError(503, 3); };
    const response = await reportHandler(mode, { production: false, complete: fail, retrieveContext: fail })(request({ state, useRepository, report: 'Keep manual draft', request: 'Shorten this', history: [] }));
    const result = await response.json();
    assert.equal(result.stage, stage);
    assert.equal(result.code, 'PROVIDER_UNAVAILABLE');
    assert.match(result.error, /已嘗試 3 次/);
    assert.equal(result.report, undefined);
  }
});

test('generation API forwards the state and returns a Markdown report', async () => {
  const handler = reportHandler('generate', { production: false, complete: async messages => {
    assert.deepEqual(JSON.parse(messages[1].content), state);
    return JSON.stringify({ pages: ['Project Overview', 'Feature Progress', 'Recent Changes', 'Risks and Issues'].map(title => ({ title, bullets: ['Example'], script: 'Example note.', source_ids: ['pr-41'] })) });
  } });
  const response = await handler(request({ state }));
  assert.equal(response.status, 200);
  assert.match((await response.json()).report, /# Project Overview/);
});

test('revision API keeps manual edits and carries history to the existing module', async () => {
  const history = [{ role: 'user', content: 'Earlier request' }];
  const handler = reportHandler('revise', { production: false, complete: async messages => {
    assert.deepEqual(JSON.parse(messages[1].content).conversation_history, history);
    return JSON.stringify({ changes: [{ old: 'Original', new: 'Shorter' }], message: 'Updated' });
  } });
  const response = await handler(request({ state, report: 'Original\nManual edit', request: 'Shorten', history }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).report, 'Shorter\nManual edit');
});

test('rejects bad input, cross-origin and production requests before calling a model', async () => {
  const complete = async () => { throw new Error('Must not call model'); };
  assert.equal((await reportHandler('generate', { complete, production: false })(request({ state: null }))).status, 400);
  assert.equal((await reportHandler('generate', { complete, production: false })(request({ state }, 'https://another.example'))).status, 403);
  assert.equal((await reportHandler('generate', { complete, production: true })(request({ state }))).status, 403);
});

test('provider errors do not leak response bodies or credentials', async () => {
  const handler = reportHandler('generate', { production: false, complete: async () => { throw new Error('HTTP 503 secret-value'); } });
  const response = await handler(request({ state }));
  assert.equal(response.status, 502);
  const error = (await response.json()).error;
  assert.match(error, /503/);
  assert.ok(!error.includes('secret-value'));
});

test('revision API exposes a clear exhausted-retry error while preserving input', async () => {
  const body = { state, report: 'Current report', request: '繁體中文', history: [] };
  const copy = structuredClone(body);
  let attempts = 0;
  const complete = createClient({ provider: 'gemini', apiKey: 'fake', model: 'test-model', sleep: async () => {}, fetchImpl: async () => { attempts++; return { ok: false, status: 503 }; } });
  const response = await reportHandler('revise', { production: false, complete })(request(body));
  assert.equal(response.status, 502);
  const result = await response.json();
  assert.equal(result.code, 'PROVIDER_UNAVAILABLE');
  assert.match(result.error, /已嘗試 3 次/);
  assert.equal(attempts, 3);
  assert.deepEqual(body, copy);
});

test('distinguishes output, timeout and configuration failures without leaking raw errors', async () => {
  for (const [cause, code] of [[new ModelOutputError('raw-invalid-data'), 'MODEL_OUTPUT_INVALID'], [new ProviderError(null, 1, 'timeout'), 'PROVIDER_TIMEOUT'], [new ConfigurationError('raw-config-secret'), 'MODEL_CONFIGURATION']]) {
    const response = await reportHandler('generate', { production: false, complete: async () => { throw cause; } })(request({ state }));
    const result = await response.json();
    assert.equal(result.code, code);
    assert.ok(!result.error.includes('raw-'));
  }
});

test('reports the generation field or provider stage without exposing rejected model text', async () => {
  const response = await reportHandler('generate', { production: false, complete: async () => JSON.stringify({ pages: [{ title: 'PRIVATE_REJECTED_TEXT', bullets: ['A point'], script: [], source_ids: ['pr-41'] }] }) })(request({ state }));
  const result = await response.json();
  assert.equal(result.code, 'GENERATION_CONTENT_INVALID');
  assert.match(result.error, /第 1 節的講稿/);
  assert.ok(!result.error.includes('PRIVATE_REJECTED_TEXT'));
  for (const code of ['PROVIDER_RESPONSE_INCOMPLETE', 'PROVIDER_RESPONSE_EMPTY', 'PROVIDER_RESPONSE_INVALID']) {
    const failed = await reportHandler('generate', { production: false, complete: async () => { throw new ModelOutputError('private-provider-output', code); } })(request({ state }));
    const output = await failed.json();
    assert.equal(output.code, code);
    assert.ok(!output.error.includes('private-provider-output'));
  }
});
