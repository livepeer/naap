/**
 * Billing Providers Routes
 * GET /api/v1/billing-providers - List enabled billing providers (public catalog)
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

export async function GET(): Promise<NextResponse> {
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
    console.error('Billing providers list error:', err);
    return errors.internal('Failed to list billing providers');
  }
}
