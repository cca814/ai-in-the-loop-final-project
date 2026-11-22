import { OperationError } from '../report-agent/operation.js';

export class RenderBusyError extends Error {}
const slotKey = Symbol.for('slide-generator.local-render-slots');
const slots = globalThis[slotKey] ??= { active: 0 };

export async function withRenderSlot(task, { signal } = {}) {
  if (signal?.aborted) throw new OperationError('OPERATION_CANCELLED');
  if (slots.active >= 2) throw new RenderBusyError('Local renderer is busy');
  slots.active++;
  try {
    const result = await task();
    if (signal?.aborted) throw new OperationError('OPERATION_CANCELLED');
    return result;
  } finally { slots.active--; }
}
