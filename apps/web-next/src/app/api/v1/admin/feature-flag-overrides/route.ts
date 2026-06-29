/**
 * Admin Per-Team Feature Flag Overrides API (admin only).
 *
 *   GET    /api/v1/admin/feature-flag-overrides?teamId=…
 *     → every known flag with its GLOBAL default, this team's override (if any),
 *       the EFFECTIVE value, and provenance (inherited | overridden).
 *   PUT    /api/v1/admin/feature-flag-overrides   { teamId, key, enabled }
 *     → set a per-team override ON/OFF (upsert).
 *   DELETE /api/v1/admin/feature-flag-overrides   { teamId, key }
 *     → clear a per-team override (the team re-inherits the global value).
 *
 * Per-team overrides scope a flag for ONE team without touching the platform-wide
 * `FeatureFlag` default — so a flag can be enabled for a single test team with
 * zero blast radius. Guarded by the existing `system:admin` authz; mutations are
 * CSRF-checked and audited. PURELY ADDITIVE: with no overrides, flag evaluation
 * is byte-identical to today.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { validateCSRF } from '@/lib/api/csrf';
import { success, errors, getAuthToken } from '@/lib/api/response';
import {
  KNOWN_FLAGS,
  ensureKnownFlags,
  resetFeatureFlagOverrideCache,
} from '@/lib/feature-flags';

interface SessionUser {
  id: string;
  roles: string[];
}

/** Resolve the admin session or return the error response to send. */
async function requireAdmin(
  request: NextRequest,
): Promise<{ user: SessionUser } | { error: NextResponse }> {
  const token = getAuthToken(request);
  if (!token) return { error: errors.unauthorized('No auth token provided') };

  const sessionUser = await validateSession(token);
  if (!sessionUser) return { error: errors.unauthorized('Invalid or expired session') };
  if (!sessionUser.roles.includes('system:admin')) {
    return { error: errors.forbidden('Admin permission required') };
  }
  return { user: { id: sessionUser.id, roles: sessionUser.roles } };
}

/** Best-effort audit row; never blocks (or fails) the mutation. */
async function audit(
  request: NextRequest,
  user: SessionUser,
  action: 'feature_flag_override.set' | 'feature_flag_override.clear',
  details: Record<string, string | number | boolean | null>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        resource: 'feature-flag-override',
        resourceId: typeof details.teamId === 'string' ? details.teamId : null,
        userId: user.id,
        ipAddress:
          request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
        userAgent: request.headers.get('user-agent') || null,
        details,
        status: 'success',
      },
    });
  } catch (err) {
    console.error('[feature-flag-override] audit write failed:', err);
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;

    const teamId = request.nextUrl.searchParams.get('teamId')?.trim();
    if (!teamId) return errors.badRequest('teamId query parameter is required');

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, name: true, slug: true },
    });
    if (!team) return errors.notFound('Team');

    await ensureKnownFlags();

    const [globalFlags, overrides] = await Promise.all([
      prisma.featureFlag.findMany({ select: { key: true, enabled: true, description: true } }),
      prisma.featureFlagOverride.findMany({
        where: { teamId },
        select: { flagKey: true, enabled: true, updatedBy: true, updatedAt: true },
      }),
    ]);

    const globalByKey = new Map(globalFlags.map((f) => [f.key, f]));
    const overrideByKey = new Map(overrides.map((o) => [o.flagKey, o]));

    // Union of known + DB flag keys so nothing is hidden from the admin.
    const keys = new Set<string>([
      ...KNOWN_FLAGS.map((f) => f.key),
      ...globalFlags.map((f) => f.key),
    ]);

    const flags = [...keys]
      .sort()
      .map((key) => {
        const known = KNOWN_FLAGS.find((f) => f.key === key);
        const globalRow = globalByKey.get(key);
        const globalEnabled = globalRow?.enabled ?? known?.enabled ?? false;
        const description = globalRow?.description ?? known?.description ?? null;
        const ov = overrideByKey.get(key);
        const hasOverride = ov !== undefined;
        return {
          key,
          description,
          globalEnabled,
          override: hasOverride ? ov!.enabled : null,
          effective: hasOverride ? ov!.enabled : globalEnabled,
          source: hasOverride ? ('override' as const) : ('inherited' as const),
          updatedBy: hasOverride ? ov!.updatedBy : null,
          updatedAt: hasOverride ? ov!.updatedAt : null,
        };
      });

    return success({ team, flags });
  } catch (err) {
    console.error('Error fetching feature flag overrides:', err);
    return errors.internal('Failed to fetch feature flag overrides');
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const csrfErr = validateCSRF(request, { shadowMode: true });
    if (csrfErr) return csrfErr;

    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errors.badRequest('Malformed JSON body');
    }

    const { teamId, key, enabled } = body;
    if (!teamId || typeof teamId !== 'string') return errors.badRequest('teamId is required');
    if (!key || typeof key !== 'string') return errors.badRequest('key is required');
    if (typeof enabled !== 'boolean') return errors.badRequest('enabled must be a boolean');

    // Reject unknown flag keys. The GET response lists KNOWN_FLAGS ∪ FeatureFlag
    // rows, so persisting an override for any other key would create a row the
    // admin UI never shows (an invisible orphan that can't be cleared from here).
    const isKnownFlag =
      KNOWN_FLAGS.some((f) => f.key === key) ||
      (await prisma.featureFlag.findUnique({ where: { key }, select: { key: true } })) !== null;
    if (!isKnownFlag) return errors.badRequest(`Unknown feature flag key: ${key}`);

    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) return errors.notFound('Team');

    const override = await prisma.featureFlagOverride.upsert({
      where: { teamId_flagKey: { teamId, flagKey: key } },
      update: { enabled, updatedBy: auth.user.id },
      create: { teamId, flagKey: key, enabled, updatedBy: auth.user.id },
    });

    // Drop the short-TTL resolver cache so the override takes effect immediately.
    resetFeatureFlagOverrideCache();
    await audit(request, auth.user, 'feature_flag_override.set', { teamId, key, enabled });

    return success({ override });
  } catch (err) {
    console.error('Error setting feature flag override:', err);
    return errors.internal('Failed to set feature flag override');
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const csrfErr = validateCSRF(request, { shadowMode: true });
    if (csrfErr) return csrfErr;

    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errors.badRequest('Malformed JSON body');
    }

    const { teamId, key } = body;
    if (!teamId || typeof teamId !== 'string') return errors.badRequest('teamId is required');
    if (!key || typeof key !== 'string') return errors.badRequest('key is required');

    // Idempotent clear: deleteMany so removing an absent override is a no-op
    // success (the team already inherits the global value).
    const { count } = await prisma.featureFlagOverride.deleteMany({
      where: { teamId, flagKey: key },
    });

    resetFeatureFlagOverrideCache();
    await audit(request, auth.user, 'feature_flag_override.clear', { teamId, key, removed: count });

    return success({ cleared: count });
  } catch (err) {
    console.error('Error clearing feature flag override:', err);
    return errors.internal('Failed to clear feature flag override');
  }
}
