/**
 * Personal Plugin Config API Route
 * GET  - Get shared, personal, and merged config for current user
 * PUT  - Update personal config overrides for current user
 * DELETE - Reset personal config to team defaults
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateSession } from '@/lib/api/auth';
import { getTeamMember, hasRolePermission, type TeamRole } from '@/lib/api/teams';
import { getAuthToken, errors } from '@/lib/api/response';

interface RouteParams {
  params: Promise<{ teamId: string; installId: string }>;
}

const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'];

/**
 * Deep merge two objects, with override taking precedence
 */
function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const key of Object.keys(override)) {
    if (UNSAFE_KEYS.includes(key)) continue;
    if (
      override[key] !== null &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      base[key] !== null &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(
        base[key] as Record<string, unknown>,
        override[key] as Record<string, unknown>
      );
    } else {
      result[key] = override[key];
    }
  }

  return result;
}

// GET /api/v1/teams/[teamId]/members/me/plugins/[installId]/config
// Returns shared config, personal config, and merged result
export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { teamId, installId } = await params;

    // 1. Authenticate user
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }
    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    // 2. Validate user is a team member
    const member = await getTeamMember(teamId, user.id);
    if (!member) {
      return errors.forbidden('Not a member of this team');
    }

    // 3. Get the plugin installation
    const install = await prisma.teamPluginInstall.findFirst({
      where: { id: installId, teamId },
      include: {
        deployment: { include: { package: true } },
      },
    });

    if (!install) {
      return errors.notFound('Plugin installation');
    }

    // 4. Get user's plugin access to check canConfigure
    const access = await prisma.teamMemberPluginAccess.findUnique({
      where: {
        memberId_pluginInstallId: {
          memberId: member.id,
          pluginInstallId: installId,
        },
      },
    });

    // 5. Get personal config if exists
    const personalConfigRecord = await prisma.teamMemberPluginConfig.findUnique({
      where: {
        memberId_pluginInstallId: {
          memberId: member.id,
          pluginInstallId: installId,
        },
      },
    });

    const sharedConfig = (install.sharedConfig as Record<string, unknown>) || {};
    const personalConfig = (personalConfigRecord?.personalConfig as Record<string, unknown>) || {};
    const mergedConfig = deepMerge(sharedConfig, personalConfig);

    return NextResponse.json({
      success: true,
      data: {
        pluginInstallId: installId,
        packageName: install.deployment.package.name,
        displayName: install.deployment.package.displayName,
        sharedConfig,
        personalConfig,
        mergedConfig,
        canConfigure: access?.canConfigure ?? false,
        memberRole: member.role,
      },
    });
  } catch (error) {
    console.error('Error fetching personal config:', error);
    return errors.internal('Failed to fetch personal config');
  }
}

// PUT /api/v1/teams/[teamId]/members/me/plugins/[installId]/config
// Update personal config overrides
export async function PUT(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { teamId, installId } = await params;

    // 1. Authenticate user
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }
    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    // 2. Validate user is a team member
    const member = await getTeamMember(teamId, user.id);
    if (!member) {
      return errors.forbidden('Not a member of this team');
    }

    // 3. Check if user has configure permission
    const access = await prisma.teamMemberPluginAccess.findUnique({
      where: {
        memberId_pluginInstallId: {
          memberId: member.id,
          pluginInstallId: installId,
        },
      },
    });

    // Allow if user has canConfigure access, OR if they're admin/owner (can always configure)
    const canConfigure = access?.canConfigure || hasRolePermission(member.role as TeamRole, 'admin');
    if (!canConfigure) {
      return errors.forbidden('You do not have permission to configure this plugin');
    }

    // 4. Get the plugin installation
    const install = await prisma.teamPluginInstall.findFirst({
      where: { id: installId, teamId },
      include: {
        deployment: { include: { package: true } },
      },
    });

    if (!install) {
      return errors.notFound('Plugin installation');
    }

    // 5. Parse request body
    const body = await request.json();
    const { personalConfig } = body;

    if (personalConfig === undefined || typeof personalConfig !== 'object') {
      return errors.badRequest('personalConfig must be an object');
    }

    // 6. Upsert personal config
    const configRecord = await prisma.teamMemberPluginConfig.upsert({
      where: {
        memberId_pluginInstallId: {
          memberId: member.id,
          pluginInstallId: installId,
        },
      },
      update: {
        personalConfig,
      },
      create: {
        memberId: member.id,
        pluginInstallId: installId,
        personalConfig,
      },
    });

    const sharedConfig = (install.sharedConfig as Record<string, unknown>) || {};
    const mergedConfig = deepMerge(sharedConfig, personalConfig);

    return NextResponse.json({
      success: true,
      data: {
        pluginInstallId: installId,
        packageName: install.deployment.package.name,
        sharedConfig,
        personalConfig: configRecord.personalConfig,
        mergedConfig,
      },
      message: 'Personal config updated successfully',
    });
  } catch (error) {
    console.error('Error updating personal config:', error);
    return errors.internal('Failed to update personal config');
  }
}

// DELETE /api/v1/teams/[teamId]/members/me/plugins/[installId]/config
// Reset personal config to team defaults
export async function DELETE(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { teamId, installId } = await params;

    // 1. Authenticate user
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }
    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    // 2. Validate user is a team member
    const member = await getTeamMember(teamId, user.id);
    if (!member) {
      return errors.forbidden('Not a member of this team');
    }

    // 3. Delete personal config (if exists)
    await prisma.teamMemberPluginConfig.deleteMany({
      where: {
        memberId: member.id,
        pluginInstallId: installId,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Personal config reset to team defaults',
    });
  } catch (error) {
    console.error('Error resetting personal config:', error);
    return errors.internal('Failed to reset personal config');
  }
}
