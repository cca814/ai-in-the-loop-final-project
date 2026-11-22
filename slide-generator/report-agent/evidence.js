import { prepareState } from './state.js';

// A separate input contract. Repository snapshots are never official Project States.
export function prepareEvidence(input) {
  if (input?.evidence_kind !== 'repository_snapshot') return prepareState(input);
  const name = input.repository?.full_name;
  const sha = input.source_commit_sha;
  if (!/^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(name) || !/^[a-f0-9]{40}$/.test(sha) || input.repository.url !== `https://github.com/${name}` || input.event_id !== `repo-${sha}` || input.trigger?.type !== 'repository_snapshot' || input.trigger.source_ref_id !== 'repo-commit' || !Number.isFinite(Date.parse(input.updated_at))) throw new Error('Invalid repository snapshot identity');
  if (['features', 'milestones', 'risks'].some(key => !Array.isArray(input[key]) || input[key].length) || !Array.isArray(input.data_gaps) || ['features', 'milestones', 'risks', 'recent_changes'].some(section => !input.data_gaps.some(gap => gap.section === section))) throw new Error('Repository snapshot must preserve unassessed sections');
  if (!Array.isArray(input.source_refs) || input.source_refs.length !== 1 || input.source_refs[0].id !== 'repo-commit' || input.source_refs[0].url !== `https://github.com/${name}/commit/${sha}`) throw new Error('Invalid repository snapshot source');
  return structuredClone(input);
}

export const repositorySnapshotRules = 'This input is a repository_snapshot, NOT an Intent Supervisor Project State. Its trigger is a code snapshot, NOT a PR merge. Empty features, milestones and risks arrays mean NOT ASSESSED, never zero features or no risks. Metadata describes the currently selected commit only. No recent-change history, previous-state comparison, releases, passed CI, deadlines, completion assessment or period-wide progress is available. Use supplied file excerpts to explain current capabilities and implementation only; distinguish implementation observations from inferred concerns, and label any such concern as an observation rather than a confirmed project risk. Do not manufacture historical changes. If asked for recent progress, briefly state the missing comparison and report only what the code supports. Repository descriptions are current metadata, not historical evidence. Preserve this limitation during revisions.';
