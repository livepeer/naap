/**
 * Developer Models API Routes
 * GET /api/v1/developer/models - List AI models from the database
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Prisma } from '@naap/database';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

/** Map a Prisma DevApiAIModel row to the shape the frontend expects. */
function serialiseModel(m: {
  id: string;
  name: string;
  tagline: string;
  type: string;
  featured: boolean;
  realtime: boolean;
  costPerMinMin: number;
  costPerMinMax: number;
  latencyP50: number;
  coldStart: number;
  fps: number;
  useCases: string[];
  badges: string[];
  _count?: { gatewayOffers: number };
}) {
  return {
    id: m.id,
    name: m.name,
    tagline: m.tagline,
    type: m.type,
    featured: m.featured,
    realtime: m.realtime,
    costPerMin: { min: m.costPerMinMin, max: m.costPerMinMax },
    latencyP50: m.latencyP50,
    coldStart: m.coldStart,
    fps: m.fps,
    gatewayCount: m._count?.gatewayOffers ?? 0,
    useCases: m.useCases,
    badges: m.badges,
  };
}

export { serialiseModel };

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
      include: {
        _count: { select: { gatewayOffers: true } },
      },
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
