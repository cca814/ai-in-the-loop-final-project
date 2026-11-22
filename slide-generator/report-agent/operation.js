export class OperationError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// One deadline and call budget across planning, corrections and writing.
// Provider HTTP attempts remain separately bounded by the transport adapter.
export function createOperation({ signal, timeoutMs = 120_000, maxCalls = 4 } = {}) {
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const started = Date.now();
  let calls = 0;
  let modelInfo = {};
  const usage = { inputTokens: 0, outputTokens: 0, httpAttempts: 0 };
  const abortError = () => new OperationError(signal?.aborted ? 'OPERATION_CANCELLED' : 'OPERATION_TIMEOUT');
  return {
    signal: combined,
    record(event) {
      if (typeof event.provider === 'string' && typeof event.model === 'string') modelInfo = { provider: event.provider, model: event.model };

      for (const field of ['inputTokens', 'outputTokens', 'httpAttempts']) if (Number.isFinite(event[field]) && event[field] >= 0) usage[field] += event[field];
    },
    wrap(complete) {
      return async messages => {
        if (combined.aborted) throw abortError();
        if (++calls > maxCalls) throw new OperationError('MODEL_BUDGET_EXCEEDED');
        // Bound history/input per operation without cutting messages mid-JSON.
        if (messages.reduce((size, message) => size + message.content.length, 0) > 220_000) throw new OperationError('CONTEXT_TOO_LARGE');
        let listener;
        try {
          return await Promise.race([
            Promise.resolve().then(() => complete(messages)),
            new Promise((_, reject) => { listener = () => reject(abortError()); combined.addEventListener('abort', listener, { once: true }); if (combined.aborted) listener(); }),
          ]);
        } finally { if (listener) combined.removeEventListener('abort', listener); }
      };
    },
    stats: () => ({ modelCalls: Math.min(calls, maxCalls), durationMs: Date.now() - started, ...usage, ...modelInfo }),
  };
}

export async function readRequestJson(request, maxBytes) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing request body');
  let total = 0;
  const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) { await reader.cancel(); throw new OperationError('REQUEST_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
