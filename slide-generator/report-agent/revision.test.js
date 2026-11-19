import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviseReport } from './revision.js';
import { createClient } from './llm.js';

const state = JSON.parse(readFileSync(new URL('../schemas/examples/normal.json', import.meta.url), 'utf8'));
const reply = result => async () => JSON.stringify(result);

test('edits the latest manually edited report and passes context without changing state', async () => {
  const original = structuredClone(state);
  const report = '# Overview\nManual edit\n\n# Other\nKeep this.\n';
  const history = [{ role: 'user', content: 'Make it shorter' }, { role: 'assistant', content: 'Done' }];
  const result = await reviseReport({ state, report, request: 'Change Manual edit to Edited', history }, { complete: async messages => {
    const input = JSON.parse(messages[1].content);
    assert.equal(input.current_report, report);
    assert.deepEqual(input.conversation_history, history);
    return JSON.stringify({ changes: [{ old: 'Manual edit', new: 'Edited' }], message: 'Changed.' });
  } });
  assert.equal(result.report, '# Overview\nEdited\n\n# Other\nKeep this.\n');
  assert.deepEqual(state, original);
});

test('rejects ambiguous and overlapping edits', async () => {
  const args = { state, report: 'same same unique', request: 'edit' };
  await assert.rejects(reviseReport(args, { complete: reply({ changes: [{ old: 'same', new: 'x' }], message: '' }) }), /exactly once/);
  await assert.rejects(reviseReport(args, { complete: reply({ changes: [{ old: 'same same', new: 'x' }, { old: 'same unique', new: 'y' }], message: '' }) }), /Overlapping/);
});

test('supports multiple turns and a clarification without changing the report', async () => {
  const first = await reviseReport({ state, report: 'A B', request: 'Change A' }, { complete: reply({ changes: [{ old: 'A', new: 'C' }], message: 'Done' }) });
  const second = await reviseReport({ state, report: first.report, request: 'Use an unsupported deadline', history: [{ role: 'user', content: 'Change A' }, { role: 'assistant', content: 'Done' }] }, { complete: reply({ changes: [], message: 'No deadline evidence.' }) });
  assert.equal(second.report, 'C B');
  assert.equal(second.message, 'No deadline evidence.');
});

test('two Gemini turns keep manual edits and forward history through the provider', async () => {
  let calls = 0;
  const complete = createClient({ provider: 'gemini', apiKey: 'fake-key', model: 'test-model', fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    const context = JSON.parse(body.contents[0].parts[0].text);
    calls++;
    if (calls === 1) {
      assert.equal(context.current_report, '# Notes\nOriginal\n# Other\nKeep\n');
      assert.deepEqual(context.conversation_history, []);
      return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ changes: [{ old: 'Original', new: 'Shorter' }], message: 'Shortened.' }) }] } }] }) };
    }
    assert.equal(context.current_report, '# Notes\nShorter\n# Other\nManual edit\n');
    assert.deepEqual(context.conversation_history, [{ role: 'user', content: 'Shorten notes' }, { role: 'assistant', content: 'Shortened.' }]);
    return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ changes: [{ old: 'Shorter', new: 'Concise' }], message: 'Reworded.' }) }] } }] }) };
  } });
  const first = await reviseReport({ state, report: '# Notes\nOriginal\n# Other\nKeep\n', request: 'Shorten notes' }, { complete });
  const manualReport = first.report.replace('Keep', 'Manual edit');
  const second = await reviseReport({ state, report: manualReport, request: 'Reword the previous edit', history: [{ role: 'user', content: 'Shorten notes' }, { role: 'assistant', content: first.message }] }, { complete });
  assert.equal(second.report, '# Notes\nConcise\n# Other\nManual edit\n');
  assert.equal(calls, 2);
});
