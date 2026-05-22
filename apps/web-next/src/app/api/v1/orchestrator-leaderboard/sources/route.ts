/**
 * GET  /api/v1/orchestrator-leaderboard/sources — list all data sources with connector details
 * PUT  /api/v1/orchestrator-leaderboard/sources — update source priority/enabled (admin only)
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';
import { SOURCE_KINDS } from '@/lib/orchestrator-leaderboard/sources';
import type { SourceKind } from '@/lib/orchestrator-leaderboard/sources';
import { z } from 'zod';

const DEFAULT_SOURCES: { kind: SourceKind; priority: number; enabled: boolean }[] = [
  { kind: 'livepeer-subgraph', priority: 1, enabled: true },
  { kind: 'clickhouse-query', priority: 2, enabled: true },
  { kind: 'naap-discover', priority: 3, enabled: true },
  { kind: 'naap-pricing', priority: 4, enabled: false },
];

const SOURCE_TO_CONNECTOR: Record<string, string> = {
  'livepeer-subgraph': 'livepeer-subgraph',
  'clickhouse-query': 'clickhouse-query',
  'naap-discover': 'naap-discover',
  'naap-pricing': 'naap-pricing',
};

async function ensureSeeded() {
  const count = await prisma.leaderboardSource.count();
  if (count === 0) {
    await prisma.$transaction(
      DEFAULT_SOURCES.map((s) =>
        prisma.leaderboardSource.upsert({
          where: { kind: s.kind },
          update: {},
          create: { kind: s.kind, priority: s.priority, enabled: s.enabled },
        }),
      ),
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = getAuthToken(request);
  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 },
    );
  }

  const user = await validateSession(token);
  if (!user || !user.roles.includes('system:admin')) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Admin permission required' } },
      { status: 403 },
    );
  }

  try {
    await ensureSeeded();
    const sources = await prisma.leaderboardSource.findMany({
      orderBy: { priority: 'asc' },
    });

    // Fetch connector details for each source
    const connectorSlugs = sources.map((s) => SOURCE_TO_CONNECTOR[s.kind]).filter(Boolean);
    const connectors = await prisma.serviceConnector.findMany({
      where: { slug: { in: connectorSlugs }, status: 'published' },
      select: { slug: true, displayName: true, upstreamBaseUrl: true, status: true },
    });
    const connectorMap = new Map(connectors.map((c) => [c.slug, c]));

    // Fetch latest audit for per-source stats
    const lastAudit = await prisma.leaderboardRefreshAudit.findFirst({
      orderBy: { refreshedAt: 'desc' },
      select: { refreshedAt: true, durationMs: true, perSource: true },
    });

    const perSourceStats = (lastAudit?.perSource as Record<string, { ok?: boolean; fetched?: number; durationMs?: number; errorMessage?: string }>) ?? {};

    return NextResponse.json({
      success: true,
      data: sources.map((s) => {
        const connSlug = SOURCE_TO_CONNECTOR[s.kind];
        const conn = connSlug ? connectorMap.get(connSlug) : undefined;
        const stats = perSourceStats[s.kind];
        return {
          kind: s.kind,
          enabled: s.enabled,
          priority: s.priority,
          config: s.config,
          updatedAt: s.updatedAt.toISOString(),
          connector: conn
            ? { slug: conn.slug, displayName: conn.displayName, upstreamBaseUrl: conn.upstreamBaseUrl, status: conn.status }
            : connSlug ? { slug: connSlug, displayName: null, upstreamBaseUrl: null, status: 'not_configured' } : null,
          lastFetch: stats
            ? { ok: stats.ok ?? false, fetched: stats.fetched ?? 0, durationMs: stats.durationMs ?? 0, error: stats.errorMessage ?? null }
            : null,
        };
      }),
      lastRefreshedAt: lastAudit?.refreshedAt?.toISOString() ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list sources';
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 },
    );
  }
}

const SourceItemSchema = z.object({
  kind: z.enum(SOURCE_KINDS as unknown as [string, ...string[]]),
  enabled: z.boolean(),
  priority: z.number().int().min(1).max(100),
});

const UpdateSourcesSchema = z.object({
  sources: z.array(SourceItemSchema).min(1).max(10),
});

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const token = getAuthToken(request);
  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 },
    );
  }

  const user = await validateSession(token);
  if (!user || !user.roles.includes('system:admin')) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Admin permission required' } },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();
    const parsed = UpdateSourcesSchema.parse(body);

    await prisma.$transaction(
      parsed.sources.map((s) =>
        prisma.leaderboardSource.upsert({
          where: { kind: s.kind },
          update: { enabled: s.enabled, priority: s.priority },
          create: { kind: s.kind, enabled: s.enabled, priority: s.priority },
        }),
      ),
    );

    const updated = await prisma.leaderboardSource.findMany({
      orderBy: { priority: 'asc' },
    });

    return NextResponse.json({
      success: true,
      data: updated.map((s) => ({
        kind: s.kind,
        enabled: s.enabled,
        priority: s.priority,
        config: s.config,
        updatedAt: s.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : 'Failed to update sources';
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 },
    );
  }
}
