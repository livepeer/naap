import { prisma } from '@naap/database';
import type { ApiResponse } from '../types.js';
import { ensureDefaultSources, getSources } from '../sources/index.js';

interface SourceInfo {
  id: string;
  name: string;
  type: 'core' | 'enrichment';
  enabled: boolean;
  lastSnapshotAt: string | null;
  lastSnapshotStatus: string | null;
}

export async function handleGetSources(): Promise<ApiResponse<{ sources: SourceInfo[] }>> {
  try {
    ensureDefaultSources();
    const allSources = getSources();

    const config = await prisma.capabilityExplorerConfig.findUnique({
      where: { id: 'default' },
    });
    const enabledMap = (config?.enabledSources as Record<string, boolean>) ?? {};

    const snapshots = await prisma.capabilitySnapshot.findMany({
      orderBy: { createdAt: 'desc' },
      distinct: ['sourceId'],
      select: { sourceId: true, status: true, createdAt: true },
    });
    const snapshotMap = new Map(snapshots.map((s) => [s.sourceId, s]));

    const sources: SourceInfo[] = allSources.map((s) => {
      const snap = snapshotMap.get(s.id);
      return {
        id: s.id,
        name: s.name,
        type: s.type,
        enabled: enabledMap[s.id] !== false,
        lastSnapshotAt: snap?.createdAt?.toISOString() ?? null,
        lastSnapshotStatus: snap?.status ?? null,
      };
    });

    return { success: true, data: { sources } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return { success: false, error: { code: 'INTERNAL_ERROR', message } };
  }
}

export async function handleGetSnapshots(
  limit = 20,
): Promise<ApiResponse<{ snapshots: Array<Record<string, unknown>> }>> {
  try {
    const snapshots = await prisma.capabilitySnapshot.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        sourceId: true,
        status: true,
        errorMessage: true,
        durationMs: true,
        createdAt: true,
      },
    });

    return {
      success: true,
      data: {
        snapshots: snapshots.map((s) => ({
          ...s,
          createdAt: s.createdAt.toISOString(),
        })),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return { success: false, error: { code: 'INTERNAL_ERROR', message } };
  }
}
