import { readFile } from 'node:fs/promises';
import { MergeHistoryError, mergeHistorySources } from '../../../report-agent/merge-history.js';
import { historicalStateUrls } from './historical-state-urls.js';
const repository = 'sindresorhus/p-limit';
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

export async function loadMergeHistory(state, range) {
  if (!range || !sha(range.startCommit) || !sha(range.endCommit) || range.endCommit !== state.source_commit_sha || state.repository.full_name !== repository || state.repository.url !== `https://github.com/${repository}`) throw new MergeHistoryError('Invalid merge range');
  const inventory = JSON.parse(await readFile(new URL('../inventory.json', import.meta.url), 'utf8'));
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

