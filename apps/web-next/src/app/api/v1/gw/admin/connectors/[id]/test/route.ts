/**
 * Service Gateway — Admin: Test Connector Connectivity
 * POST /api/v1/gw/admin/connectors/:id/test
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { success, errors } from '@/lib/api/response';
import { getAdminContext, isErrorResponse, loadConnector } from '@/lib/gateway/admin/team-guard';
import { testUpstreamConnectivity } from '@/lib/gateway/admin/test-connectivity';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const connector = await loadConnector(id, ctx.teamId);
  if (!connector) {
    return errors.notFound('Connector');
  }

  const result = await testUpstreamConnectivity(
    connector.upstreamBaseUrl,
    connector.healthCheckPath,
    connector.authType,
    connector.authConfig as Record<string, unknown>,
    connector.secretRefs,
    connector.allowedHosts,
    ctx.teamId,
    ctx.token
  );

  return success(result);
}
