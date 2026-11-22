import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sample } from './testing/sample.js';
import { collectMerges, loadMergeInput } from './github.js';
import { runReplay } from './replay.js';
import { replayStore } from './store.js';
import { buildState, analyzeState } from './agent.js';
import { validateState } from './validation.js';
import { loadDataset, localReportHandler, historyImportHandler } from './integration.js';

async function temporary(fn) { const root = await mkdtemp(join(tmpdir(), 'state-replay-')); try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); } }
const request = body => new Request('http://localhost/api/reports/generate', { method: 'POST', body: JSON.stringify(body) });

test('collect merged PRs chronologically, skip closed-unmerged, require complete pagination and ancestor evidence', async () => {
  const fixture = sample();
  const plan = await collectMerges(fixture.plan.repository.url, { client: fixture.client, now: () => fixture.plan.collected_at });
  assert.deepEqual(plan.merges.map(merge => merge.pr_number), [7, 3, 12]);
  assert.equal((await loadMergeInput(plan, plan.merges[0], fixture.client)).commit.sha, plan.merges[0].commit);
  const client = { ...fixture.client, get: async path => path.includes('/pulls?') ? Array(100).fill({ number: 1, merged_at: null }) : { status: 'diverged', merge_base_commit: { sha: 'f'.repeat(40) } } };
  await assert.rejects(() => collectMerges(plan.repository.url, { client, maxPages: 1 }), /pagination/);
  await assert.rejects(() => loadMergeInput(plan, plan.merges[0], client), /ancestor/);
});

test('plan uses no LLM; sequential rebuild resumes, skips accepted versions and preserves latest with full schema validation', async () => temporary(async root => {
  const fixture = sample(); let modelCalls = 0;
  const options = { root, client: fixture.client, now: () => fixture.plan.collected_at, complete: async messages => {
    modelCalls++;
    const payload = JSON.parse(messages[1].content);
    if (payload.previous_state !== undefined) {
      const position = fixture.plan.merges.findIndex(merge => merge.commit === payload.merge_evidence.merge.commit);
      assert.equal(payload.previous_state?.source_commit_sha || null, position ? fixture.plan.merges[position - 1].commit : null);
      assert.equal(payload.repository_context.commit, fixture.plan.merges[position].commit);
      assert.ok(!JSON.stringify(payload).includes('https://example.com/future'));
    }
    return fixture.complete(messages);
  } };
  const plan = await runReplay(fixture.plan.repository.url, options); assert.equal(modelCalls, 0); assert.equal(plan.completed, 0);
  const first = await runReplay(fixture.plan.repository.url, { ...options, run: true, limit: 1 }); assert.equal(first.completed, 1); assert.equal(first.complete, false);
  const done = await runReplay(fixture.plan.repository.url, { ...options, run: true, limit: 3 }); assert.equal(done.completed, 3); assert.equal(done.complete, true); assert.equal(modelCalls, 6);
  await runReplay(fixture.plan.repository.url, { ...options, run: true }); assert.equal(modelCalls, 6);
  const store = replayStore(done.id, { root }); const { states } = await store.read(); states.forEach(validateState);
  assert.deepEqual(JSON.parse(await readFile(join(store.directory, 'latest.json'), 'utf8')), states.at(-1));
  assert.equal(states[1].base_state_id, states[0].event_id); assert.equal(states[0].generator.name, 'historical-project-state-replay');
  assert.ok(states.every(state => state.data_gaps.some(gap => gap.section === 'risks')));
}));

test('provider/analysis failures preserve accepted latest and resume at failed merge; locks prevent concurrent writers', async () => temporary(async root => {
  const fixture = sample(); const options = { root, client: fixture.client, run: true, limit: 1, complete: fixture.complete, now: () => fixture.plan.collected_at };
  const result = await runReplay(fixture.plan.repository.url, options);
  const store = replayStore(result.id, { root }); const before = await readFile(join(store.directory, 'latest.json'), 'utf8');
  await assert.rejects(() => runReplay(fixture.plan.repository.url, { ...options, complete: async () => { throw new Error('Mock provider unavailable'); } }), /unavailable/);
  assert.equal(await readFile(join(store.directory, 'latest.json'), 'utf8'), before);
  assert.equal((await store.read()).states.length, 1);
  const release = await store.lock();
  await assert.rejects(() => runReplay(fixture.plan.repository.url, options), { code: 'EEXIST' }); await release();
  assert.equal((await runReplay(fixture.plan.repository.url, options)).completed, 2);
}));

test('schema/source/completion checks reject invented evidence and incomplete state chains', async () => {
  const fixture = sample(); const base = fixture.draftAt(0);
  const build = draft => buildState(null, fixture.plan, fixture.plan.merges[0], fixture.inputs[0], fixture.contexts[0], draft, { collectedAt: fixture.plan.collected_at });
  assert.throws(() => build({ ...base, features: [{ ...base.features[0], source_ref_ids: ['invented'] }] }), /Unknown evidence/);
  assert.throws(() => build({ ...base, features: [{ ...base.features[0], source_ref_ids: ['pr-7'] }] }), /current-commit/);
  assert.throws(() => build({ ...base, features: [{ ...base.features[0], extra: true }] }), /schema/);
  assert.throws(() => buildState(fixture.states[0], fixture.plan, fixture.plan.merges[1], fixture.inputs[1], fixture.contexts[1], { ...fixture.draftAt(1), features: [], feature_ids: [] }, { collectedAt: fixture.plan.collected_at }), /Keep prior/);
  assert.throws(() => validateState({ ...fixture.states[0], updated_at: 'not-a-date' }), /schema/);
  let calls = 0;
  await analyzeState({ previous: null, plan: fixture.plan, merge: fixture.plan.merges[0], input: fixture.inputs[0], context: fixture.contexts[0], collectedAt: fixture.plan.collected_at }, { complete: async () => { calls++; return calls === 1 ? 'invalid' : JSON.stringify(base); } });
  assert.equal(calls, 2);
});

test('corrupt/missing stored versions cannot be reset silently; checkpoint recovers missing latest and rejects changed merge prefix', async () => temporary(async root => {
  const fixture = sample(); const result = await runReplay(fixture.plan.repository.url, { root, run: true, limit: 1, client: fixture.client, complete: fixture.complete, now: () => fixture.plan.collected_at });
  const store = replayStore(result.id, { root }); const { index } = await store.read();
  await unlink(join(store.directory, 'latest.json')); await store.recoverLatest(); assert.ok(await readFile(join(store.directory, 'latest.json')));
  await assert.rejects(() => store.initialize({ ...index.plan, merges: [...index.plan.merges].reverse() }, { refresh: true }), /prefix/);
  await writeFile(join(store.directory, 'states', index.entries[0].file), '{}');
  await assert.rejects(() => runReplay(fixture.plan.repository.url, { root, client: fixture.client }), /schema/);
  assert.equal(JSON.parse(await readFile(join(store.directory, 'index.json'), 'utf8')).entries.length, 1);
}));

test('web integration loads partial/full datasets, selected inclusive history, server-owned State and shared report JSON', async () => temporary(async root => {
  const fixture = sample(); await runReplay(fixture.plan.repository.url, { root, run: true, limit: 3, client: fixture.client, complete: fixture.complete, now: () => fixture.plan.collected_at });
  const dataset = await loadDataset(fixture.plan.repository.full_name, { root }); assert.equal(dataset.snapshots.length, 3);
  const state = dataset.snapshots.at(-1).state;
  const handler = localReportHandler('generate', { root, production: false, complete: async messages => {
    const payload = JSON.parse(messages[1].content);
    assert.equal(payload.state.project_name, fixture.plan.project_name);
    assert.deepEqual(payload.merge_history.merges.map(merge => merge.pr_number), [3, 12]);
    return JSON.stringify({ pages: [{ title: '近期成果', bullets: ['工作執行實作已更新。'], script: '說明這個區間的實作變更。', source_ids: ['merge-pr-3', 'merge-pr-12'] }] });
  } });
  const response = await handler(request({ state: { ...state, project_name: 'CLIENT-TAMPERED' }, replayId: dataset.replayId, focus: '說明近期成果', mergeRange: { startCommit: fixture.plan.merges[1].commit, endCommit: state.source_commit_sha } }));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); assert.equal((await response.json()).mergeRange.count, 2);
  const imported = await historyImportHandler({ root, production: false })(request({ url: fixture.plan.repository.url })); assert.equal(imported.status, 200);
  const failed = await historyImportHandler({ root, production: false })(request({ url: 'https://github.com/another/repo' })); assert.equal(failed.status, 422);
  assert.equal((await historyImportHandler({ root, production: true })(request({ url: fixture.plan.repository.url }))).status, 403);
}));
