/**
 * Developer API Keys Routes
 * GET /api/v1/developer/keys - List user's API keys
 * POST /api/v1/developer/keys - Create new API key
 */

import { NextRequest, NextResponse } from 'next/server';
import * as crypto from 'crypto';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken, parsePagination } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

function generateApiKey(): string {
  return `naap_${crypto.randomBytes(24).toString('hex')}`;
}

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

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

    const [keys, total] = await Promise.all([
      prisma.devApiKey.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip,
      }),
      prisma.devApiKey.count({
        where: { userId: user.id },
      }),
    ]);

    return success(
      { keys },
      {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      }
    );
  } catch (err) {
    console.error('API keys list error:', err);
    return errors.internal('Failed to list API keys');
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

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errors.badRequest('Invalid JSON in request body');
    }

    const { projectName, modelId, gatewayId } = body as {
      projectName?: string;
      modelId?: string;
      gatewayId?: string;
    };

    if (
      typeof projectName !== 'string' ||
      typeof modelId !== 'string' ||
      typeof gatewayId !== 'string' ||
      projectName.trim() === '' ||
      modelId.trim() === '' ||
      gatewayId.trim() === ''
    ) {
      return errors.badRequest('projectName, modelId, and gatewayId are required');
    }

    // Validate model exists in the database
    const model = await prisma.devApiAIModel.findUnique({
      where: { id: modelId },
      select: { id: true },
    });
    if (!model) {
      return errors.badRequest('Invalid modelId');
    }

    // Validate gateway offers this model in the database
    const gateway = await prisma.devApiGatewayOffer.findFirst({
      where: { modelId, gatewayId },
      select: { id: true },
    });
    if (!gateway) {
      return errors.badRequest('Gateway does not offer this model');
    }

    // Generate API key
    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);

    const apiKey = await prisma.devApiKey.create({
      data: {
        userId: user.id,
        projectName,
        modelId,
        gatewayOfferId: gateway.id,
        keyHash,
        keyPrefix: rawKey.slice(0, 8),
        status: 'ACTIVE',
      },
    });

    return success({
      key: apiKey,
      rawApiKey: rawKey,
      warning: 'Store this key securely. It will not be shown again.',
    });
  } catch (err) {
    console.error('Create API key error:', err);
    return errors.internal('Failed to create API key');
  }
}
