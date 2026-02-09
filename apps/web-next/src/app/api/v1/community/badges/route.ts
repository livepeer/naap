/**
 * Community Badges API Routes
 * GET /api/v1/community/badges - List all available badges
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

/**
 * GET - List all available community badges
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const badges = await prisma.communityBadge.findMany({
      orderBy: { threshold: 'asc' },
    });

    return success(badges);
  } catch (err) {
    console.error('Badges list error:', err);
    return errors.internal('Failed to list badges');
  }
}
