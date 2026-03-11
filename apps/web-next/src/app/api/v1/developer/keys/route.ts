/**
 * Developer API Keys Routes
 * GET /api/v1/developer/keys - List user's API keys
 * POST /api/v1/developer/keys - Create new API key (provider-issued key via OAuth/OIDC)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken, parsePagination } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';
import {
  DevApiProjectResolutionError,
  resolveDevApiProjectId,
  deriveKeyLookupId,
  getKeyPrefix,
  hashApiKey,
  BILLING_PROVIDERS,
} from '@naap/database';

interface OidcClaims {
  sub?: string;
  iss?: string;
  plan?: string;
  entitlements?: string[];
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

function getProviderConfig(slug: string) {
  return BILLING_PROVIDERS.find((p) => p.slug === slug);
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
    const projectId = body.projectId as string | undefined;
    const projectName = body.projectName as string | undefined;
    const label = body.label as string | undefined;
    const oidcClaims = body.oidcClaims as OidcClaims | undefined;

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
      select: { id: true, slug: true, enabled: true },
    });
    if (!provider || !provider.enabled) {
      return errors.badRequest('Invalid or disabled billing provider');
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
    const keyHash = hashApiKey(rawApiKey);
    const resolvedLabel = label && typeof label === 'string' && label.trim() ? label.trim() : null;

    // Extract OIDC identity from claims if provided (from OIDC flow)
    const providerConfig = getProviderConfig(provider.slug);
    let oidcSub: string | null = null;
    let oidcIssuer: string | null = null;
    let oidcPlan: string | null = null;
    let oidcEntitlements: string[] = [];

    if (providerConfig?.authType === 'oidc' && oidcClaims) {
      oidcSub = oidcClaims.sub || null;
      oidcIssuer = oidcClaims.iss || providerConfig.oidcIssuer || null;
      oidcPlan = oidcClaims.plan || null;
      oidcEntitlements = oidcClaims.entitlements || [];

      console.log(
        `[developer-api] Creating key with OIDC identity: sub=${oidcSub}, plan=${oidcPlan}, entitlements=[${oidcEntitlements.join(',')}]`
      );
    }

    const apiKey = await prisma.devApiKey.create({
      data: {
        userId: user.id,
        projectId: resolvedProjectId,
        billingProviderId,
        keyLookupId,
        keyPrefix,
        keyHash,
        label: resolvedLabel,
        status: 'ACTIVE',
        oidcSub,
        oidcIssuer,
        oidcPlan,
        oidcEntitlements,
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
