import type { ApiResponse, EnrichedModel, HandlerContext } from '../types.js';
import { getCapability } from '../aggregator.js';

export async function handleGetCapabilityModels(
  id: string,
  ctx: HandlerContext,
): Promise<ApiResponse<EnrichedModel[]>> {
  try {
    if (!id || typeof id !== 'string') {
      return { success: false, error: { code: 'VALIDATION_ERROR', message: 'id is required' } };
    }

    const capability = await getCapability(id, ctx);
    if (!capability) {
      return { success: false, error: { code: 'NOT_FOUND', message: `Capability "${id}" not found` } };
    }

    return { success: true, data: capability.models };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return { success: false, error: { code: 'INTERNAL_ERROR', message } };
  }
}
