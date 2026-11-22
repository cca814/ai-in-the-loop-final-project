import { MergeHistoryError, mergeHistorySources } from '../report-agent/merge-history.js';

export function validateMergeMetadata(snapshots, metadata) {
  if (!Array.isArray(metadata) || metadata.length !== snapshots.length || !metadata.length || metadata.length > 100) throw new MergeHistoryError('Incomplete merge metadata');
  const repository = snapshots[0].state.repository.full_name;
  const normalized = metadata.map((entry, index) => {
    const state = snapshots[index].state;
    const source = state.source_refs.find(item => item.id === state.trigger.source_ref_id);
    if (!entry || state.evidence_kind || state.repository.full_name !== repository || state.project_id !== snapshots[0].state.project_id || (index && state.base_state_id !== snapshots[index - 1].state.event_id) || entry.commit !== state.source_commit_sha || entry.pr_number !== source?.number || source?.type !== 'pull_request' || typeof entry.merged_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(entry.merged_at) || !Number.isFinite(Date.parse(entry.merged_at))) throw new MergeHistoryError('Merge metadata does not match State chain');
    return { commit: entry.commit, pr_number: entry.pr_number, merged_at: entry.merged_at };
  });
  buildHistory({ snapshots, mergeMetadata: normalized }, 0, snapshots.length - 1);
  return normalized;
}

function buildHistory(dataset, start, end) {
  const snapshots = dataset.snapshots.slice(start, end + 1);
  const state = snapshots.at(-1).state;
  const history = { repository: state.repository.full_name, start_commit: snapshots[0].state.source_commit_sha, end_commit: state.source_commit_sha,
    merges: snapshots.map((snapshot, offset) => {
      const entry = dataset.mergeMetadata[start + offset];
      return { source_id: `merge-pr-${entry.pr_number}`, pr_number: entry.pr_number, commit: entry.commit, merged_at: entry.merged_at, summary: snapshot.state.trigger.summary, url: `${snapshot.state.repository.url}/pull/${entry.pr_number}` };
    }),
  };
  mergeHistorySources(history, state);
  return history;
}

export function historyForDataset(dataset, snapshotId, range) {
  if (!dataset?.mergeMetadata || !range) throw new MergeHistoryError('No accepted merge history for this dataset');
  const start = dataset.snapshots.findIndex(item => item.state.source_commit_sha === range.startCommit);
  const end = dataset.snapshots.findIndex(item => item.state.source_commit_sha === range.endCommit);
  if (start < 0 || end < start || end - start >= 100 || dataset.snapshots[end].id !== snapshotId) throw new MergeHistoryError('Invalid inclusive range');
  return buildHistory(dataset, start, end);
}
