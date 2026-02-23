/**
 * Billing Providers API Route
 * GET /api/v1/billing-providers - List available billing providers from the catalog
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const providers = await prisma.billingProvider.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        slug: true,
        displayName: true,
        description: true,
        icon: true,
        authType: true,
      },
    });

    return success({ providers });
  } catch (err) {
    console.error('Error fetching billing providers:', err);
    return errors.internal('Failed to fetch billing providers');
  }
}
