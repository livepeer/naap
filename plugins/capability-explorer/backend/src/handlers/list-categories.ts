import type { ApiResponse, CategoryInfo, HandlerContext } from '../types.js';
import { getCategories } from '../aggregator.js';

export async function handleListCategories(
  ctx: HandlerContext,
): Promise<ApiResponse<CategoryInfo[]>> {
  try {
    const categories = await getCategories(ctx);
    return { success: true, data: categories };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return { success: false, error: { code: 'INTERNAL_ERROR', message } };
  }
}
