import type { ApiResponse, CapabilityConnection, HandlerContext } from '../types.js';
import { ListCapabilitiesParamsSchema } from '../types.js';
import { getCapabilities, filterCapabilities } from '../aggregator.js';

export async function handleListCapabilities(
  searchParams: URLSearchParams,
  ctx: HandlerContext,
): Promise<ApiResponse<CapabilityConnection>> {
  try {
    const raw: Record<string, string> = {};
    searchParams.forEach((value, key) => { raw[key] = value; });

    const parsed = ListCapabilitiesParamsSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message || 'Invalid parameters' },
      };
    }

    const all = await getCapabilities(ctx);
    const result = filterCapabilities(all, parsed.data);

    return { success: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return { success: false, error: { code: 'INTERNAL_ERROR', message } };
  }
}
