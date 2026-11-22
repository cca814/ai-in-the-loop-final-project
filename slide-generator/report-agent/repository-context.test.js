import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sample } from '../state-replay/testing/sample.js';
import { retrieveRepositoryContext, repositorySources } from './repository-context.js';
import { reportHandler } from './http.js';
import { generateReport } from './index.js';
import { reviseReport } from './revision.js';
import { ProviderError } from './errors.js';

const fixture = sample(); const state = fixture.states.at(-1);
const range = { path: 'index.js', start_line: 1, end_line: 3 };
const plan = files => JSON.stringify({ files, reason: 'Read current implementation' });
const loadSnapshot = async current => {
  const index = fixture.states.findIndex(item => item.repository.full_name === current.repository.full_name && item.source_commit_sha === current.source_commit_sha);
  if (index < 0) throw new Error('Unknown snapshot');
  return structuredClone(fixture.snapshots[index]);
};
const retrieve = (args, options) => retrieveRepositoryContext(args, { loadSnapshot, ...options });
const handler = (mode, options) => reportHandler(mode, { retrieveContext: (args, dependencies) => retrieve(args, dependencies), ...options });
const request = body => new Request('http://localhost/api/reports/generate', { method: 'POST', body: JSON.stringify(body) });
const pages = id => JSON.stringify({ pages: [{ title: '實作現況', bullets: ['可呼叫工作函式。'], script: '說明目前的工作執行實作。', source_ids: [id] }] });

test('planner receives metadata only, selects exact-commit verified excerpts and preserves inputs', async () => {
  const original = structuredClone(state);
  const context = await retrieve({ state, mode: 'generate', request: '說明工作執行方式' }, { complete: async messages => {
    const payload = JSON.parse(messages[1].content);
    assert.equal(payload.commit, state.source_commit_sha); assert.ok(payload.available_files.every(file => !('content' in file)));
    return plan([range]);
  } });
  assert.equal(context.files[0].content, fixture.snapshots.at(-1).files['index.js'].content);
  assert.equal(repositorySources(context, state)[0].url, `${state.repository.url}/blob/${state.source_commit_sha}/index.js#L1-L3`);
  assert.deepEqual(state, original);
});

test('invalid path, range, JSON and duplicate selections are corrected once against original request', async () => {
  for (const invalid of ['bad JSON', plan([{ ...range, path: '../secret.js' }]), plan([{ ...range, start_line: '1' }]), plan([{ ...range, end_line: 181 }]), plan([range, range]), plan(Array(5).fill(range))]) {
    let calls = 0;
    const context = await retrieve({ state, mode: 'revise', request: '說明實作', report: 'Manual report', history: [{ role: 'user', content: 'Prior' }] }, { complete: async messages => {
      calls++; const payload = JSON.parse(messages[1].content); assert.equal(payload.current_report_excerpt, 'Manual report');
      if (calls === 1) return invalid;
      assert.ok(JSON.parse(messages.at(-1).content).correction_required); return plan([range]);
    } });
    assert.equal(calls, 2); assert.equal(context.files.length, 1);
  }
});

test('provider, corrupted blob and identity errors are not retried as selection JSON failures', async () => {
  let calls = 0;
  await assert.rejects(() => retrieve({ state, mode: 'generate' }, { complete: async () => { calls++; throw new ProviderError(503); } }), ProviderError); assert.equal(calls, 1);
  const snapshot = await loadSnapshot(state); snapshot.files['index.js'].content += 'corrupt';
  await assert.rejects(() => retrieve({ state, mode: 'generate' }, { loadSnapshot: async () => snapshot, complete: async () => plan([range]) }), /integrity/);
  await assert.rejects(() => retrieve({ state, mode: 'generate' }, { loadSnapshot: async () => ({ ...snapshot, commit: { sha: 'f'.repeat(40) } }), complete: async () => { throw new Error('must not call'); } }), /identity/);
});

test('excerpt character budget, EOF clamping, unsafe paths and source identity are enforced', async () => {
  const snapshot = await loadSnapshot(state); const content = 'x'.repeat(24_001);
  snapshot.files['large.md'] = { content, sha: createHash('sha1').update(`blob ${content.length}\0${content}`).digest('hex') };
  await assert.rejects(() => retrieve({ state, mode: 'generate' }, { loadSnapshot: async () => snapshot, complete: async () => plan([{ path: 'large.md', start_line: 1, end_line: 1 }]) }), /budget/);
  const context = await retrieve({ state, mode: 'generate' }, { complete: async () => plan([{ ...range, end_line: 100 }]) }); assert.equal(context.files[0].end_line, 3);
  assert.throws(() => repositorySources({ ...context, commit: 'f'.repeat(40) }, state), /identity/);
  await assert.rejects(() => retrieve({ state, mode: 'generate' }, { complete: async () => plan([{ ...range, path: '.env.local' }]) }));
});

test('selected code can be cited by generation/revision but fabricated links and source identifiers fail', async () => {
  const context = await retrieve({ state, mode: 'generate' }, { complete: async () => plan([range]) });
  const report = await generateReport(state, { complete: async () => pages('repo-file-1'), repositoryContext: context }); assert.ok(report.includes(context.files[0].url));
  await assert.rejects(() => generateReport(state, { complete: async () => pages('invented'), repositoryContext: context }), /Unknown response source/);
  const revised = await reviseReport({ state, report: 'Manual wording', request: 'Add implementation source' }, { repositoryContext: context, complete: async () => JSON.stringify({ changes: [{ old: 'Manual wording', new: `Manual wording [code](${context.files[0].url})` }], message: 'Added source' }) }); assert.ok(revised.report.includes(context.files[0].url));
  await assert.rejects(() => reviseReport({ state, report: 'Manual wording', request: 'Add source' }, { repositoryContext: context, complete: async () => JSON.stringify({ changes: [{ old: 'Manual wording', new: '[fake](https://example.com/unverified)' }], message: 'Added' }) }), /unverified/);
});

test('HTTP selection/generation and no-file revision share JSON contract; invalid options never reach model', async () => {
  let calls = 0;
  const response = await handler('generate', { production: false, complete: async () => ++calls === 1 ? plan([range]) : pages('repo-file-1') })(request({ state, useRepository: true }));
  assert.equal(response.status, 200); assert.equal(calls, 2); const output = await response.json(); assert.equal(output.repository.status, 'read'); assert.ok(!('content' in output.repository.files[0]));
  calls = 0;
  const revised = await handler('revise', { production: false, complete: async messages => {
    if (++calls === 1) return plan([]);
    assert.equal(JSON.parse(messages[1].content).conversation_history[0].content, 'Prior');
    return JSON.stringify({ changes: [{ old: 'Manual', new: 'Edited' }], message: 'Edited' });
  } })(request({ state, useRepository: true, report: 'Manual content', request: 'Reword', history: [{ role: 'user', content: 'Prior' }] }));
  assert.equal(revised.status, 200); assert.equal((await revised.json()).repository.status, 'not_needed');
  for (const options of [{ useRepository: 'yes' }, { focus: 123 }, { repository_context: {} }, { merge_history: {} }]) assert.equal((await handler('generate', { production: false, complete: async () => { throw new Error('must not call'); } })(request({ state, ...options }))).status, 400);
});
