/**
 * Single Developer Model API Routes
 * GET /api/v1/developer/models/:id - Get model details from the database
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { serialiseModel } from '@/lib/api/models';

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

    const model = await prisma.devApiAIModel.findUnique({
      where: { id },
    });

    if (!model) {
      return errors.notFound('Model');
    }

    return success({ model: serialiseModel(model) });
  } catch (err) {
    console.error('Model detail error:', err);
    return errors.internal('Failed to get model');
  }
}
