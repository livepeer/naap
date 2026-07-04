/**
 * Platform-admin Team Members API (`system:admin` only, flag-gated).
 *
 *   GET  /api/v1/admin/teams/{teamId}/members            — list a team's members
 *   POST /api/v1/admin/teams/{teamId}/members {email,role} — add a team member
 *
 * This is the explicit, least-surprising admin path for a platform admin to
 * bootstrap/support a team's billed flow WITHOUT being invited to the team or
 * touching the DB directly. POST performs the SAME membership creation as the
 * team-admin `inviteMember` flow (via the shared `adminAddMember` core, so the
 * row is identical) — the ONLY difference is the authorization source
 * (`system:admin` instead of team-admin).
 *
 * Guarded by the `admin_team_access` feature flag (default OFF): when OFF, BOTH
 * verbs return 404 (no-op), so this endpoint does not exist as far as callers are
 * concerned and there is zero behavior change. The flag can be enabled per-team
 * for a zero-blast-radius test. Enforces `system:admin` (checked BEFORE the flag
 * so a non-admin always gets 403), CSRF (consistent with other admin mutations),
 * and writes an audit row for every add.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { validateCSRF } from '@/lib/api/csrf';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { ADMIN_TEAM_ACCESS_FLAG, isFeatureEnabled } from '@/lib/feature-flags';
import { adminAddMember, listMembers, TeamRole } from '@/lib/api/teams';

interface RouteParams {
  params: Promise<{ teamId: string }>;
}

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
  teamId: string,
  details: Record<string, string | number | boolean | null>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: 'admin_team_member.add',
        resource: 'team',
        resourceId: teamId,
        userId: user.id,
        ipAddress:
          request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
        userAgent: request.headers.get('user-agent') || null,
        details,
        status: 'success',
      },
    });
  } catch (err) {
    console.error('[admin_team_member] audit write failed:', err);
  }
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { teamId } = await params;

    // Authorize BEFORE the flag so a non-admin always gets 403 (never leaks
    // whether the flag/endpoint is enabled).
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;

    // Flag gate: OFF ⇒ 404 no-op (endpoint does not exist).
    if (!(await isFeatureEnabled(ADMIN_TEAM_ACCESS_FLAG, teamId))) {
      return errors.notFound('Resource');
    }

    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) return errors.notFound('Team');

    const searchParams = request.nextUrl.searchParams;
    const skip = parseInt(searchParams.get('skip') || '0', 10);
    const take = parseInt(searchParams.get('take') || '50', 10);

    const members = await listMembers(teamId, { skip, take });
    return success({ members });
  } catch (err) {
    console.error('Error listing team members (admin):', err);
    return errors.internal('Failed to list members');
  }
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { teamId } = await params;

    // CSRF first (consistent with other admin mutations).
    const csrfErr = validateCSRF(request, { shadowMode: true });
    if (csrfErr) return csrfErr;

    // Authorize BEFORE the flag so a non-admin always gets 403.
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;

    // Flag gate: OFF ⇒ 404 no-op (never creates anything).
    if (!(await isFeatureEnabled(ADMIN_TEAM_ACCESS_FLAG, teamId))) {
      return errors.notFound('Resource');
    }

    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) return errors.notFound('Team');

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errors.badRequest('Malformed JSON body');
    }

    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const role = body.role;

    if (!email) {
      return errors.badRequest('Email is required');
    }

    // Match the team-admin members route exactly: owner cannot be assigned here.
    const validRoles: TeamRole[] = ['admin', 'member', 'viewer'];
    if (!validRoles.includes(role as TeamRole)) {
      return errors.badRequest('Invalid role. Must be admin, member, or viewer.');
    }

    const member = await adminAddMember(teamId, { email, role: role as TeamRole }, auth.user.id);

    // Mirror the team-admin invite flow so the resulting state is identical:
    // grant the new member access to every active team plugin.
    const teamPlugins = await prisma.teamPluginInstall.findMany({
      where: { teamId, status: 'active' },
      select: { id: true },
    });

    if (teamPlugins.length > 0) {
      await prisma.teamMemberPluginAccess.createMany({
        data: teamPlugins.map(install => ({
          memberId: member.id,
          pluginInstallId: install.id,
          visible: true,
          canUse: role !== 'viewer',
          canConfigure: ['owner', 'admin'].includes(role as string),
        })),
        skipDuplicates: true,
      });
    }

    await audit(request, auth.user, teamId, {
      memberId: member.id,
      targetUserId: member.userId,
      email,
      role: role as string,
    });

    return success({ member });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add member';

    if (message.includes('already a member')) {
      return errors.conflict(message);
    }
    if (message.includes('not found')) {
      return errors.notFound('User');
    }
    return errors.badRequest(message);
  }
}
