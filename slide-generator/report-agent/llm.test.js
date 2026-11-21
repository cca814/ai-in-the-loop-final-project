import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from './llm.js';
import { ModelOutputError, ProviderError } from './errors.js';

const success = () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"changes":[],"message":"Done"}' }] } }] }) });

test('Gemini retries explicit 503s with backoff and keeps the identical revision request', async () => {
  const bodies = [], delays = [];
  const client = createClient({ provider: 'gemini', apiKey: 'fake', model: 'test-model', sleep: async delay => { delays.push(delay); }, fetchImpl: async (_url, options) => {
    bodies.push(options.body);
    assert.ok(options.signal instanceof AbortSignal);
    return bodies.length < 3 ? { ok: false, status: 503 } : success();
  } });
  const result = await client([{ role: 'user', content: 'Translate the current report to Traditional Chinese.' }]);
  assert.equal(JSON.parse(result).message, 'Done');
  assert.deepEqual(delays, [1000, 2000]);
  assert.equal(bodies.length, 3);
  assert.ok(bodies.every(body => body === bodies[0]));
});

test('persistent 503 stops after three attempts without reading the error body', async () => {
  let calls = 0;
  const client = createClient({ provider: 'gemini', apiKey: 'fake', model: 'test-model', sleep: async () => {}, fetchImpl: async () => {
    calls++;
    return { ok: false, status: 503, json: async () => { throw new Error('Must not read provider error content'); } };
  } });
  await assert.rejects(client([]), error => error instanceof ProviderError && error.status === 503 && error.attempts === 3);
  assert.equal(calls, 3);
});

test('respects Retry-After, and does not retry auth, missing model or quota failures', async () => {
  let calls = 0;
  const delays = [];
  const client = createClient({ provider: 'groq', apiKey: 'fake', model: 'test-model', sleep: async delay => { delays.push(delay); }, fetchImpl: async () => {
    calls++;
    return calls === 1 ? { ok: false, status: 503, headers: new Headers({ 'Retry-After': '3' }) } : { ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) };
  } });
  await client([]);
  assert.deepEqual(delays, [3000]);
  for (const status of [400, 401, 403, 404, 429]) {
    let requests = 0;
    const failing = createClient({ provider: 'gemini', apiKey: 'fake', model: 'test-model', sleep: async () => { assert.fail('Should not retry'); }, fetchImpl: async () => { requests++; return { ok: false, status }; } });
    await assert.rejects(failing([]), error => error.status === status);
    assert.equal(requests, 1);
  }
});

test('does not resend timeouts, network failures or successful malformed responses', async () => {
  for (const kind of ['timeout', 'network', 'format']) {
    let calls = 0;
    const client = createClient({ provider: 'gemini', apiKey: 'fake', model: 'test-model', sleep: async () => { assert.fail('Should not retry'); }, fetchImpl: async () => {
      calls++;
      if (kind === 'timeout') throw new DOMException('Timeout', 'TimeoutError');
      if (kind === 'network') throw new TypeError('Network failed');
      return { ok: true, json: async () => { throw new SyntaxError('Invalid body'); } };
    } });
    await assert.rejects(client([]), error => kind === 'format' ? error instanceof ModelOutputError : error instanceof ProviderError && error.kind === kind);
    assert.equal(calls, 1);
  }
});
