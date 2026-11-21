import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadMergeHistory } from './merge-history.js';
import { historicalStateUrls } from './historical-state-urls.js';
import { reportHandler } from './http.js';
import { RepositorySelectionError } from './errors.js';

const inventory = JSON.parse(await readFile(new URL('../test-data/p-limit/inventory.json', import.meta.url)));
const state = JSON.parse(await readFile(new URL('../test-data/p-limit/states/021-pr-109.json', import.meta.url)));
const range = (start, end) => ({ startCommit: inventory.entries[start].source_commit_sha, endCommit: inventory.entries[end].source_commit_sha });
const request = body => new Request('http://localhost:3000/api/reports/generate', { method: 'POST', body: JSON.stringify(body) });

test('inclusive merge ranges preserve merge order, exact sources and end-State without mutation', async () => {
  assert.deepEqual(Object.keys(historicalStateUrls).sort(), inventory.entries.map(entry => entry.file).sort());
  const original = structuredClone(state);
  const history = await loadMergeHistory(state, range(0, 20));
  assert.equal(history.merges.length, 21);
  assert.equal(history.merges[14].pr_number, 83);
  assert.equal(history.merges[15].pr_number, 79);
  assert.equal(history.merges.at(-1).commit, state.source_commit_sha);
  const selected = await loadMergeHistory(state, range(19, 20));
  assert.deepEqual(selected.merges.map(merge => merge.pr_number), [108, 109]);
  assert.equal((await loadMergeHistory(state, range(20, 20))).merges.length, 1);
  assert.deepEqual(state, original);
  for (const invalid of [range(20, 19), { ...range(0, 20), startCommit: 'a'.repeat(40) }, { ...range(0, 20), endCommit: '../bad' }]) await assert.rejects(loadMergeHistory(state, invalid));
});

test('generation and revision receive only selected verified merge records and can cite them', async () => {
  const selected = range(19, 20);
  const generated = await reportHandler('generate', { production: false, complete: async messages => {
    const input = JSON.parse(messages[1].content);
    assert.deepEqual(input.state, state);
    assert.deepEqual(input.merge_history.merges.map(merge => merge.pr_number), [108, 109]);
    assert.ok(!messages[0].content.includes('explicitly say period-wide changes are unavailable'));
    return JSON.stringify({ pages: ['Project Overview', 'Feature Progress', 'Recent Changes', 'Risks and Issues'].map(title => ({ title, bullets: ['Selected range'], script: 'Describe the selected merges.', source_ids: ['merge-pr-108', 'merge-pr-109'] })) });
  } })(request({ state, mergeRange: selected }));
  assert.equal(generated.status, 200);
  const output = await generated.json();
  assert.equal(output.mergeRange.count, 2);
  assert.match(output.report, /p-limit\/pull\/108/);
  const revised = await reportHandler('revise', { production: false, complete: async messages => {
    const input = JSON.parse(messages[1].content);
    assert.equal(input.merge_history.merges.length, 2);
    return JSON.stringify({ changes: [{ old: 'Recent changes placeholder', new: 'PR #108 fixes detached map calls.\n\n- [PR #108](https://github.com/sindresorhus/p-limit/pull/108)' }], message: 'Added selected merge.' });
  } })(request({ state, mergeRange: selected, report: 'Recent changes placeholder\nOther manual content', request: 'Recent Changes 包含每次 merge', history: [] }));
  assert.equal(revised.status, 200);
  assert.match((await revised.json()).report, /Other manual content$/);
});

test('rejects invalid ranges and client-injected history before calling the model', async () => {
  const handler = reportHandler('generate', { production: false, complete: async () => { throw new Error('Must not call'); } });
  const response = await handler(request({ state, mergeRange: range(20, 19) }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'MERGE_RANGE_INVALID');
  assert.equal((await handler(request({ state, merge_history: {} }))).status, 400);
});

test('reports planner and exact-replacement failures separately without leaking raw model output', async () => {
  const planner = await reportHandler('revise', { production: false, retrieveContext: async () => { throw new RepositorySelectionError('private-details'); }, complete: async () => '{}' })(request({ state, useRepository: true, report: 'Original', request: 'Reword', history: [] }));
  assert.equal((await planner.json()).code, 'REPOSITORY_SELECTION_INVALID');
  let calls = 0;
  const failed = await reportHandler('revise', { production: false, complete: async () => { calls++; return JSON.stringify({ changes: [{ old: 'Absent', new: 'Bad' }], message: 'private-details' }); } })(request({ state, report: 'Original', request: 'Reword', history: [] }));
  const result = await failed.json();
  assert.equal(result.code, 'REVISION_MATCH_FAILED');
  assert.equal(calls, 2);
  assert.ok(!result.error.includes('private-details'));
});
