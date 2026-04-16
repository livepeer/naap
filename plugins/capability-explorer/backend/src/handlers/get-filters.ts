import type { ApiResponse, CapabilityCategory, HandlerContext } from '../types.js';
import { getFilters } from '../aggregator.js';

export async function handleGetFilters(
  ctx: HandlerContext,
): Promise<ApiResponse<{ categories: CapabilityCategory[]; capabilities: string[] }>> {
  try {
    const filters = await getFilters(ctx);
    return { success: true, data: filters };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return { success: false, error: { code: 'INTERNAL_ERROR', message } };
  }
}
