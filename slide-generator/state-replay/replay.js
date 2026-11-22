import { publicRepositoryClient } from '../report-agent/public-repository.js';
import { retrieveRepositoryContext } from '../report-agent/repository-context.js';
import { createOperation } from '../report-agent/operation.js';
import { createClient } from '../report-agent/llm.js';
import { collectMerges, loadMergeInput } from './github.js';
import { repositoryId, replayStore } from './store.js';
import { analyzeState } from './agent.js';

export async function runReplay(url, { run = false, refresh = false, limit = 3, baseBranches = [], root, client = publicRepositoryClient(), complete, signal, model, now = () => new Date().toISOString(), onProgress = () => {} } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be 1..100 successful states per invocation');
  const repo = await client.identity(url);
  const store = replayStore(repositoryId(repo.full_name), { root });
  const release = await store.lock();
  try {
    let existing;
    try { existing = await store.read(); } catch (error) { if (error.code !== 'REPLAY_NOT_FOUND') throw error; }
    if (!existing || refresh) {
      const plan = await collectMerges(url, { client, baseBranches, now }); plan.project_id = store.id;
      existing = await store.initialize(plan, { refresh });
    }
    let { index, states } = await store.recoverLatest();
    if (baseBranches.some(branch => !index.branches.includes(branch))) throw new Error('Requested branch scope differs from stored plan; use --refresh or another output root');
    if (!run) return { id: store.id, directory: store.directory, completed: states.length, total: index.plan.merges.length, complete: index.complete, plan: index.plan };
    let processed = 0;
    while (states.length < index.plan.merges.length && processed < limit) {
      if (signal?.aborted) throw signal.reason || new Error('Cancelled');
      const previous = states.at(-1) || null;
      const merge = index.plan.merges[states.length];
      onProgress({ stage: 'reading', position: states.length + 1, total: index.plan.merges.length, pr: merge.pr_number });
      const operation = createOperation({ signal, timeoutMs: 180_000, maxCalls: 4 });
      const input = await loadMergeInput(index.plan, merge, client, { signal: operation.signal });
      const seed = { repository: index.repository, source_commit_sha: merge.commit, source_refs: previous?.source_refs || [], previous_state: previous, merge_evidence: input };
      const writer = operation.wrap(complete || createClient({ signal: operation.signal, onUsage: operation.record }));
      const context = await retrieveRepositoryContext({ state: seed, mode: 'generate', request: 'Select current docs/code to reconstruct complete Project State capabilities, stable prior features and this merge. Recheck prior done items where possible. This is state reconstruction, not a progress report.' }, { complete: writer, loadSnapshot: async state => { operation.signal.throwIfAborted(); const snapshot = await client.loadSnapshot(state); operation.signal.throwIfAborted(); return snapshot; } });
      const collectedAt = now();
      const state = await analyzeState({ previous, plan: index.plan, merge, input, context, collectedAt, model }, { complete: writer });
      index = await store.save(state, merge, { merge, input, context, collected_at: collectedAt, operation: operation.stats(), assessment: 'partial-static-reconstruction-not-intent-supervisor' });
      states = [...states, state]; processed++;
      onProgress({ stage: 'saved', position: states.length, total: index.plan.merges.length, pr: merge.pr_number, eventId: state.event_id });
    }
    return { id: store.id, directory: store.directory, completed: states.length, total: index.plan.merges.length, processed, complete: index.complete, latest: states.at(-1) || null };
  } finally { await release(); }
}
