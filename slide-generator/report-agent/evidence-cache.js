import { createHash } from 'node:crypto';

// Development-only reuse of verified excerpts, never generated report text.
// The caller includes State, task, report, history, model and prompt version.
export function createEvidenceCache({ capacity = 20, ttlMs = 300_000, now = Date.now } = {}) {
  const entries = new Map();
  return async (identity, load) => {
    const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    const cached = entries.get(key);
    if (cached && cached.expires > now()) return { context: structuredClone(cached.context), hit: true };
    entries.delete(key);
    const context = await load();
    if (context) {
      if (entries.size >= capacity) entries.delete(entries.keys().next().value);
      entries.set(key, { context: structuredClone(context), expires: now() + ttlMs });
    }
    return { context, hit: false };
  };
}
