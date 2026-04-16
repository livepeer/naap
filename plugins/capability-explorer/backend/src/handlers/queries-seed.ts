import type { ApiResponse } from '../types.js';
import type { QueryScope } from '../queries.js';
import { seedDemoQueries } from '../queries.js';

export async function handleSeedQueries(
  scope: QueryScope,
): Promise<ApiResponse<{ created: number; total: number }>> {
  try {
    const result = await seedDemoQueries(scope);
    return { success: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return { success: false, error: { code: 'INTERNAL_ERROR', message } };
  }
}
