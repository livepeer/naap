/**
 * Get Team Role Permissions
 * GET /api/v1/teams/role-permissions
 */

import { getRolePermissions } from '@/lib/api/teams';
import { success } from '@/lib/api/response';

export async function GET() {
  const permissions = getRolePermissions();
  return success({ permissions });
}
