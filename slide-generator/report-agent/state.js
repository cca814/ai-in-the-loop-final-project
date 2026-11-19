// Check relationships that JSON Schema cannot express. Schema validation belongs
// at the Project State ingestion boundary; this module requires a valid snapshot.
export function prepareState(state) {
  if (!state || typeof state !== 'object' || !state.repository ||
      !Array.isArray(state.source_refs) || !Array.isArray(state.features) ||
      !Array.isArray(state.milestones) || !Array.isArray(state.risks) ||
      !Array.isArray(state.data_gaps) || !state.trigger) {
    throw new Error('Expected a Project State snapshot with required sections');
  }
  const sources = new Map();
  for (const ref of state.source_refs) {
    if (sources.has(ref.id)) throw new Error(`Duplicate source: ${ref.id}`);
    let url;
    try { url = new URL(ref.url); } catch { throw new Error(`Invalid source URL: ${ref.id}`); }
    if (url.protocol !== 'https:') throw new Error(`Source must use HTTPS: ${ref.id}`);
    sources.set(ref.id, ref);
  }
  const resolve = (id) => {
    const ref = sources.get(id);
    if (!ref) throw new Error(`Unknown source: ${id}`);
    return ref;
  };
  for (const item of [...state.features, ...state.milestones, ...state.risks]) {
    if (!Array.isArray(item.source_ref_ids) || item.source_ref_ids.length === 0) throw new Error(`Missing sources: ${item.id}`);
    const refs = item.source_ref_ids.map(resolve);
    if (item.status === 'done' && !refs.some(ref => ref.type === 'pull_request')) {
      throw new Error(`Done item lacks a merged PR source: ${item.id}`);
    }
  }
  if (resolve(state.trigger.source_ref_id).type !== 'pull_request') throw new Error('Trigger must reference a merged PR');
  const featureIds = new Set(state.features.map(feature => feature.id));
  for (const id of state.trigger.feature_ids ?? []) if (!featureIds.has(id)) throw new Error(`Unknown trigger feature: ${id}`);
  const milestoneIds = new Set(state.milestones.map(milestone => milestone.id));
  for (const feature of state.features) if (feature.milestone_id && !milestoneIds.has(feature.milestone_id)) throw new Error(`Unknown milestone: ${feature.milestone_id}`);
  return structuredClone(state);
}
