/**
 * Orchestrator Leaderboard — Global Dataset Refresh (pluggable pipeline)
 *
 * Reads enabled LeaderboardSource rows from the DB, fetches data from each
 * source adapter in parallel, runs the hybrid conflict resolver, writes the
 * audit record, and replaces the in-memory global dataset. Plan caches are
 * cleared so they re-evaluate lazily.
 *
 * Downstream consumers (ranking.ts, plan evaluator, /dataset route) are
 * unchanged — the in-memory shape
 *   { capabilities: Record<string, ClickHouseLeaderboardRow[]> }
 * is preserved.
 */

import { prisma } from '@/lib/db';
import { Prisma } from '@naap/database';
import type { SourceKind, NormalizedOrch, SourceStats } from './sources/types';
import { getAdapter } from './sources';
import { resolve, type ResolverConfig, type AuditEntry } from './resolver';
import { setGlobalDataset } from './global-dataset';
import { getRefreshIntervalMs, markRefreshed } from './config';
import { clearPlanCache } from './refresh';

// ---------------------------------------------------------------------------
// Load resolver config from DB (LeaderboardSource table)
// ---------------------------------------------------------------------------

const DEFAULT_SOURCES: { kind: SourceKind; priority: number; enabled: boolean }[] = [
  { kind: 'livepeer-subgraph', priority: 1, enabled: true },
  { kind: 'clickhouse-query', priority: 2, enabled: true },
  { kind: 'naap-discover', priority: 3, enabled: true },
  { kind: 'naap-pricing', priority: 4, enabled: false },
];

async function loadResolverConfig(): Promise<ResolverConfig> {
  try {
    // Always upsert all DEFAULT_SOURCES so new sources get created and
    // sources that were previously disabled-by-default but are now
    // enabled-by-default get synced. Admin can still override via the
    // sources API (the upsert only enables, never disables).
    await prisma.$transaction(
      DEFAULT_SOURCES.map((s) =>
        prisma.leaderboardSource.upsert({
          where: { kind: s.kind },
          update: s.enabled ? { enabled: true } : {},
          create: { kind: s.kind, priority: s.priority, enabled: s.enabled },
        }),
      ),
    );

    const rows = await prisma.leaderboardSource.findMany({
      orderBy: { priority: 'asc' },
    });

    return {
      sources: rows.map((r) => ({
        kind: r.kind as SourceKind,
        priority: r.priority,
        enabled: r.enabled,
      })),
    };
  } catch {
    // DB not migrated yet — fall back to defaults
    return { sources: DEFAULT_SOURCES };
  }
}

// ---------------------------------------------------------------------------
// Audit writer
// ---------------------------------------------------------------------------

interface AuditWriteInput extends AuditEntry {
  durationMs: number;
  refreshedBy: string;
  perSource: Record<string, SourceStats>;
}

async function writeAudit(input: AuditWriteInput): Promise<void> {
  try {
    await prisma.leaderboardRefreshAudit.create({
      data: {
        refreshedBy: input.refreshedBy,
        durationMs: input.durationMs,
        membershipSource: input.membershipSource,
        totalOrchestrators: input.totalOrchestrators,
        totalCapabilities: input.totalCapabilities,
        perSource: input.perSource as unknown as Prisma.InputJsonValue,
        conflicts: input.conflicts as unknown as Prisma.InputJsonValue,
        dropped: input.dropped as unknown as Prisma.InputJsonValue,
        warnings: input.warnings,
      },
    });
  } catch (err) {
    console.error('[orchestrator-leaderboard] Failed to write audit:', err);
  }
}

// ---------------------------------------------------------------------------
// Public API — preserved signature
// ---------------------------------------------------------------------------

export async function refreshGlobalDataset(
  refreshedBy: string,
  authToken: string,
  requestUrl?: string,
  cookieHeader?: string | null,
  options?: { internal?: boolean },
): Promise<{
  refreshed: boolean;
  capabilities: number;
  orchestrators: number;
}> {
  const t0 = Date.now();
  const cfg = await loadResolverConfig();
  const enabled = cfg.sources.filter((s) => s.enabled).sort((a, b) => a.priority - b.priority);
  const ctx = { authToken, requestUrl, cookieHeader, internal: options?.internal };

  const perSource: Partial<Record<SourceKind, NormalizedOrch[]>> = {};
  const sourceStats: Record<string, SourceStats> = {};

  // Fetch from all enabled sources (concurrently for speed)
  const fetchPromises = enabled.map(async (s) => {
    try {
      const adapter = getAdapter(s.kind);
      const { rows, stats } = await adapter.fetchAll(ctx);
      perSource[s.kind] = rows;
      sourceStats[s.kind] = stats;
    } catch (err) {
      sourceStats[s.kind] = {
        ok: false,
        fetched: 0,
        durationMs: Date.now() - t0,
        errorMessage: (err as Error).message,
      };
      perSource[s.kind] = [];
    }
  });

  await Promise.all(fetchPromises);

  const { capabilities, audit } = resolve(perSource, cfg);

  const totalOrchestrators = audit.totalOrchestrators;
  const intervalMs = await getRefreshIntervalMs();

  setGlobalDataset(
    {
      capabilities,
      refreshedAt: Date.now(),
      refreshedBy,
      totalOrchestrators,
    },
    intervalMs,
  );

  const capabilityNames = Object.keys(capabilities).sort();
  await markRefreshed(refreshedBy, capabilityNames);

  await writeAudit({
    ...audit,
    durationMs: Date.now() - t0,
    refreshedBy,
    perSource: sourceStats,
  });

  clearPlanCache();

  return {
    refreshed: true,
    capabilities: Object.keys(capabilities).length,
    orchestrators: totalOrchestrators,
  };
}
