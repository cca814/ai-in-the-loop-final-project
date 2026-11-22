import { readFile } from 'node:fs/promises';
import { readRequestJson } from '../report-agent/operation.js';
import { mockStore, StorageError } from './store.js';

export function storageHandler({ store = mockStore(), production = process.env.NODE_ENV === 'production' } = {}) {
  return async request => {
    const url = new URL(request.url);
    if (production || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return Response.json({ error: 'Mock 儲存僅供本機開發使用。' }, { status: 403 });
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return Response.json({ error: 'Origin rejected.' }, { status: 403 });
    const respond = value => Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
    let parsing = false;
    try {
      if (request.method === 'GET') {
        if (url.searchParams.has('projectId')) return respond({ mode: 'mock', ...await store.getProjectStates(url.searchParams.get('projectId')) });
        if (url.searchParams.has('datasetId')) return respond({ draft: await store.getDraft(url.searchParams.get('datasetId'), url.searchParams.get('snapshotId')) });
        return respond({ mode: 'mock', datasets: await store.listDatasets() });
      }
      parsing = true;
      const body = await readRequestJson(request, 2_000_000);
      parsing = false;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new StorageError('STORAGE_INPUT_INVALID', '請提供 JSON 物件。');
      if (body.action === 'seed') {
        const fixtures = [
          ['一般進度', new URL('../schemas/examples/normal.json', import.meta.url)],
          ['缺少風險評估', new URL('../schemas/examples/missing_risks.json', import.meta.url)],
          ['功能完成', new URL('../schemas/examples/feature_done.json', import.meta.url)],
        ];
        const snapshots = await Promise.all(fixtures.map(async ([label, file]) => {
          const state = JSON.parse(await readFile(file, 'utf8'));
          return { id: state.event_id, label, state };
        }));
        await store.putDataset({ label: 'Mock Firebase · Schema 範例', snapshots });
        return respond({ mode: 'mock', datasets: await store.listDatasets() });
      }
      if (body.action === 'dataset') return respond({ dataset: await store.putDataset(body.dataset) });
      if (body.action === 'save') return respond({ draft: await store.saveDraft(body.datasetId, body.snapshotId, body.draft, body.expectedRevision) });
      throw new StorageError('STORAGE_INPUT_INVALID', '未知的儲存操作。');
    } catch (error) {
      if (parsing && error instanceof SyntaxError) return Response.json({ code: 'STORAGE_INPUT_INVALID', error: 'JSON 格式不正確。' }, { status: 400 });
      return Response.json({ code: error.code === 'REQUEST_TOO_LARGE' ? error.code : error instanceof StorageError ? error.code : 'STORAGE_UNAVAILABLE', error: error instanceof StorageError ? error.message : 'Mock 資料無法讀寫，請檢查本機資料檔；目前草稿已保留。' }, { status: error.code === 'REQUEST_TOO_LARGE' ? 413 : error instanceof StorageError ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
    }
  };
}
