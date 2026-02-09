/**
 * Gateway Orchestrator Connections API Routes
 * GET /api/v1/gateway/:id/orchestrators - List orchestrator connections for a gateway
 */

import {NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;

    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    // Check if gateway exists
    const gateway = await prisma.gateway.findUnique({
      where: { id },
    });

    if (!gateway) {
      return errors.notFound('Gateway');
    }

    const connections = await prisma.gatewayOrchestratorConnection.findMany({
      where: { gatewayId: id },
      orderBy: { latencyScore: 'desc' },
    });

    return success({ connections });
  } catch (err) {
    console.error('Orchestrator connections error:', err);
    return errors.internal('Failed to get orchestrator connections');
  }
}
