import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { validateState } from './validation.js';

const projectRoot = [process.cwd(), resolve(process.cwd(), '..'), resolve(process.cwd(), 'slide-generator')].find(path => existsSync(join(path, 'schemas/project_state.schema.json')));
export const defaultRoot = process.env.STATE_REPLAY_DIR
  ? resolve(/* turbopackIgnore: true */ process.env.STATE_REPLAY_DIR)
  : projectRoot
    ? join(/* turbopackIgnore: true */ projectRoot, 'state-replay/.local-data')
    : resolve(/* turbopackIgnore: true */ process.cwd(), 'state-replay/.local-data');
export const repositoryId = repository => `repo-${createHash('sha256').update(repository.toLowerCase()).digest('hex').slice(0, 24)}`;
const digest = value => createHash('sha256').update(value).digest('hex');
// Defer runtime file IO to Node, so bundlers cannot turn the local data directory
// into source assets. This directory is mounted/created by the operator.
async function readRuntimeFile(path) {
  const fs = await import(/* turbopackIgnore: true */ 'node:fs/promises');
  return fs.readFile(path, 'utf8');
}
async function json(path) { return JSON.parse(await readRuntimeFile(path)); }
async function atomic(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); await rename(temp, path); }
  finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
export function replayStore(id, { root = defaultRoot } = {}) {
  if (!/^repo-[a-f0-9]{24}$/.test(id)) throw new Error('Invalid replay identifier');
  const directory = join(/* turbopackIgnore: true */ root, id);
  async function read() {
    let index;
    try { index = await json(join(directory, 'index.json')); }
    catch (error) { if (error.code === 'ENOENT') error.code = 'REPLAY_NOT_FOUND'; throw error; }
    if (index.version !== 1 || repositoryId(index.repository?.full_name || '') !== id || !Array.isArray(index.entries) || index.entries.length > 10_000 || !Array.isArray(index.plan?.merges)) throw new Error('Invalid replay index');
    const states = [];
    for (const [position, entry] of index.entries.entries()) {
      if (entry.file !== `${String(position + 1).padStart(5, '0')}-${entry.commit}.json`) throw new Error('Invalid replay state path');
      const text = await readRuntimeFile(join(directory, 'states', entry.file));
      const state = validateState(JSON.parse(text));
      if (digest(text) !== entry.hash || state.repository.full_name !== index.repository.full_name || state.project_id !== id || state.event_id !== entry.event_id || state.source_commit_sha !== entry.commit || state.base_state_id !== (states.at(-1)?.event_id || null) || index.plan.merges[position]?.commit !== entry.commit || state.trigger.source_ref_id !== `pr-${entry.pr_number}`) throw new Error('Replay chain or integrity mismatch');
      states.push(state);
    }
    return { index, states };
  }
  return { id, directory, read,
    async lock() {
      await mkdir(join(directory, 'states'), { recursive: true });
      const path = join(directory, 'run.lock');
      await writeFile(path, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }), { flag: 'wx' });
      return () => unlink(path);
    },
    async unlockStale() {
      const path = join(directory, 'run.lock'); const lock = await json(path);
      if (!Number.isInteger(lock.pid) || lock.pid < 1) throw new Error('Invalid lock');
      try { process.kill(lock.pid, 0); } catch (error) { if (error.code === 'ESRCH') { await unlink(path); return; } throw error; }
      throw new Error('Replay process is still running; refusing to remove lock');
    },
    async initialize(plan, { refresh = false } = {}) {
      let old;
      try { old = await read(); } catch (error) { if (error.code !== 'REPLAY_NOT_FOUND') throw error; }
      if (old && !refresh) return old;
      if (old && JSON.stringify(old.index.branches) !== JSON.stringify(plan.branches)) throw new Error('Branch scope changed; use a separate output root');
      if (old?.index.entries.some((entry, position) => { const merge = plan.merges[position]; return !merge || merge.commit !== entry.commit || merge.pr_number !== entry.pr_number || merge.merged_at !== entry.merged_at; })) throw new Error('Previously accepted merge prefix changed; refusing to rewrite history');
      const index = { version: 1, repository: plan.repository, branches: plan.branches, plan, entries: old?.index.entries || [], complete: (old?.index.entries.length || 0) === plan.merges.length };
      await mkdir(join(directory, 'states'), { recursive: true }); await atomic(join(directory, 'index.json'), index);
      return { index, states: old?.states || [] };
    },
    async save(state, merge, audit) {
      const { index, states } = await read(); validateState(state);
      const expected = index.plan.merges[index.entries.length];
      if (!expected || expected.commit !== merge.commit || state.source_commit_sha !== merge.commit || state.base_state_id !== (states.at(-1)?.event_id || null) || state.project_id !== id || state.repository.full_name !== index.repository.full_name) throw new Error('State does not extend replay');
      const file = `${String(index.entries.length + 1).padStart(5, '0')}-${merge.commit}.json`;
      const text = JSON.stringify(state, null, 2) + '\n';
      // An orphaned version from a crashed pre-checkpoint write is reusable only byte-for-byte.
      try { await writeFile(join(directory, 'states', file), text, { flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; const orphan = await json(join(directory, 'states', file)); if (orphan.event_id !== state.event_id) throw new Error('Conflicting orphan version; inspect output directory'); await atomic(join(directory, 'states', file), state); }
      await mkdir(join(directory, 'audit'), { recursive: true }); await atomic(join(directory, 'audit', file), audit);
      index.entries.push({ ...merge, file, hash: digest(text), event_id: state.event_id }); index.complete = index.entries.length === index.plan.merges.length;
      await atomic(join(directory, 'index.json'), index); // authoritative checkpoint
      await atomic(join(directory, 'latest.json'), state); // recoverable convenience copy
      return index;
    },
    async recoverLatest() { const result = await read(); if (result.states.length) await atomic(join(directory, 'latest.json'), result.states.at(-1)); return result; },
  };
}
