import type { ApiResponse, CapabilityConnection } from '../types.js';
import type { QueryScope } from '../queries.js';
import { getQuery, getQueryBySlug, evaluateQuery } from '../queries.js';

export async function handleGetQueryResults(
  id: string,
  scope: QueryScope,
): Promise<ApiResponse<CapabilityConnection>> {
  try {
    const query = await getQuery(id, scope);
    if (!query) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Query not found' } };
    }

    const results = await evaluateQuery(query);
    return { success: true, data: results };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return { success: false, error: { code: 'INTERNAL_ERROR', message } };
  }
}

export async function handleGetQueryResultsBySlug(
  slug: string,
  scope: QueryScope,
): Promise<ApiResponse<CapabilityConnection>> {
  try {
    const query = await getQueryBySlug(slug, scope);
    if (!query) {
      return { success: false, error: { code: 'NOT_FOUND', message: `Query with slug "${slug}" not found` } };
    }

    const results = await evaluateQuery(query);
    return { success: true, data: results };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return { success: false, error: { code: 'INTERNAL_ERROR', message } };
  }
}
