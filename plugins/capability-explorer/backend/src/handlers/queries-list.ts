import type { ApiResponse, CapabilityQueryRecord } from '../types.js';
import type { QueryScope } from '../queries.js';
import { listQueries } from '../queries.js';

export async function handleListQueries(
  scope: QueryScope,
): Promise<ApiResponse<{ queries: CapabilityQueryRecord[] }>> {
  try {
    const queries = await listQueries(scope);
    return { success: true, data: { queries } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return { success: false, error: { code: 'INTERNAL_ERROR', message } };
  }
}
