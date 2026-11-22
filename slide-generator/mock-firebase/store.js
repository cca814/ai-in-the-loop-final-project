// A local file adapter for the application contract, NOT a Firestore emulator.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { validateState } from '../state-replay/validation.js';
import { prepareEvidence } from '../report-agent/evidence.js';
import { parseRepositoryUrl } from '../report-agent/public-repository.js';
import { validateMergeMetadata, historyForDataset } from './history.js';

const projectRoot = [process.cwd(), resolve(process.cwd(), '..'), resolve(process.cwd(), 'slide-generator')].find(path => existsSync(join(path, 'schemas/project_state.schema.json')));
const defaultRoot = process.env.MOCK_FIREBASE_DIR
  ? resolve(/* turbopackIgnore: true */ process.env.MOCK_FIREBASE_DIR)
  : join(/* turbopackIgnore: true */ projectRoot || process.cwd(), 'mock-firebase/.local-data');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class StorageError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
function check(condition, message) { if (!condition) throw new StorageError('STORAGE_INPUT_INVALID', message); }
function identity(id) { check(typeof id === 'string' && /^mock-[a-f0-9]{32}$/.test(id), 'Invalid dataset identity'); }
function snapshotFor(data, datasetId, snapshotId) {
  identity(datasetId);
  const snapshot = data.datasets[datasetId]?.snapshots.find(item => item.id === snapshotId);
  if (!snapshot) throw new StorageError('STORAGE_NOT_FOUND', '找不到指定的 Project State。', 404);
  return snapshot;
}
function validateDataset(input) {
  check(input && typeof input.label === 'string' && input.label.length > 0 && input.label.length <= 300 && Array.isArray(input.snapshots) && input.snapshots.length > 0 && input.snapshots.length <= 100, 'Invalid dataset');
  const snapshots = input.snapshots.map(item => {
    check(typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 200 && typeof item.label === 'string' && item.label.length <= 300, 'Invalid snapshot');
    if (item.state?.evidence_kind === 'repository_snapshot') prepareEvidence(item.state);
    else validateState(item.state);
    check(item.id === item.state.event_id, 'Snapshot ID must match event_id');
    return { id: item.id, label: item.label, state: item.state };
  });
  check(new Set(snapshots.map(item => item.id)).size === snapshots.length, 'Duplicate snapshot ID');
  const id = `mock-${hash(snapshots).slice(0, 32)}`;
  // Capability is derived from accepted metadata, never a client-provided flag.
  // Actual public availability is verified by the GitHub reader when requested.
  const supportsRepository = snapshots.every(({ state }) => {
    try { return state.repository.url === `https://github.com/${state.repository.full_name}` && parseRepositoryUrl(state.repository.url) === state.repository.full_name && /^[a-f0-9]{40}$/.test(state.source_commit_sha); }
    catch { return false; }
  });
  const mergeMetadata = input.mergeMetadata === undefined ? undefined : validateMergeMetadata(snapshots, input.mergeMetadata);
  return { id, mockId: id, label: input.label, snapshots, supportsRepository, supportsHistory: !!mergeMetadata, ...(mergeMetadata ? { mergeMetadata } : {}) };
}
function validateDraft(draft) {
  check(draft && typeof draft.report === 'string' && draft.report.length <= 100_000 && Array.isArray(draft.history) && draft.history.length <= 100, 'Invalid report or history');
  check(draft.history.every(turn => turn && ['user', 'assistant'].includes(turn.role) && typeof turn.content === 'string' && turn.content.length <= 8000), 'Invalid conversation');
  check(['focus', 'request'].every(key => typeof draft[key] === 'string' && draft[key].length <= 4000), 'Invalid draft settings');
  check(draft.mergeRange === undefined || (draft.mergeRange && ['startCommit', 'endCommit'].every(key => typeof draft.mergeRange[key] === 'string' && /^[a-f0-9]{40}$/.test(draft.mergeRange[key]))), 'Invalid saved range');
  return { report: draft.report, history: draft.history.map(({ role, content }) => ({ role, content })), focus: draft.focus, request: draft.request, ...(draft.mergeRange ? { mergeRange: { startCommit: draft.mergeRange.startCommit, endCommit: draft.mergeRange.endCommit } } : {}) };
}
export function mockStore({ root = defaultRoot } = {}) {
  const file = join(/* turbopackIgnore: true */ root, 'database.json');
  async function read() {
    const fs = await import(/* turbopackIgnore: true */ 'node:fs/promises');
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      if (data.version !== 1 || !data.datasets || !data.drafts) throw new Error('Invalid storage file');
      for (const [id, dataset] of Object.entries(data.datasets)) {
        const normalized = validateDataset(dataset);
        if (normalized.id !== id) throw new Error('Stored dataset identity mismatch');
        data.datasets[id] = normalized;
      }
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, datasets: {}, drafts: {} };
      throw new StorageError('STORAGE_UNAVAILABLE', 'Mock 資料檔無法讀取或驗證；不會覆蓋既有資料。', 503);
    }
  }
  async function transaction(change) {
    await mkdir(root, { recursive: true });
    let lock;
    try { lock = await open(`${file}.lock`, 'wx'); }
    catch (error) { if (error.code === 'EEXIST') throw new StorageError('STORAGE_BUSY', '另一個儲存操作正在進行，請稍後重試。', 409); throw error; }
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      const data = await read();
      const result = change(data);
      const text = JSON.stringify(data, null, 2) + '\n';
      if (Buffer.byteLength(text) > 20_000_000) throw new StorageError('STORAGE_FULL', '本機 Mock 資料已超過 20 MB。', 507);
      await writeFile(temp, text, { flag: 'wx' });
      await rename(temp, file);
      return result;
    } finally {
      try { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      finally { await lock.close(); await unlink(`${file}.lock`); }
    }
  }
  return {
    async getProjectStates(projectId) {
      check(typeof projectId === 'string' && /^[a-z0-9][a-z0-9-]{1,62}$/.test(projectId), 'Invalid project ID');
      const data = await read();
      const statesById = new Map();
      const datasets = [];
      for (const dataset of Object.values(data.datasets)) {
        const snapshots = dataset.snapshots.filter(({ state }) => !state.evidence_kind && state.project_id === projectId);
        if (!snapshots.length) continue;
        for (const { state } of snapshots) {
          const previous = statesById.get(state.event_id);
          if (previous && !isDeepStrictEqual(previous, state)) throw new StorageError('PROJECT_STATE_CONFLICT', '同一專案的 State ID 有不同內容，請先確認資料。', 409);
          statesById.set(state.event_id, state);
        }
        datasets.push({ ...dataset, snapshots, ...(snapshots.length === dataset.snapshots.length ? {} : { supportsHistory: false, mergeMetadata: undefined }) });
      }
      if (!statesById.size) throw new StorageError('PROJECT_NOT_FOUND', '找不到此 project ID 的 Project State，請確認 ID 或先匯入資料。', 404);
      // State collection times order the response; these are not PR merge times.
      const states = [...statesById.values()].sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at) || a.event_id.localeCompare(b.event_id));
      return { projectId, states, datasets };
    },
    // Internal test maintenance only; deliberately not exposed through the HTTP API.
    async removeBrowserTestDatasets(ids) {
      check(ids === undefined || (Array.isArray(ids) && ids.every(id => typeof id === 'string')), 'Invalid test dataset IDs');
      return transaction(data => {
        const removed = [];
        for (const [id, dataset] of Object.entries(data.datasets)) {
          if (ids && !ids.includes(id)) continue;
          const single = /^mock-browser-(\d{13})$/.exec(dataset.label);
          const history = /^mock-history-browser-(\d{13})$/.exec(dataset.label);
          const owned = single
            ? dataset.snapshots.length === 1 && dataset.snapshots[0].id === dataset.label
            : history && dataset.snapshots.every((item, i) => item.id === `mock-history-${history[1]}-${i}`);
          if (!owned) continue;
          delete data.datasets[id];
          for (const [key, draft] of Object.entries(data.drafts)) {
            if (draft.datasetId === id) delete data.drafts[key];
          }
          removed.push(id);
        }
        return removed;
      });
    },
    async listDatasets() { return Object.values((await read()).datasets); },
    async putDataset(input) {
      let dataset;
      try { dataset = validateDataset(input); }
      catch { throw new StorageError('STORAGE_INPUT_INVALID', 'Project State 或資料集格式不正確，請依官方 Schema 提供資料。'); }
      return transaction(data => {
        const previous = data.datasets[dataset.id];
        if (!dataset.mergeMetadata && previous?.mergeMetadata) dataset = validateDataset({ ...dataset, mergeMetadata: previous.mergeMetadata });
        data.datasets[dataset.id] = dataset; return dataset;
      });
    },
    async getState(datasetId, snapshotId) { return snapshotFor(await read(), datasetId, snapshotId).state; },
    async getHistory(datasetId, snapshotId, range) {
      const data = await read(); snapshotFor(data, datasetId, snapshotId);
      return historyForDataset(data.datasets[datasetId], snapshotId, range);
    },
    async getDraft(datasetId, snapshotId) {
      const data = await read(); snapshotFor(data, datasetId, snapshotId);
      return data.drafts[hash([datasetId, snapshotId])] || null;
    },
    async saveDraft(datasetId, snapshotId, draft, expectedRevision) {
      const value = validateDraft(draft);
      check(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, 'Invalid expected revision');
      return transaction(data => {
        const snapshot = snapshotFor(data, datasetId, snapshotId);
        if (value.mergeRange) historyForDataset(data.datasets[datasetId], snapshotId, value.mergeRange);
        const key = hash([datasetId, snapshotId]);
        const previous = data.drafts[key];
        if ((previous?.revision || 0) !== expectedRevision) throw new StorageError('STORAGE_CONFLICT', '草稿已被另一個頁面更新。目前編輯內容已保留；請先下載備份，再載入已存草稿。', 409);
        return data.drafts[key] = { ...value, datasetId, snapshotId, stateCommit: snapshot.state.source_commit_sha, revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
      });
    },
  };
}
