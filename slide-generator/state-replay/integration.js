import { replayStore, repositoryId } from './store.js';
import { parseRepositoryUrl, publicRepositoryClient } from '../report-agent/public-repository.js';
import { reportHandler } from '../report-agent/http.js';
import { readRequestJson } from '../report-agent/operation.js';
import { retrieveRepositoryContext } from '../report-agent/repository-context.js';
import { MergeHistoryError, mergeHistorySources } from '../report-agent/merge-history.js';
import { mockStore } from '../mock-firebase/store.js';

export async function loadDataset(repository, { root } = {}) {
  const id = repositoryId(repository);
  const { index, states } = await replayStore(id, { root }).read();
  if (!states.length) throw new Error('No validated States yet');
  return { id, replayId: id, label: `${index.repository.full_name} · 已重建 ${states.length}/${index.plan.merges.length} 版${index.complete ? '' : '（尚未完成）'}`, supportsRepository: true, supportsHistory: true,
    snapshots: states.map((state, position) => ({ id: state.event_id, label: `${String(position + 1).padStart(2, '0')} · PR #${index.entries[position].pr_number} · ${index.entries[position].merged_at.slice(0, 10)}`, state })),
    replay: { complete: index.complete, completed: states.length, total: index.plan.merges.length, branches: index.branches, headCommit: index.plan.head_commit, excludedBases: index.plan.excluded_bases },
  };
}

export function localReportHandler(mode, { root, mockStorage = mockStore(), publicClient = publicRepositoryClient, ...options } = {}) {
  return reportHandler(mode, {
    resolveState: async body => {
      if (body.mockDatasetId !== undefined) {
        if (body.replayId !== undefined) throw new MergeHistoryError('Ambiguous storage identity');
        const state = await mockStorage.getState(body.mockDatasetId, body.state.event_id);
        if (state.source_commit_sha !== body.state.source_commit_sha) throw new MergeHistoryError('Invalid stored State commit');
        return state;
      }
      if (body.replayId === undefined) return body.state;
      if (body.replayId !== repositoryId(body.state.repository.full_name) || body.state.evidence_kind) throw new MergeHistoryError('Invalid replay identity');
      const { states } = await replayStore(body.replayId, { root }).read();
      const state = states.find(item => item.event_id === body.state.event_id && item.source_commit_sha === body.state.source_commit_sha);
      if (!state) throw new MergeHistoryError('Unknown accepted State');
      return state;
    },
    loadHistory: async (state, range, body) => {
      try {
        if (body?.mockDatasetId !== undefined) return await mockStorage.getHistory(body.mockDatasetId, state.event_id, range);
        const { index, states } = await replayStore(repositoryId(state.repository.full_name), { root }).read();
        const start = states.findIndex(item => item.source_commit_sha === range.startCommit);
        const end = states.findIndex(item => item.source_commit_sha === range.endCommit);
        if (start < 0 || end < start || end - start >= 100 || states[end].event_id !== state.event_id) throw new MergeHistoryError('Invalid inclusive range (maximum 100 merges)');
        const history = { repository: state.repository.full_name, start_commit: range.startCommit, end_commit: range.endCommit,
          merges: states.slice(start, end + 1).map((snapshot, offset) => {
            const entry = index.entries[start + offset];
            return { source_id: `merge-pr-${entry.pr_number}`, pr_number: entry.pr_number, commit: entry.commit, merged_at: entry.merged_at, summary: snapshot.trigger.summary, url: `${state.repository.url}/pull/${entry.pr_number}` };
          }),
        };
        mergeHistorySources(history, state); return history;
      } catch (error) { throw error instanceof MergeHistoryError ? error : new MergeHistoryError('Unable to read validated history'); }
    },
    retrieveContext: (args, dependencies) => retrieveRepositoryContext(args, { ...dependencies, loadSnapshot: state => publicClient().loadSnapshot(state) }),
    publicClient,
    ...options,
  });
}

export function historyImportHandler({ root, production = process.env.NODE_ENV === 'production' } = {}) {
  return async request => {
    if (production) return Response.json({ error: '歷史重建資料目前僅供本機使用。' }, { status: 403 });
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return Response.json({ error: 'Origin rejected.' }, { status: 403 });
    try {
      const body = await readRequestJson(request, 4096);
      if (typeof body.url !== 'string' || body.url.length > 300) throw new Error('Invalid URL');
      const repository = parseRepositoryUrl(body.url);
      return Response.json({ dataset: await loadDataset(repository, { root }) }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return Response.json({ code: 'REPLAY_UNAVAILABLE', error: '尚無可讀取的歷史 State，或資料驗證失敗。請先執行 state-replay 工具；已完成的部分版本也可載入。原稿已保留。' }, { status: 422 });
    }
  };
}
