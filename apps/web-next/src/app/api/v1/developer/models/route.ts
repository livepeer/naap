/**
 * Developer Models API Routes
 * GET /api/v1/developer/models - List AI models from the database
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Prisma } from '@naap/database';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { serialiseModel } from '@/lib/api/models';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type');
    const featured = searchParams.get('featured');
    const realtime = searchParams.get('realtime');

    const where: Prisma.DevApiAIModelWhereInput = {};

    if (type) {
      where.type = type;
    }
    if (featured === 'true') {
      where.featured = true;
    }
    if (realtime === 'true') {
      where.realtime = true;
    }

    const rows = await prisma.devApiAIModel.findMany({
      where,
      orderBy: [{ featured: 'desc' }, { name: 'asc' }],
    });

    const models = rows.map(serialiseModel);

    return success({
      models,
      total: models.length,
    });
  } catch (err) {
    console.error('Models list error:', err);
    return errors.internal('Failed to list models');
  }
}
