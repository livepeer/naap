import { NextResponse } from 'next/server';
/**
 * Get Team Role Permissions
 * GET /api/v1/teams/role-permissions
 */

import { getRolePermissions } from '@/lib/api/teams';
import { success } from '@/lib/api/response';

export async function GET(): Promise<NextResponse> {
  const permissions = getRolePermissions();
  return success({ permissions });
}
