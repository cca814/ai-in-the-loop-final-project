// Offline test-data setup. No GitHub, Firebase or LLM calls.
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mockStore } from './store.js';
import { validateState } from '../state-replay/validation.js';

export async function importStateDirectory(directory, { store = mockStore(), label, mergeInventory } = {}) {
  const files = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => entry.name).sort();
  if (!files.length || files.length > 100) throw new Error('Expected 1–100 Project State JSON files');
  const states = await Promise.all(files.map(async file => {
    const state = JSON.parse(await readFile(join(directory, file), 'utf8'));
    validateState(state);
    return state;
  }));
  // Order by the accepted predecessor chain, not PR numbers or filesystem order.
  const ids = new Set(states.map(state => state.event_id));
  if (ids.size !== states.length) throw new Error('Duplicate State event IDs');
  const roots = states.filter(state => !ids.has(state.base_state_id));
  if (roots.length !== 1) throw new Error('Expected one contiguous State chain');
  const ordered = [roots[0]];
  while (ordered.length < states.length) {
    const previous = ordered.at(-1);
    const children = states.filter(state => state.base_state_id === previous.event_id);
    if (children.length !== 1 || ordered.includes(children[0])) throw new Error('State chain is incomplete, branched or cyclic');
    ordered.push(children[0]);
  }
  const repository = ordered[0].repository.full_name;
  if (ordered.some(state => state.repository.full_name !== repository || state.project_id !== ordered[0].project_id) || new Set(ordered.map(state => state.source_commit_sha)).size !== ordered.length) throw new Error('States must belong to one project with unique commits');
  let mergeMetadata;
  if (mergeInventory) {
    const inventory = JSON.parse(await readFile(mergeInventory, 'utf8'));
    if (inventory.repository !== repository || !Array.isArray(inventory.entries) || inventory.entries.length !== ordered.length) throw new Error('Merge inventory must match the State repository and count');
    mergeMetadata = ordered.map(state => {
      const entries = inventory.entries.filter(entry => entry.source_commit_sha === state.source_commit_sha);
      if (entries.length !== 1) throw new Error('Missing or duplicate inventory commit');
      return { commit: state.source_commit_sha, pr_number: entries[0].pr, merged_at: entries[0].merged_at };
    });
  }
  return store.putDataset({ label: label || `${repository} · PR 組資料串接模擬（${ordered.length} 版）`, ...(mergeMetadata ? { mergeMetadata } : {}), snapshots: ordered.map((state, index) => {
    const trigger = state.source_refs.find(source => source.id === state.trigger.source_ref_id);
    const pr = trigger?.type === 'pull_request' && trigger.number ? `PR #${trigger.number} · ` : '';
    return { id: state.event_id, label: `${String(index + 1).padStart(2, '0')} · ${pr}${state.updated_at.slice(0, 10)}`, state };
  }) });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    const directory = args.shift();
    const label = args[0] && !args[0].startsWith('--') ? args.shift() : undefined;
    let mergeInventory;
    if (args[0] === '--merges' && args[1]) { args.shift(); mergeInventory = resolve(args.shift()); }
    if (!directory || args.length) throw new Error('Usage: node mock-firebase/import-states.mjs <State JSON directory> [dataset label] [--merges inventory.json]');
    const dataset = await importStateDirectory(resolve(directory), { label, mergeInventory });
    console.log(`Imported ${dataset.snapshots.length} States into local Mock storage: ${dataset.label}`);
    console.log('Open /reports, click 載入 Mock 資料, then select this project. Existing drafts are preserved.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
