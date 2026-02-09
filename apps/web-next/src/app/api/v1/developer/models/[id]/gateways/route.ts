/**
 * Model Gateways API Routes
 * GET /api/v1/developer/models/:id/gateways - Get gateway offers for a model
 */

import { NextRequest } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { getModel, getGatewayOffers } from '@/lib/data/developer-models';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
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

    const model = getModel(id);
    if (!model) {
      return errors.notFound('Model');
    }

    const gateways = getGatewayOffers(id);

    return success({
      modelId: id,
      gateways,
    });
  } catch (err) {
    console.error('Model gateways error:', err);
    return errors.internal('Failed to get model gateways');
  }
}
