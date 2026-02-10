/**
 * Gateway API Routes
 * GET /api/v1/gateway - List gateways
 * POST /api/v1/gateway - Create gateway
 */

import {NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken, parsePagination } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

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
    const { page, pageSize, skip } = parsePagination(searchParams);
    const status = searchParams.get('status');
    const region = searchParams.get('region');

    // Build where clause
    const where: {
      status?: string;
      region?: string;
    } = {};
    if (status) where.status = status;
    if (region) where.region = region;

    const [gateways, total] = await Promise.all([
      prisma.gateway.findMany({
        where,
        include: {
          orchestratorConnections: {
            take: 10, // Limit connections in list view
          },
          configurations: true,
        },
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip,
      }),
      prisma.gateway.count({ where }),
    ]);

    return success(
      { gateways },
      {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      }
    );
  } catch (err) {
    console.error('Gateways list error:', err);
    return errors.internal('Failed to list gateways');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    // Validate CSRF token
    const csrfError = validateCSRF(request, token);
    if (csrfError) {
      return csrfError;
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const body = await request.json();
    const {
      address,
      operatorName,
      serviceUri,
      region,
      version,
      ip,
      supportedPipelines,
    } = body;

    // Validate required fields
    if (!address || !operatorName || !serviceUri || !region || !version) {
      return errors.badRequest('Missing required fields: address, operatorName, serviceUri, region, version');
    }

    const gateway = await prisma.gateway.create({
      data: {
        address,
        operatorName,
        serviceUri,
        region,
        version,
        ip,
        supportedPipelines: supportedPipelines || [],
      },
      include: {
        configurations: true,
      },
    });

    return success({ gateway }, { timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Create gateway error:', err);
    const message = err instanceof Error ? err.message : 'Failed to create gateway';
    
    if (message.includes('Unique constraint')) {
      return errors.conflict('A gateway with this address already exists');
    }
    
    return errors.internal('Failed to create gateway');
  }
}
