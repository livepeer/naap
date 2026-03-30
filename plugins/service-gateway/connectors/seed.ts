/**
 * Service Gateway Connector Seed — Pure DB Logic
 *
 * Reads connector templates from plugins/service-gateway/connectors/*.json
 * and upserts them as public ServiceConnector records with endpoints, plans,
 * and API keys.
 *
 * Idempotent — safe to call from any seed entry point.
 *
 * Upstream secrets (API keys etc.) are resolved from environment
 * variables at runtime by the server backend — they are never
 * stored in the database.
 */

import type { PrismaClient, Prisma } from '../../../packages/database/src/generated/client/index.js';
import { loadConnectorTemplates } from './loader.js';

const GLOBAL_CONNECTOR_SLUGS = new Set(['livepeer-leaderboard', 'clickhouse']);

function leaderboardGatewayOriginFromEnv(): string | null {
  const full = process.env.LEADERBOARD_API_URL?.trim();
  if (!full) return null;
  return full.replace(/\/+$/, '');
}

function clickhouseUpstreamBaseFromEnv(): string | null {
  const full = process.env.CLICKHOUSE_URL?.trim();
  if (!full) return null;
  return full.replace(/\/+$/, '');
}

export interface SeedConnectorsResult {
  total: number;
  created: number;
  existing: number;
}

/**
 * Seed all public gateway connectors into the database.
 *
 * @param prisma - An active PrismaClient instance (caller owns lifecycle)
 * @param userId - The owner user ID for non-global connectors
 */
export async function seedPublicConnectors(
  prisma: PrismaClient,
  userId: string,
): Promise<SeedConnectorsResult> {
  const templates = loadConnectorTemplates();
  let created = 0;
  let existing = 0;

  for (const def of templates) {
    const conn = def.connector;
    const slug = conn.slug;
    const isGlobalConnector = GLOBAL_CONNECTOR_SLUGS.has(slug);

    // Find existing connector
    let connector = isGlobalConnector
      ? await prisma.serviceConnector.findFirst({
          where: { slug, visibility: 'public', ownerUserId: null, teamId: null },
        })
      : await (prisma.serviceConnector as any).findUnique({
          where: { ownerUserId_slug: { ownerUserId: userId, slug } },
        });

    if (!connector) {
      connector = await prisma.serviceConnector.findFirst({
        where: { slug, visibility: 'public' },
      });
    }

    if (connector) {
      existing++;
      const updates: Prisma.ServiceConnectorUpdateInput = {};
      if (connector.category !== def.category) updates.category = def.category;
      if (connector.visibility !== 'public') updates.visibility = 'public';
      if (isGlobalConnector) {
        if (connector.ownerUserId !== null) updates.ownerUserId = null;
        if (connector.teamId !== null) updates.teamId = null;
      } else {
        if (connector.ownerUserId !== userId) updates.ownerUserId = userId;
      }
      if (connector.createdBy !== userId) updates.createdBy = userId;
      if (Object.keys(updates).length > 0) {
        await prisma.serviceConnector.update({
          where: { id: connector.id },
          data: updates,
        });
      }
    } else {
      created++;
      const upstreamBaseUrl =
        slug === 'livepeer-leaderboard'
          ? leaderboardGatewayOriginFromEnv() ?? conn.upstreamBaseUrl
          : slug === 'clickhouse'
            ? clickhouseUpstreamBaseFromEnv() ?? conn.upstreamBaseUrl
            : conn.upstreamBaseUrl;

      let allowedHosts = conn.allowedHosts || [];
      if (allowedHosts.length === 0) {
        try {
          allowedHosts = [new URL(upstreamBaseUrl).hostname];
        } catch { /* ignore */ }
      }

      connector = await prisma.serviceConnector.create({
        data: {
          ownerUserId: isGlobalConnector ? null : userId,
          createdBy: userId,
          slug,
          displayName: conn.displayName,
          description: conn.description || def.description,
          category: def.category,
          visibility: 'public',
          upstreamBaseUrl,
          allowedHosts,
          defaultTimeout: conn.defaultTimeout ?? 30000,
          healthCheckPath: conn.healthCheckPath ?? null,
          authType: conn.authType,
          authConfig: (conn.authConfig || {}) as Prisma.InputJsonValue,
          secretRefs: conn.secretRefs,
          streamingEnabled: conn.streamingEnabled ?? false,
          responseWrapper: conn.responseWrapper ?? true,
          tags: conn.tags || [],
          status: 'draft',
        },
      });
    }

    const connectorId = connector.id;

    // Endpoints
    const existingEps = await prisma.connectorEndpoint.findMany({
      where: { connectorId },
      select: { path: true, method: true },
    });
    const existingSet = new Set(existingEps.map((e: { method: string; path: string }) => `${e.method}:${e.path}`));

    for (const ep of def.endpoints) {
      if (existingSet.has(`${ep.method}:${ep.path}`)) continue;
      await prisma.connectorEndpoint.create({
        data: {
          connectorId,
          name: ep.name,
          description: ep.description,
          method: ep.method,
          path: ep.path,
          upstreamPath: ep.upstreamPath,
          upstreamContentType: ep.upstreamContentType ?? 'application/json',
          bodyTransform: ep.bodyTransform ?? 'passthrough',
          upstreamStaticBody: ep.upstreamStaticBody ?? null,
          rateLimit: ep.rateLimit,
          timeout: ep.timeout,
          cacheTtl: ep.cacheTtl,
          retries: ep.retries ?? 0,
          bodyBlacklist: ep.bodyBlacklist ?? [],
          bodyPattern: ep.bodyPattern ?? null,
        },
      });
    }

    // Publish
    if (connector.status !== 'published') {
      await prisma.serviceConnector.update({
        where: { id: connectorId },
        data: { status: 'published', publishedAt: new Date() },
      });
    }

    // Plan + API key (skip for global connectors)
    if (isGlobalConnector) continue;

    const planName = `${slug}-standard`;
    let plan = await prisma.gatewayPlan.findFirst({
      where: { ownerUserId: userId, name: planName },
    });
    if (!plan) {
      plan = await prisma.gatewayPlan.create({
        data: {
          ownerUserId: userId,
          name: planName,
          displayName: `${conn.displayName} Standard`,
          rateLimit: 60,
          dailyQuota: 1000,
        },
      });
    }

    const existingKey = await prisma.gatewayApiKey.findFirst({
      where: { ownerUserId: userId, name: `${slug}-test-key`, status: 'active' },
    });
    if (!existingKey) {
      const crypto = await import('crypto');
      const rawKey = `gk_${crypto.randomBytes(24).toString('hex')}`;
      const hash = crypto.createHash('sha256').update(rawKey).digest('hex');

      await prisma.gatewayApiKey.create({
        data: {
          ownerUserId: userId,
          createdBy: userId,
          connectorId,
          planId: plan.id,
          name: `${slug}-test-key`,
          keyHash: hash,
          keyPrefix: rawKey.slice(0, 8),
          status: 'active',
        },
      });
    }
  }

  return { total: templates.length, created, existing };
}
