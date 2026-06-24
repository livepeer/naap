/**
 * Billing catalog (NAAP P3) — BPP developer-facing surface.
 *
 *   GET /api/v1/catalog
 *   auth: NaaP session (cookie or Bearer)
 *   → { instances: [{ providerInstanceId, slug, displayName, adapterType, plans[] }] }
 *
 * Lists the apps/plans a developer can subscribe to across all enabled
 * `ProviderInstance`s. Plans are empty in P3 — the synced `ProviderPlan` model +
 * plan-spec pull land in P4; the catalog "exposes what exists" (the instances).
 *
 * Gated behind `multi_subscription` (default OFF): 404 when OFF, so the catalog
 * is inert/hidden and the current single-app dashboard is unchanged. Never emits
 * secrets — only the instance's public identity is returned.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/db';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { isFeatureEnabled, MULTI_SUBSCRIPTION_FLAG, PLAN_SPEC_SYNC_FLAG } from '@/lib/feature-flags';
import {
  toCatalogInstanceView,
  toCatalogPlanView,
  type CatalogPlanView,
} from '@/lib/billing/subscription-catalog';

function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

function log(level: 'info' | 'error', event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else console.info(line);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const correlationId = request.headers.get('x-request-id')?.trim() || randomUUID();
  try {
    if (!(await isFeatureEnabled(MULTI_SUBSCRIPTION_FLAG))) {
      return noStore(errors.notFound('Resource'));
    }

    const token = getAuthToken(request);
    if (!token) return noStore(errors.unauthorized('No auth token provided'));
    const user = await validateSession(token);
    if (!user) return noStore(errors.unauthorized('Invalid or expired session'));

    const instances = await prisma.providerInstance.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
      select: {
        id: true,
        slug: true,
        displayName: true,
        adapterType: true,
        enabled: true,
        sortOrder: true,
      },
    });

    // P4: join synced ProviderPlan rows so the catalog exposes subscribable
    // plans. Only when `plan_spec_sync` is ON — OFF leaves ProviderPlan unread
    // and plans `[]` (P3 behavior), so discovery/catalog stay today's static.
    const plansByInstance = new Map<string, CatalogPlanView[]>();
    if (await isFeatureEnabled(PLAN_SPEC_SYNC_FLAG)) {
      const instanceIds = instances.map((i) => i.id);
      if (instanceIds.length > 0) {
        const providerPlans = await prisma.providerPlan.findMany({
          where: { providerInstanceId: { in: instanceIds }, enabled: true },
          orderBy: [{ name: 'asc' }],
          select: {
            providerInstanceId: true,
            providerPlanId: true,
            name: true,
            capabilities: true,
            enabled: true,
          },
        });
        for (const row of providerPlans) {
          const list = plansByInstance.get(row.providerInstanceId) ?? [];
          list.push(toCatalogPlanView(row));
          plansByInstance.set(row.providerInstanceId, list);
        }
      }
    }

    const catalog = instances.map((instance) =>
      toCatalogInstanceView(instance, plansByInstance.get(instance.id) ?? []),
    );

    log('info', 'catalog.list', { correlationId, instanceCount: catalog.length });
    return noStore(success({ instances: catalog }));
  } catch (err) {
    log('error', 'catalog.error', {
      correlationId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return noStore(errors.internal('Failed to load catalog'));
  }
}
