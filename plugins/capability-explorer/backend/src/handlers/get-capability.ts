import type { ApiResponse, EnrichedCapability, HandlerContext } from '../types.js';
import { getCapability } from '../aggregator.js';

export async function handleGetCapability(
  id: string,
  ctx: HandlerContext,
): Promise<ApiResponse<EnrichedCapability | null>> {
  try {
    if (!id || typeof id !== 'string') {
      return { success: false, error: { code: 'VALIDATION_ERROR', message: 'id is required' } };
    }

    const capability = await getCapability(id, ctx);
    if (!capability) {
      return { success: false, error: { code: 'NOT_FOUND', message: `Capability "${id}" not found` } };
    }

    return { success: true, data: capability };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return { success: false, error: { code: 'INTERNAL_ERROR', message } };
  }
}
