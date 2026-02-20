/**
 * Developer API Keys Routes
 * GET /api/v1/developer/keys - List user's API keys
 * POST /api/v1/developer/keys - Create new API key
 *
 * PR 2 (backfill) version: reads new columns with fallback to old,
 * full dual-write on create (old fields + new nullable fields).
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
  const salt = 'naap-api-key-v1';
  return crypto.scryptSync(key, salt, 32).toString('hex');
}

function generateKeyLookupId(): string {
  return crypto.randomBytes(8).toString('hex');
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

    const enriched = await Promise.all(
      keys.map(async (k: any) => {
        let project = null;
        if (k.projectId) {
          project = await prisma.devApiProject.findUnique({
            where: { id: k.projectId },
            select: { id: true, name: true, isDefault: true },
          });
        }

        let billingProvider = null;
        if (k.billingProviderId) {
          billingProvider = await prisma.billingProvider.findUnique({
            where: { id: k.billingProviderId },
            select: { id: true, slug: true, displayName: true },
          });
        }

        return {
          ...k,
          project: project ?? { id: null, name: k.projectName, isDefault: false },
          billingProvider,
        };
      })
    );

    return success(
      { keys: enriched },
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

    const projectName = body.projectName;
    const modelId = body.modelId;
    const gatewayId = body.gatewayId;

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

    const model = await prisma.devApiAIModel.findUnique({
      where: { id: modelId },
      select: { id: true },
    });
    if (!model) {
      return errors.badRequest('Invalid modelId');
    }

    const gateway = await prisma.devApiGatewayOffer.findFirst({
      where: { modelId, gatewayId },
      select: { id: true },
    });
    if (!gateway) {
      return errors.badRequest('Gateway does not offer this model');
    }

    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const keyLookupId = generateKeyLookupId();

    // Resolve billingProviderId: use provided value, or look up daydream as default
    let resolvedBillingProviderId: string | null = null;
    const bodyBillingId = typeof body.billingProviderId === 'string'
      ? body.billingProviderId.trim()
      : null;
    if (bodyBillingId) {
      resolvedBillingProviderId = bodyBillingId;
    } else {
      const daydream = await prisma.billingProvider.findUnique({
        where: { slug: 'daydream' },
        select: { id: true },
      });
      resolvedBillingProviderId = daydream?.id ?? null;
    }

    // Resolve projectId: use provided, or find/create default project
    let resolvedProjectId: string | null = null;
    const bodyProjectId = typeof body.projectId === 'string'
      ? body.projectId.trim()
      : null;
    if (bodyProjectId) {
      resolvedProjectId = bodyProjectId;
    } else {
      try {
        let defaultProject = await prisma.devApiProject.findFirst({
          where: { userId: user.id, isDefault: true },
          select: { id: true },
        });
        if (!defaultProject) {
          defaultProject = await prisma.devApiProject.create({
            data: {
              userId: user.id,
              name: (projectName as string).trim(),
              isDefault: true,
            },
          });
        }
        resolvedProjectId = defaultProject.id;
      } catch {
        // Race condition on unique constraint — fetch existing
        const existing = await prisma.devApiProject.findFirst({
          where: { userId: user.id, isDefault: true },
          select: { id: true },
        });
        resolvedProjectId = existing?.id ?? null;
      }
    }

    const apiKey = await prisma.devApiKey.create({
      data: {
        userId: user.id,
        projectName: projectName as string,
        modelId,
        gatewayOfferId: gateway.id,
        keyHash,
        keyPrefix: rawKey.slice(0, 8),
        keyLookupId,
        billingProviderId: resolvedBillingProviderId,
        projectId: resolvedProjectId,
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
