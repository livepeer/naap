import { prisma } from '@naap/database';
import type { ApiResponse, CapabilityExplorerConfigRecord } from '../types.js';
import { UpdateConfigSchema } from '../types.js';

function toRecord(row: Record<string, unknown>): CapabilityExplorerConfigRecord {
  return {
    id: row.id as string,
    refreshIntervalHours: row.refreshIntervalHours as number,
    enabledSources: (row.enabledSources as Record<string, boolean>) ?? {},
    refreshIntervals: (row.refreshIntervals as Record<string, number>) ?? {},
    lastRefreshAt: row.lastRefreshAt ? (row.lastRefreshAt as Date).toISOString() : null,
    lastRefreshStatus: (row.lastRefreshStatus as string) ?? null,
    updatedAt: (row.updatedAt as Date).toISOString(),
  };
}

export async function handleGetConfig(): Promise<ApiResponse<CapabilityExplorerConfigRecord>> {
  try {
    const config = await prisma.capabilityExplorerConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: {
        id: 'default',
        enabledSources: {
          clickhouse: true,
          'onchain-registry': true,
          'naap-orchestrators': true,
          huggingface: true,
        },
      },
    });
    return { success: true, data: toRecord(config as unknown as Record<string, unknown>) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return { success: false, error: { code: 'INTERNAL_ERROR', message } };
  }
}

export async function handleUpdateConfig(
  body: unknown,
): Promise<ApiResponse<CapabilityExplorerConfigRecord>> {
  const parsed = UpdateConfigSchema.safeParse(body);
  if (!parsed.success) {
    return {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: parsed.error.issues.map((i) => i.message).join('; ') },
    };
  }

  try {
    const data: Record<string, unknown> = {};
    if (parsed.data.refreshIntervalHours !== undefined) {
      data.refreshIntervalHours = parsed.data.refreshIntervalHours;
    }
    if (parsed.data.enabledSources !== undefined) {
      data.enabledSources = parsed.data.enabledSources;
    }
    if (parsed.data.refreshIntervals !== undefined) {
      data.refreshIntervals = parsed.data.refreshIntervals;
    }

    const config = await prisma.capabilityExplorerConfig.upsert({
      where: { id: 'default' },
      update: data,
      create: {
        id: 'default',
        enabledSources: parsed.data.enabledSources ?? {
          clickhouse: true,
          'onchain-registry': true,
          'naap-orchestrators': true,
          huggingface: true,
        },
        refreshIntervalHours: parsed.data.refreshIntervalHours ?? 4,
      },
    });
    return { success: true, data: toRecord(config as unknown as Record<string, unknown>) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return { success: false, error: { code: 'INTERNAL_ERROR', message } };
  }
}
