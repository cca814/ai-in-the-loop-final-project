import test from 'node:test';
import assert from 'node:assert/strict';
import { withRenderSlot, RenderBusyError } from './render-runtime.js';
import { slideHandler } from './http.js';

test('limits concurrent renderers and releases slots after success, failure and cancellation', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = withRenderSlot(() => gate);
  const second = withRenderSlot(() => gate);
  await assert.rejects(withRenderSlot(async () => 'third'), RenderBusyError);
  release('done');
  await Promise.all([first, second]);
  await assert.rejects(withRenderSlot(async () => { throw new Error('failed'); }), /failed/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(withRenderSlot(async () => 'never', { signal: controller.signal }), error => error.code === 'OPERATION_CANCELLED');
  assert.equal(await withRenderSlot(async () => 'available'), 'available');
});

test('layout endpoint validates inputs before rendering and returns diagnostics without LLM calls', async () => {
  const report = '# Summary\n\n- Fact\n\n## Speaker Notes\n\nNote.';
  const request = body => new Request('http://localhost/api/reports/layout', { method: 'POST', body: JSON.stringify(body) });
  let calls = 0;
  const handler = slideHandler('layout', { production: false, complete: async () => { throw new Error('Must not call model'); }, inspectLayout: async slides => { calls++; assert.match(slides, /# Summary/); return { checkedPages: 1, overflowPages: [] }; } });
  assert.equal((await handler(request({ report: 'Bad' }))).status, 400);
  assert.equal(calls, 0);
  const response = await handler(request({ report }));
  assert.deepEqual(await response.json(), { checkedPages: 1, overflowPages: [] });
  assert.equal(calls, 1);
});
