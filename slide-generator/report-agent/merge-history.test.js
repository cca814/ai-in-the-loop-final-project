import test from 'node:test';
import assert from 'node:assert/strict';
import { sample } from '../state-replay/testing/sample.js';
import { mergeHistorySources } from './merge-history.js';
import { generateReport } from './index.js';
import { reviseReport } from './revision.js';

const fixture = sample(); const state = fixture.states.at(-1);
const history = { repository: state.repository.full_name, start_commit: fixture.plan.merges[0].commit, end_commit: state.source_commit_sha, merges: fixture.plan.merges.map((merge, index) => ({ source_id: `merge-pr-${merge.pr_number}`, pr_number: merge.pr_number, commit: merge.commit, merged_at: merge.merged_at, summary: fixture.states[index].trigger.summary, url: `${state.repository.url}/pull/${merge.pr_number}` })) };
test('history validates exact repository/end commit, chronology, unique PR sources and inclusive endpoints', () => {
  assert.equal(mergeHistorySources(history, state).length, 3);
  for (const invalid of [{ ...history, repository: 'other/repo' }, { ...history, end_commit: 'f'.repeat(40) }, { ...history, merges: [...history.merges].reverse() }, { ...history, merges: [...history.merges, history.merges.at(-1)] }, { ...history, merges: history.merges.map(merge => ({ ...merge, url: 'https://example.com/fake' })) }]) assert.throws(() => mergeHistorySources(invalid, state));
});
test('generation can cite supplied history without claiming single trigger is a whole period', async () => {
  const original = structuredClone(state);
  const report = await generateReport(state, { mergeHistory: history, focus: '說明區間成果', complete: async messages => {
    assert.equal(JSON.parse(messages[1].content).merge_history.merges.length, 3);
    return JSON.stringify({ pages: [{ title: '成果', bullets: ['工作執行功能更新。'], script: '依據區間內三次合併說明。', source_ids: ['merge-pr-7', 'merge-pr-3', 'merge-pr-12'] }] });
  } });
  assert.ok(report.includes('/pull/3')); assert.deepEqual(state, original);
});
test('revision preserves manual content and accepts only supplied history source links', async () => {
  const result = await reviseReport({ state, report: 'Placeholder\nKeep manual text', request: 'Add selected merge', history: [] }, { mergeHistory: history, complete: async () => JSON.stringify({ changes: [{ old: 'Placeholder', new: `[PR](${history.merges[0].url})` }], message: 'Added source' }) });
  assert.ok(result.report.endsWith('Keep manual text')); assert.ok(result.report.includes(history.merges[0].url));
});
