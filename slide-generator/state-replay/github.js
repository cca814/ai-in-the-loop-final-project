import { publicRepositoryClient } from '../report-agent/public-repository.js';

const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export async function collectMerges(url, { client = publicRepositoryClient(), baseBranches = [], now = () => new Date().toISOString(), maxPages = 100 } = {}) {
  const repo = await client.identity(url);
  const head = await client.resolve(url);
  const branches = [...new Set([repo.default_branch, ...baseBranches])].sort();
  if (branches.some(branch => typeof branch !== 'string' || branch.length > 200 || !branch)) throw new Error('Invalid base branch');
  const collectedAt = now();
  const merged = new Map(), excludedBases = new Set();
  let complete = false;
  for (let page = 1; page <= maxPages; page++) {
    const rows = await client.get(`${repo.full_name}/pulls?state=closed&sort=created&direction=asc&per_page=100&page=${page}`, 8_000_000);
    if (!Array.isArray(rows)) throw new Error('Invalid GitHub PR inventory');
    for (const row of rows) {
      if (!row.merged_at) continue;
      if (!branches.includes(row.base?.ref)) { excludedBases.add(row.base?.ref || 'unknown'); continue; }
      if (!Number.isInteger(row.number) || row.number < 1 || !sha(row.merge_commit_sha) || !Number.isFinite(Date.parse(row.merged_at))) throw new Error('Incomplete merge metadata');
      if (Date.parse(row.merged_at) > Date.parse(collectedAt)) continue;
      const merge = { pr_number: row.number, commit: row.merge_commit_sha, merged_at: row.merged_at, base_ref: row.base.ref };
      if (merged.has(row.number) && JSON.stringify(merged.get(row.number)) !== JSON.stringify(merge)) throw new Error('PR changed during inventory collection; retry collection');
      merged.set(row.number, merge);
    }
    if (rows.length < 100) { complete = true; break; }
  }
  if (!complete) throw new Error('PR pagination limit reached; refusing to present a partial inventory as complete');
  const merges = [...merged.values()].sort((a, b) => Date.parse(a.merged_at) - Date.parse(b.merged_at) || a.pr_number - b.pr_number);
  if (new Set(merges.map(merge => merge.commit)).size !== merges.length) throw new Error('Multiple PRs resolve to the same merge commit; manual inspection required');
  return { repository: { full_name: repo.full_name, url: head.repository.url }, project_name: repo.name || repo.full_name, head_commit: head.source_commit_sha, branches, excluded_bases: [...excludedBases].sort(), collected_at: collectedAt, merges };
}

export async function loadMergeInput(plan, merge, client, { signal } = {}) {
  signal?.throwIfAborted();
  const comparison = await client.get(`${plan.repository.full_name}/compare/${merge.commit}...${plan.head_commit}?per_page=1`);
  signal?.throwIfAborted();
  if (!['ahead', 'identical'].includes(comparison.status) || comparison.merge_base_commit?.sha !== merge.commit) throw new Error('Merge is not an ancestor of the collected default-branch head');
  const files = [];
  let commit;
  for (let page = 1; page <= 30; page++) {
    signal?.throwIfAborted();
    const result = await client.get(`${plan.repository.full_name}/commits/${merge.commit}?per_page=100&page=${page}`, 8_000_000);
    signal?.throwIfAborted();
    if (result.sha !== merge.commit || !Array.isArray(result.files) || !Array.isArray(result.parents)) throw new Error('Invalid immutable merge commit');
    commit ??= result;
    files.push(...result.files);
    if (result.files.length < 100) break;
    if (page === 30) throw new Error('Merge file pagination limit reached');
  }
  const changed = new Set();
  const changes = files.map(file => {
    if (typeof file.filename !== 'string' || changed.has(file.filename)) throw new Error('Invalid or duplicated changed-file list');
    changed.add(file.filename);
    return { path: file.filename, previous_path: file.previous_filename, status: file.status, patch: typeof file.patch === 'string' ? file.patch.slice(0, 16_000) : null, patch_truncated: typeof file.patch !== 'string' || file.patch.length > 16_000 };
  });
  const input = { merge, commit: { sha: commit.sha, parents: commit.parents.map(parent => parent.sha), message: String(commit.commit?.message || '').slice(0, 4000) }, changes, limitations: ['PR bodies, issues, milestones, CI results and releases were not reconstructed.', 'Patches may be absent or truncated; a patch is not the whole current repository.'] };
  if (JSON.stringify(input).length > 110_000) throw new Error('Merge evidence exceeds analysis budget; use a scoped analysis extension rather than silently truncating files');
  return input;
}
