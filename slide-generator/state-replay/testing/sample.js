// Tiny synthetic repository for offline tests; never imported by application code.
import { createHash } from 'node:crypto';
import { buildState } from '../agent.js';
import { repositoryId } from '../store.js';
import { publicRepositoryClient } from '../../report-agent/public-repository.js';

export function sample(count = 3, repository = 'example/task-library') {
  const commitAt = index => createHash('sha1').update(`synthetic-commit-${index}`).digest('hex');
  const treeAt = index => (index + 10).toString(16).padStart(40, '0');
  const plan = { repository: { full_name: repository, url: `https://github.com/${repository}` }, project_name: 'Task library', project_id: repositoryId(repository), head_commit: commitAt(count - 1), branches: ['main'], excluded_bases: [], collected_at: '2026-11-22T00:00:00Z', merges: Array.from({ length: count }, (_, index) => ({ pr_number: [7, 3, 12][index] || index + 20, commit: commitAt(index), merged_at: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`, base_ref: 'main' })) };
  const contents = plan.merges.map((_, index) => `export const version = ${index + 1};\nexport function runTask(task) { return task(); }\n`);
  const blobAt = index => createHash('sha1').update(`blob ${Buffer.byteLength(contents[index])}\0${contents[index]}`).digest('hex');
  const snapshots = plan.merges.map((merge, index) => ({ repository, commit: { sha: merge.commit }, files: { 'index.js': { content: contents[index], sha: blobAt(index), size: Buffer.byteLength(contents[index]) } } }));
  const inputs = plan.merges.map((merge, index) => ({ merge, commit: { sha: merge.commit, parents: index ? [commitAt(index - 1)] : [], message: `Implement task runner step ${index + 1}` }, changes: [{ path: 'index.js', status: 'modified', patch: '+runTask', patch_truncated: false }] }));
  const contexts = plan.merges.map((merge, index) => ({ repository, commit: merge.commit, reason: 'Read implementation', files: [{ source_id: 'repo-file-1', path: 'index.js', start_line: 1, end_line: 3, content: contents[index], url: `https://github.com/${repository}/blob/${merge.commit}/index.js#L1-L3` }] }));
  const draftAt = index => ({ features: [{ id: 'feature-task-runner', name: '工作執行', status: 'done', summary: '可呼叫指定的工作函式。', source_ref_ids: [`pr-${plan.merges[index].pr_number}`, `doc-${commitAt(index).slice(0, 12)}-1`] }], milestones: [], risks: [], summary: `更新工作執行實作，步驟 ${index + 1}。`, feature_ids: ['feature-task-runner'] });
  const states = [];
  for (let index = 0; index < count; index++) states.push(buildState(states.at(-1) || null, plan, plan.merges[index], inputs[index], contexts[index], draftAt(index), { collectedAt: plan.collected_at, model: 'mock-model' }));
  const calls = [];
  const fetchImpl = async (url, options) => {
    if (options?.method !== 'GET' || !url.startsWith(`https://api.github.com/repos/${repository}`)) throw new Error('Unexpected network access');
    calls.push(url);
    const path = url.replace(`https://api.github.com/repos/${repository}`, '');
    if (!path) return Response.json({ private: false, full_name: repository, name: 'Task library', default_branch: 'main' });
    if (path === '/commits/main') return Response.json({ sha: plan.head_commit, commit: { committer: { date: plan.collected_at } } });
    if (path.startsWith('/pulls?')) return Response.json([...plan.merges].reverse().map(merge => ({ number: merge.pr_number, merged_at: merge.merged_at, merge_commit_sha: merge.commit, base: { ref: 'main' } })).concat({ number: 99, merged_at: null, base: { ref: 'main' } }));
    for (const [index, merge] of plan.merges.entries()) {
      if (path.startsWith(`/compare/${merge.commit}...`)) return Response.json({ status: merge.commit === plan.head_commit ? 'identical' : 'ahead', merge_base_commit: { sha: merge.commit } });
      if (path === `/commits/${merge.commit}` || path === `/commits/${merge.commit}?per_page=100&page=1`) return Response.json({ sha: merge.commit, parents: inputs[index].commit.parents.map(sha => ({ sha })), commit: { message: inputs[index].commit.message, committer: { date: merge.merged_at }, tree: { sha: treeAt(index) } }, files: [{ filename: 'index.js', status: 'modified', patch: '+runTask' }] });
      if (path === `/git/trees/${treeAt(index)}?recursive=1`) return Response.json({ sha: treeAt(index), truncated: false, tree: [{ type: 'blob', mode: '100644', path: 'index.js', sha: blobAt(index), size: Buffer.byteLength(contents[index]) }] });
      if (path === `/git/blobs/${blobAt(index)}`) return Response.json({ sha: blobAt(index), encoding: 'base64', content: Buffer.from(contents[index]).toString('base64') });
    }
    throw new Error(`Unexpected mock URL: ${path}`);
  };
  const client = publicRepositoryClient({ fetchImpl });
  const complete = async messages => {
    const payload = JSON.parse(messages[1].content);
    if (payload.available_files) return JSON.stringify({ files: [{ path: 'index.js', start_line: 1, end_line: 50 }], reason: 'Read implementation' });
    const index = plan.merges.findIndex(merge => merge.commit === payload.merge_evidence?.merge.commit);
    if (index < 0) throw new Error('Unexpected model task');
    return JSON.stringify(draftAt(index));
  };
  return { plan, states, snapshots, contexts, inputs, draftAt, complete, client, calls, fetchImpl };
}
