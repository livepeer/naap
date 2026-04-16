import type { ApiResponse, HandlerContext } from '../types.js';
import { executeGraphQL } from '../graphql/execute.js';

export async function handleGraphQL(
  body: { query: string; variables?: Record<string, unknown> },
  ctx: HandlerContext,
): Promise<ApiResponse> {
  try {
    if (!body.query || typeof body.query !== 'string') {
      return { success: false, error: { code: 'VALIDATION_ERROR', message: 'query is required' } };
    }

    const result = await executeGraphQL(body.query, body.variables, ctx);

    if (result.errors && result.errors.length > 0) {
      return {
        success: true,
        data: { data: result.data, errors: result.errors },
      };
    }

    return { success: true, data: { data: result.data } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'GraphQL execution failed';
    return { success: false, error: { code: 'GRAPHQL_ERROR', message } };
  }
}
