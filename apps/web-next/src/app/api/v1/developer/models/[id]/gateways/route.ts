/**
 * Model Gateways API Routes
 * GET /api/v1/developer/models/:id/gateways - Get gateway offers for a model from the database
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

/** Next.js 15 App Router passes params as a Promise. */
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

    // Verify the model exists
    const model = await prisma.devApiAIModel.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!model) {
      return errors.notFound('Model');
    }

    const gateways = await prisma.devApiGatewayOffer.findMany({
      where: { modelId: id },
      orderBy: [{ price: 'asc' }],
      select: {
        id: true,
        gatewayId: true,
        gatewayName: true,
        price: true,
        latency: true,
        availability: true,
      },
    });

    return success({
      modelId: id,
      gateways,
    });
  } catch (err) {
    console.error('Model gateways error:', err);
    return errors.internal('Failed to get model gateways');
  }
}
