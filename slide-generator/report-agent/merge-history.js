
export class MergeHistoryError extends Error {}
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

export function mergeHistorySources(history, state) {
  if (!history) return [];
  const repository = state.repository.full_name;
  if (history.repository !== repository || history.repository !== state.repository.full_name || history.end_commit !== state.source_commit_sha || !sha(history.start_commit) || !Array.isArray(history.merges) || !history.merges.length || history.merges.length > 100 || history.merges[0].commit !== history.start_commit || history.merges.at(-1).commit !== history.end_commit) throw new MergeHistoryError('Invalid history identity');
  const seen = new Set(state.source_refs.map(ref => ref.id));
  return history.merges.map((merge, index) => {
    if (!sha(merge.commit) || typeof merge.summary !== 'string' || !merge.summary || !Number.isInteger(merge.pr_number) || merge.pr_number < 1 || !/^merge-pr-\d+$/.test(merge.source_id) || merge.source_id !== `merge-pr-${merge.pr_number}` || seen.has(merge.source_id) || merge.url !== `https://github.com/${repository}/pull/${merge.pr_number}` || !Number.isFinite(Date.parse(merge.merged_at)) || (index && Date.parse(history.merges[index - 1].merged_at) > Date.parse(merge.merged_at))) throw new MergeHistoryError('Invalid historical merge');
    seen.add(merge.source_id);
    return { id: merge.source_id, title: `PR #${merge.pr_number} · ${merge.merged_at.slice(0, 10)}`, url: merge.url };
  });
}

export const mergeHistoryRules = 'The separate merge_history is verified historical merge evidence for the selected inclusive start/end snapshots. It is not part of Project State. Use its dated summaries and PR citations for requests about changes across this range; include each supplied merge when asked for every merge. These summaries establish recorded changes, not the undocumented reasons behind design decisions. Explain changes supported by evidence and explicitly identify missing decision rationale rather than inventing it. Never extend the scope beyond the supplied range, infer changes from only the latest trigger, or use past feature statuses to override the end snapshot. File excerpts still belong only to the end commit. If no merge_history is supplied, only the single State trigger is available and complete period-wide changes cannot be claimed.';
