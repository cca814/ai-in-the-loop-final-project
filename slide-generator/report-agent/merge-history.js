import { readFile } from 'node:fs/promises';
import { historicalStateUrls } from './historical-state-urls.js';

export class MergeHistoryError extends Error {}
const repository = 'sindresorhus/p-limit';
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

export function mergeHistorySources(history, state) {
  if (!history) return [];
  if (history.repository !== repository || history.repository !== state.repository.full_name || history.end_commit !== state.source_commit_sha || !sha(history.start_commit) || !Array.isArray(history.merges) || !history.merges.length || history.merges.length > 21 || history.merges[0].commit !== history.start_commit || history.merges.at(-1).commit !== history.end_commit) throw new MergeHistoryError('Invalid history identity');
  const seen = new Set(state.source_refs.map(ref => ref.id));
  return history.merges.map((merge, index) => {
    if (!sha(merge.commit) || typeof merge.summary !== 'string' || !merge.summary || !Number.isInteger(merge.pr_number) || merge.pr_number < 1 || !/^merge-pr-\d+$/.test(merge.source_id) || merge.source_id !== `merge-pr-${merge.pr_number}` || seen.has(merge.source_id) || merge.url !== `https://github.com/${repository}/pull/${merge.pr_number}` || !Number.isFinite(Date.parse(merge.merged_at)) || (index && history.merges[index - 1].merged_at >= merge.merged_at)) throw new MergeHistoryError('Invalid historical merge');
    seen.add(merge.source_id);
    return { id: merge.source_id, title: `PR #${merge.pr_number} · ${merge.merged_at.slice(0, 10)}`, url: merge.url };
  });
}

export async function loadMergeHistory(state, range) {
  if (!range || !sha(range.startCommit) || !sha(range.endCommit) || range.endCommit !== state.source_commit_sha || state.repository.full_name !== repository || state.repository.url !== `https://github.com/${repository}`) throw new MergeHistoryError('Invalid merge range');
  const inventory = JSON.parse(await readFile(new URL('../test-data/p-limit/inventory.json', import.meta.url), 'utf8'));
  const start = inventory.entries.findIndex(entry => entry.source_commit_sha === range.startCommit);
  const end = inventory.entries.findIndex(entry => entry.source_commit_sha === range.endCommit);
  if (start < 0 || end < start) throw new MergeHistoryError('Unknown or reversed merge range');
  const merges = [];
  let previous;
  for (const entry of inventory.entries.slice(start, end + 1)) {
    if (!Object.hasOwn(historicalStateUrls, entry.file)) throw new MergeHistoryError('Missing historical State asset');
    const snapshot = JSON.parse(await readFile(historicalStateUrls[entry.file], 'utf8'));
    const source = snapshot.source_refs.find(ref => ref.id === snapshot.trigger.source_ref_id);
    if (snapshot.source_commit_sha !== entry.source_commit_sha || snapshot.repository.full_name !== repository || snapshot.updated_at !== entry.merged_at || source?.type !== 'pull_request' || source.number !== entry.pr || (previous && snapshot.base_state_id !== previous.event_id)) throw new MergeHistoryError('Historical State mismatch');
    merges.push({ event_id: snapshot.event_id, commit: snapshot.source_commit_sha, merged_at: snapshot.updated_at, pr_number: source.number, source_id: `merge-pr-${source.number}`, url: source.url, summary: snapshot.trigger.summary });
    previous = snapshot;
  }
  const history = { repository, start_commit: range.startCommit, end_commit: range.endCommit, includes_start: true, includes_end: true, merges };
  mergeHistorySources(history, state);
  return history;
}

export const mergeHistoryRules = 'The separate merge_history is verified historical merge evidence for the selected inclusive start/end snapshots. It is not part of Project State. Use its dated summaries and PR citations for requests about changes across this range; include each supplied merge when asked for every merge. Never extend the scope beyond the supplied range, infer changes from only the latest trigger, or use past feature statuses to override the end snapshot. File excerpts still belong only to the end commit. If no merge_history is supplied, only the single State trigger is available and complete period-wide changes cannot be claimed.';
