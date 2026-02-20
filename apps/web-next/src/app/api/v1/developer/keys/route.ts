/**
 * Developer API Keys Routes
 * GET /api/v1/developer/keys - List user's API keys
 * POST /api/v1/developer/keys - Create new API key (provider-issued key via OAuth)
 */

import { NextRequest, NextResponse } from 'next/server';
import * as crypto from 'crypto';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken, parsePagination } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';
import { DevApiProjectResolutionError, resolveDevApiProjectId } from '@naap/database';

function parseApiKey(key: string): { lookupId: string; secret: string } | null {
  const m = key.match(/^naap_([0-9a-f]{16})_([0-9a-f]{48})$/);
  return m ? { lookupId: m[1], secret: m[2] } : null;
}

function deriveKeyLookupId(rawKey: string): string {
  const parsed = parseApiKey(rawKey);
  if (parsed) {
    return parsed.lookupId;
  }
  return crypto.createHash('sha256').update(rawKey).digest('hex').slice(0, 16);
}

function getKeyPrefix(lookupId: string): string {
  return `naap_${lookupId}...`;
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
        include: {
          project: { select: { id: true, name: true, isDefault: true } },
          billingProvider: {
            select: {
              id: true,
              slug: true,
              displayName: true,
            },
          },
        },
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

    const billingProviderId = body.billingProviderId as string | undefined;
    const rawApiKey = body.rawApiKey as string | undefined;
    const modelId = body.modelId as string | undefined;
    const gatewayId = body.gatewayId as string | undefined;
    const projectId = body.projectId as string | undefined;
    const projectName = body.projectName as string | undefined;
    const label = body.label as string | undefined;

    if (
      typeof billingProviderId !== 'string' ||
      billingProviderId.trim() === ''
    ) {
      return errors.badRequest('billingProviderId is required');
    }

    if (typeof rawApiKey !== 'string' || rawApiKey.trim() === '') {
      return errors.badRequest('rawApiKey is required');
    }

    const provider = await prisma.billingProvider.findUnique({
      where: { id: billingProviderId },
      select: { id: true, enabled: true },
    });
    if (!provider || !provider.enabled) {
      return errors.badRequest('Invalid or disabled billing provider');
    }

    let resolvedModelId: string | undefined;
    if (modelId && typeof modelId === 'string' && modelId.trim() !== '') {
      const model = await prisma.devApiAIModel.findUnique({
        where: { id: modelId },
        select: { id: true },
      });
      if (!model) {
        return errors.badRequest('Invalid modelId');
      }
      resolvedModelId = model.id;
    }

    let resolvedGatewayOfferId: string | undefined;
    if (resolvedModelId && gatewayId && typeof gatewayId === 'string' && gatewayId.trim() !== '') {
      const gateway = await prisma.devApiGatewayOffer.findFirst({
        where: { modelId: resolvedModelId, gatewayId },
        select: { id: true },
      });
      if (!gateway) {
        return errors.badRequest('Gateway does not offer this model');
      }
      resolvedGatewayOfferId = gateway.id;
    }

    let resolvedProjectId: string;
    try {
      resolvedProjectId = await resolveDevApiProjectId({
        prisma,
        userId: user.id,
        projectId,
        projectName,
      });
    } catch (error) {
      if (error instanceof DevApiProjectResolutionError) {
        return errors.badRequest(error.message);
      }
      throw error;
    }

    const keyLookupId = deriveKeyLookupId(rawApiKey);
    const keyPrefix = getKeyPrefix(keyLookupId);
    const resolvedLabel = label && typeof label === 'string' && label.trim() ? label.trim() : null;

    const apiKey = await prisma.devApiKey.create({
      data: {
        userId: user.id,
        projectId: resolvedProjectId,
        billingProviderId,
        modelId: resolvedModelId || null,
        gatewayOfferId: resolvedGatewayOfferId || null,
        keyLookupId,
        keyPrefix,
        label: resolvedLabel,
        status: 'ACTIVE',
      },
    });

    return success({
      key: apiKey,
      rawApiKey,
      warning: 'Store this key securely. It will not be shown again.',
    });
  } catch (err) {
    console.error('Create API key error:', err);
    return errors.internal('Failed to create API key');
  }
}
