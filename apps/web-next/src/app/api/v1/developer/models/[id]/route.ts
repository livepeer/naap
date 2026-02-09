/**
 * Single Developer Model API Routes
 * GET /api/v1/developer/models/:id - Get model details
 */

import {NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { getModel } from '@/lib/data/developer-models';

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

    const model = getModel(id);
    if (!model) {
      return errors.notFound('Model');
    }

    return success({ model });
  } catch (err) {
    console.error('Model detail error:', err);
    return errors.internal('Failed to get model');
  }
}
