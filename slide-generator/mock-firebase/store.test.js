import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockStore } from './store.js';
import { storageHandler } from './http.js';
import { localReportHandler } from '../state-replay/integration.js';
import { importStateDirectory } from './import-states.mjs';
import { sample } from '../state-replay/testing/sample.js';

const state = JSON.parse(await readFile(new URL('../schemas/examples/normal.json', import.meta.url), 'utf8'));
const dataset = { label: 'Test', snapshots: [{ id: state.event_id, label: 'Normal', state }] };
const draft = { report: '# Result\n\n- Preview\n\n## Speaker Notes\n\nExplain preview.', history: [{ role: 'user', content: 'Shorten' }, { role: 'assistant', content: 'Done' }], focus: 'For managers', request: 'Next change' };
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'report-mock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: mockStore({ root }) };
}
test('browser cleanup removes only matching owned fixtures and their drafts', async t => {
  const { store } = await setup(t);
  const kept = await store.putDataset(dataset);
  const keptDraft = await store.saveDraft(kept.id, state.event_id, draft, 0);
  const make = async (label, eventId) => store.putDataset({ label, snapshots: [{ id: eventId, label: eventId, state: { ...state, event_id: eventId } }] });
  const single = await make('mock-browser-1795343646423', 'mock-browser-1795343646423');
  const history = await make('mock-history-browser-1795343646423', 'mock-history-1795343646423-0');
  const lookalike = await make('mock-browser-1795343646424', 'user-snapshot');
  await store.saveDraft(single.id, single.snapshots[0].id, draft, 0);
  assert.deepEqual(await store.removeBrowserTestDatasets([single.id]), [single.id]);
  assert.deepEqual(await store.removeBrowserTestDatasets(), [history.id]);
  assert.deepEqual((await store.listDatasets()).map(item => item.id), [kept.id, lookalike.id]);
  assert.deepEqual(await store.getDraft(kept.id, state.event_id), keptDraft);
  const { root } = await setup(t);
  assert.deepEqual(await mockStore({ root }).removeBrowserTestDatasets(), []);
});
test('persist States and draft/conversation independently across adapter restarts', async t => {
  const { root, store } = await setup(t);
  const saved = await store.putDataset(dataset);
  assert.equal((await store.putDataset(dataset)).id, saved.id);
  assert.equal((await store.listDatasets()).length, 1);
  assert.equal(await store.getDraft(saved.id, state.event_id), null);
  const one = await store.saveDraft(saved.id, state.event_id, draft, 0);
  assert.equal(one.revision, 1);
  const restarted = mockStore({ root });
  assert.deepEqual(await restarted.getDraft(saved.id, state.event_id), one);
  assert.deepEqual(await restarted.getState(saved.id, state.event_id), state);
  assert.deepEqual(one.history, draft.history);
  assert.equal((await restarted.saveDraft(saved.id, state.event_id, { ...draft, report: 'Manual edit' }, 1)).revision, 2);
  assert.deepEqual(await restarted.getState(saved.id, state.event_id), state);
});
test('project-ID API returns all and only that project States; no mutation or silent truncation', async t => {
  const { store } = await setup(t);
  const first = await store.putDataset(dataset);
  const saved = await store.saveDraft(first.id, state.event_id, draft, 0);
  const later = { ...state, event_id: 'next-event', base_state_id: state.event_id, updated_at: '2026-11-16T00:00:00Z' };
  await store.putDataset({ label: 'Later', snapshots: [{ id: later.event_id, label: 'Later', state: later }, ...dataset.snapshots] });
  const other = { ...state, project_id: 'other-project', event_id: 'other-event' };
  await store.putDataset({ label: 'Other project', snapshots: [{ id: other.event_id, label: 'Other', state: other }] });
  const handler = storageHandler({ store, production: false });
  const get = id => handler(new Request(`http://localhost/api/reports/storage?${new URLSearchParams({ projectId: id })}`));
  const response = await get(state.project_id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.projectId, state.project_id);
  assert.deepEqual(body.states, [state, later]);
  assert.ok(body.datasets.every(item => item.snapshots.every(snapshot => snapshot.state.project_id === state.project_id)));
  assert.equal((await get('unknown-project')).status, 404);
  assert.equal((await get('../bad')).status, 400);
  assert.equal((await get('')).status, 400);
  assert.deepEqual(await store.getDraft(first.id, state.event_id), saved);
  assert.deepEqual(await store.getState(first.id, state.event_id), state);
  await store.putDataset({ label: 'Conflicting State', snapshots: [{ id: state.event_id, label: 'Conflict', state: { ...state, project_name: 'Different' } }] });
  assert.equal((await get(state.project_id)).status, 409);
});
test('stale versions conflict without overwriting; other snapshots do not share drafts', async t => {
  const { store } = await setup(t);
  const saved = await store.putDataset(dataset);
  await store.saveDraft(saved.id, state.event_id, draft, 0);
  await assert.rejects(store.saveDraft(saved.id, state.event_id, { ...draft, report: 'stale' }, 0), { code: 'STORAGE_CONFLICT', status: 409 });
  assert.equal((await store.getDraft(saved.id, state.event_id)).report, draft.report);
  const otherState = JSON.parse(await readFile(new URL('../schemas/examples/feature_done.json', import.meta.url), 'utf8'));
  const other = await store.putDataset({ label: 'Other', snapshots: [{ id: otherState.event_id, label: 'Done', state: otherState }] });
  assert.equal(await store.getDraft(other.id, otherState.event_id), null);
  await assert.rejects(store.getDraft(saved.id, otherState.event_id), { code: 'STORAGE_NOT_FOUND' });
});
test('schema, bounded history, path identity and failed writes preserve accepted data', async t => {
  const { store, root } = await setup(t);
  const saved = await store.putDataset(dataset);
  await assert.rejects(store.putDataset({ ...dataset, snapshots: [{ ...dataset.snapshots[0], state: { ...state, features: 'bad' } }] }));
  await assert.rejects(store.getDraft('../../secret', state.event_id), { code: 'STORAGE_INPUT_INVALID' });
  await assert.rejects(store.saveDraft(saved.id, state.event_id, { ...draft, history: [{ role: 'system', content: 'bad' }] }, 0), { code: 'STORAGE_INPUT_INVALID' });
  await writeFile(join(root, 'database.json.lock'), 'busy');
  await assert.rejects(store.saveDraft(saved.id, state.event_id, draft, 0), { code: 'STORAGE_BUSY' });
  assert.equal(await store.getDraft(saved.id, state.event_id), null);
});
test('API seed/get/save/conflict/missing/security/input and storage failure responses', async t => {
  const { store, root } = await setup(t);
  const handler = storageHandler({ store, production: false });
  const post = body => handler(new Request('http://localhost/api/reports/storage', { method: 'POST', body: JSON.stringify(body) }));
  const seeded = await (await post({ action: 'seed' })).json();
  assert.equal(seeded.datasets[0].snapshots.length, 3);
  const id = seeded.datasets[0].id;
  const query = `http://localhost/api/reports/storage?${new URLSearchParams({ datasetId: id, snapshotId: state.event_id })}`;
  assert.deepEqual(await (await handler(new Request(query))).json(), { draft: null });
  assert.equal((await post({ action: 'save', datasetId: id, snapshotId: state.event_id, draft, expectedRevision: 0 })).status, 200);
  assert.equal((await post({ action: 'save', datasetId: id, snapshotId: state.event_id, draft, expectedRevision: 0 })).status, 409);
  assert.equal((await handler(new Request(query))).headers.get('cache-control'), 'no-store');
  assert.equal((await handler(new Request('http://localhost/api/reports/storage', { headers: { origin: 'https://other.example' } }))).status, 403);
  assert.equal((await storageHandler({ store, production: true })(new Request(query))).status, 403);
  assert.equal((await handler(new Request('http://external.example/api/reports/storage'))).status, 403);
  assert.equal((await post({ action: 'save' })).status, 400);
  assert.equal((await handler(new Request('http://localhost/api/reports/storage', { method: 'POST', body: '{' }))).status, 400);
  await writeFile(join(root, 'database.json'), '{');
  assert.equal((await post({ action: 'save', datasetId: id, snapshotId: state.event_id, draft, expectedRevision: 1 })).status, 503);
  assert.equal(await readFile(join(root, 'database.json'), 'utf8'), '{');
});

test('report generation reloads accepted Mock State rather than trusting browser assessments', async t => {
  const { store } = await setup(t);
  const saved = await store.putDataset(dataset);
  let modelInput;
  const handler = localReportHandler('generate', { mockStorage: store, production: false, complete: async messages => {
    modelInput = JSON.stringify(messages);
    return JSON.stringify({ pages: [{ title: '成果', bullets: ['提供報告預覽。'], script: '說明預覽能力。', source_ids: ['pr-41'] }] });
  } });
  const response = await handler(new Request('http://localhost/api/reports/generate', { method: 'POST', body: JSON.stringify({ mockDatasetId: saved.id, state: { ...state, project_name: 'BROWSER_TAMPERED_NAME' }, focus: '', useRepository: false }) }));
  assert.equal(response.status, 200);
  assert.ok(!modelInput.includes('BROWSER_TAMPERED_NAME'));
  assert.ok(modelInput.includes(state.project_name));
  assert.deepEqual(await store.getState(saved.id, state.event_id), state);
});

test('offline producer handoff imports an ordered State chain without changing content or drafts', async t => {
  const { store, root } = await setup(t);
  const directory = join(root, 'incoming'); await mkdir(directory);
  const next = JSON.parse(await readFile(new URL('../schemas/examples/feature_done.json', import.meta.url), 'utf8'));
  // Deliberately reverse filenames; predecessor identity determines the order.
  await writeFile(join(directory, 'a.json'), JSON.stringify(next));
  await writeFile(join(directory, 'z.json'), JSON.stringify(state));
  const saved = await importStateDirectory(directory, { store });
  assert.deepEqual(saved.snapshots.map(item => item.state), [state, next]);
  assert.match(saved.snapshots[1].label, /PR #42/);
  await store.saveDraft(saved.id, next.event_id, draft, 0);
  const again = await importStateDirectory(directory, { store });
  assert.equal(again.id, saved.id);
  assert.equal((await store.getDraft(saved.id, next.event_id)).report, draft.report);
  const mergeInventory = join(root, 'inventory.json');
  await writeFile(mergeInventory, JSON.stringify({ repository: state.repository.full_name, entries: [
    { source_commit_sha: state.source_commit_sha, pr: 41, merged_at: '2026-01-01T00:00:00Z' },
    { source_commit_sha: next.source_commit_sha, pr: 42, merged_at: '2026-01-02T00:00:00Z' },
  ] }));
  const withHistory = await importStateDirectory(directory, { store, mergeInventory });
  assert.equal(withHistory.id, saved.id); assert.equal(withHistory.supportsHistory, true);
  assert.equal((await store.getHistory(saved.id, next.event_id, { startCommit: state.source_commit_sha, endCommit: next.source_commit_sha })).merges.length, 2);
  await writeFile(join(directory, 'a.json'), JSON.stringify({ ...next, base_state_id: 'different-parent' }));
  await assert.rejects(importStateDirectory(directory, { store }), /contiguous State chain/);
  assert.deepEqual((await store.listDatasets())[0].snapshots.map(item => item.state), [state, next]);
});

test('existing Mock datasets gain repo capability without changing IDs, State or saved drafts', async t => {
  const { store, root } = await setup(t);
  const saved = await store.putDataset(dataset);
  await store.saveDraft(saved.id, state.event_id, draft, 0);
  const file = join(root, 'database.json');
  const previousFormat = JSON.parse(await readFile(file, 'utf8'));
  previousFormat.datasets[saved.id].supportsRepository = false;
  await writeFile(file, JSON.stringify(previousFormat));
  const loaded = (await store.listDatasets())[0];
  assert.equal(loaded.supportsRepository, true);
  assert.equal(loaded.id, saved.id);
  assert.deepEqual(loaded.snapshots[0].state, state);
  assert.equal((await store.getDraft(saved.id, state.event_id)).report, draft.report);
  const nonGithub = { ...state, repository: { ...state.repository, url: 'https://example.com/repo' } };
  const other = await store.putDataset({ ...dataset, supportsRepository: true, snapshots: [{ ...dataset.snapshots[0], state: nonGithub }] });
  assert.equal(other.supportsRepository, false);
});

test('Mock generation and revision read only the accepted commit; unchecking skips repo requests', async t => {
  const { store } = await setup(t);
  const fixture = sample();
  const oldState = fixture.states[0];
  const saved = await store.putDataset({ label: 'Versioned project', snapshots: fixture.states.map(item => ({ id: item.event_id, label: item.event_id, state: item })) });
  const before = structuredClone(oldState);
  const transcripts = [];
  const complete = async messages => {
    transcripts.push(JSON.stringify(messages));
    const payload = JSON.parse(messages[1].content);
    if (payload.available_files) return JSON.stringify({ files: [{ path: 'index.js', start_line: 1, end_line: 2 }], reason: 'Read selected version' });
    return JSON.stringify({ pages: [{ title: '成果', bullets: ['可呼叫工作函式。'], script: '說明目前版本。', source_ids: ['repo-file-1'] }] });
  };
  const post = (mode, body, model = complete) => localReportHandler(mode, { mockStorage: store, publicClient: () => fixture.client, production: false, complete: model })(new Request(`http://localhost/api/reports/${mode}`, { method: 'POST', body: JSON.stringify({ mockDatasetId: saved.id, state: { ...oldState, project_name: 'BROWSER_TAMPERED' }, useRepository: true, ...body }) }));
  const generated = await post('generate', {});
  assert.equal(generated.status, 200);
  const result = await generated.json();
  assert.equal(result.repository.commit, oldState.source_commit_sha);
  assert.ok(result.report.includes(`/blob/${oldState.source_commit_sha}/index.js`));
  assert.ok(transcripts.at(-1).includes('export const version = 1'));
  assert.ok(!transcripts.at(-1).includes('export const version = 3'));
  assert.ok(!transcripts.at(-1).includes('BROWSER_TAMPERED'));
  const revised = await post('revise', { report: result.report, request: '改寫講稿', history: [] }, async messages => {
    const payload = JSON.parse(messages[1].content);
    if (payload.available_files) return complete(messages);
    assert.ok(JSON.stringify(messages).includes('export const version = 1'));
    return JSON.stringify({ changes: [{ old: '說明目前版本。', new: '說明這個版本的工作執行方式。' }], message: '已改寫講稿。' });
  });
  assert.equal(revised.status, 200);
  assert.ok(fixture.calls.some(url => url.endsWith(`/commits/${oldState.source_commit_sha}`)));
  assert.ok(!fixture.calls.some(url => url.includes('/commits/main') || url.includes(`/commits/${fixture.plan.head_commit}`)));
  fixture.calls.length = 0;
  const stateOnly = await post('generate', { useRepository: false }, async () => JSON.stringify({ pages: [{ title: '成果', bullets: ['可呼叫工作函式。'], script: '說明目前版本。', source_ids: ['pr-7'] }] }));
  assert.equal(stateOnly.status, 200);
  assert.equal(fixture.calls.length, 0);
  assert.deepEqual(await store.getState(saved.id, oldState.event_id), before);
});

test('Mock ranges use validated merge times, preserve IDs/drafts and reject wrong endpoints or missing metadata', async t => {
  const { store } = await setup(t);
  const fixture = sample();
  const input = { label: 'History', snapshots: fixture.states.map(state => ({ id: state.event_id, label: state.event_id, state })) };
  const plain = await store.putDataset(input);
  const last = fixture.states.at(-1);
  const range = { startCommit: fixture.states[1].source_commit_sha, endCommit: last.source_commit_sha };
  assert.equal(plain.supportsHistory, false);
  await assert.rejects(store.getHistory(plain.id, last.event_id, range));
  await store.saveDraft(plain.id, last.event_id, draft, 0);
  const mergeMetadata = fixture.plan.merges.map(merge => ({ commit: merge.commit, pr_number: merge.pr_number, merged_at: merge.merged_at }));
  const saved = await store.putDataset({ ...input, mergeMetadata });
  assert.equal(saved.id, plain.id); assert.equal(saved.supportsHistory, true);
  assert.equal((await store.getDraft(saved.id, last.event_id)).report, draft.report);
  const history = await store.getHistory(saved.id, last.event_id, range);
  assert.deepEqual(history.merges.map(item => item.pr_number), [3, 12]);
  assert.equal(history.merges[0].merged_at, fixture.plan.merges[1].merged_at);
  assert.notEqual(history.merges[0].merged_at, fixture.states[1].updated_at);
  await store.saveDraft(saved.id, last.event_id, { ...draft, mergeRange: range }, 1);
  assert.deepEqual((await store.getDraft(saved.id, last.event_id)).mergeRange, range);
  await store.putDataset(input);
  assert.equal((await store.listDatasets())[0].supportsHistory, true);
  for (const bad of [{ startCommit: range.endCommit, endCommit: range.startCommit }, { ...range, startCommit: 'f'.repeat(40) }]) await assert.rejects(store.getHistory(saved.id, last.event_id, bad));
  await assert.rejects(store.getHistory(saved.id, fixture.states[0].event_id, range));
  for (const metadata of [[], mergeMetadata.slice(1), mergeMetadata.map((entry, i) => i ? entry : { ...entry, pr_number: 999 }), mergeMetadata.map((entry, i) => i ? entry : { ...entry, merged_at: '2030-01-01T00:00:00Z' })]) await assert.rejects(store.putDataset({ ...input, mergeMetadata: metadata }), { code: 'STORAGE_INPUT_INVALID' });
  assert.deepEqual(await store.getState(saved.id, last.event_id), last);
});

test('generation and revision receive only the selected Mock range from storage; bad ranges fail before model calls', async t => {
  const { store } = await setup(t);
  const fixture = sample();
  const saved = await store.putDataset({ label: 'History', snapshots: fixture.states.map(state => ({ id: state.event_id, label: state.event_id, state })), mergeMetadata: fixture.plan.merges.map(merge => ({ commit: merge.commit, pr_number: merge.pr_number, merged_at: merge.merged_at })) });
  const last = fixture.states.at(-1);
  const range = { startCommit: fixture.states[1].source_commit_sha, endCommit: last.source_commit_sha };
  let calls = 0;
  const model = mode => async messages => {
    calls++;
    const payload = JSON.parse(messages[1].content);
    assert.deepEqual(payload.merge_history.merges.map(item => item.pr_number), [3, 12]);
    assert.equal(payload.merge_history.merges[0].summary, fixture.states[1].trigger.summary);
    return mode === 'generate'
      ? JSON.stringify({ pages: [{ title: '期間成果', bullets: ['工作執行實作已更新。'], script: '說明期間成果。', source_ids: ['merge-pr-3', 'merge-pr-12'] }] })
      : JSON.stringify({ changes: [{ old: '說明期間成果。', new: '說明這段期間的工作執行更新。' }], message: '已調整講稿。' });
  };
  const post = (mode, body) => localReportHandler(mode, { mockStorage: store, production: false, complete: model(mode) })(new Request(`http://localhost/api/reports/${mode}`, { method: 'POST', body: JSON.stringify({ state: last, mockDatasetId: saved.id, mergeRange: range, useRepository: false, ...body }) }));
  const response = await post('generate', {}); assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.mergeRange.count, 2);
  assert.ok(result.report.includes('/pull/3'));
  const revised = await post('revise', { report: result.report, request: '改寫講稿', history: [] }); assert.equal(revised.status, 200);
  const previousCalls = calls;
  const invalid = await post('generate', { mergeRange: { ...range, startCommit: 'f'.repeat(40) } });
  assert.equal(invalid.status, 400); assert.equal(calls, previousCalls);
});
