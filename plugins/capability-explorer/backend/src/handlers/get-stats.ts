import type { ApiResponse, ExplorerStats, HandlerContext } from '../types.js';
import { getStats } from '../aggregator.js';

export async function handleGetStats(
  ctx: HandlerContext,
): Promise<ApiResponse<ExplorerStats>> {
  try {
    const stats = await getStats(ctx);
    return { success: true, data: stats };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return { success: false, error: { code: 'INTERNAL_ERROR', message } };
  }
}
