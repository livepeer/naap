import type { ApiResponse } from '../types.js';
import type { SourceContext } from '../sources/interface.js';
import { refreshCapabilities, type RefreshResult } from '../refresh.js';

export async function handleAdminRefresh(
  ctx: SourceContext,
): Promise<ApiResponse<RefreshResult>> {
  try {
    const result = await refreshCapabilities(ctx);
    return { success: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refresh failed';
    return { success: false, error: { code: 'INTERNAL_ERROR', message } };
  }
}
