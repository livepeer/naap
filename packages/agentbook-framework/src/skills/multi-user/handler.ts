/**
 * Multi-User Access — Role-based access control for AgentBook.
 * Roles: owner (full access), bookkeeper (record expenses, no reports), viewer (read-only), cpa (read-only + notes)
 */

export type AgentBookRole = 'owner' | 'bookkeeper' | 'viewer' | 'cpa';

export interface AccessGrant {
  tenantId: string;
  userId: string;
  email: string;
  role: AgentBookRole;
}

export interface RolePermissions {
  canRecordExpenses: boolean;
  canCreateInvoices: boolean;
  canViewReports: boolean;
  canViewTax: boolean;
  canManageSettings: boolean;
  canInviteUsers: boolean;
  canAddNotes: boolean;
  canExportData: boolean;
}

const ROLE_PERMISSIONS: Record<AgentBookRole, RolePermissions> = {
  owner: { canRecordExpenses: true, canCreateInvoices: true, canViewReports: true, canViewTax: true, canManageSettings: true, canInviteUsers: true, canAddNotes: true, canExportData: true },
  bookkeeper: { canRecordExpenses: true, canCreateInvoices: true, canViewReports: false, canViewTax: false, canManageSettings: false, canInviteUsers: false, canAddNotes: false, canExportData: false },
  viewer: { canRecordExpenses: false, canCreateInvoices: false, canViewReports: true, canViewTax: true, canManageSettings: false, canInviteUsers: false, canAddNotes: false, canExportData: false },
  cpa: { canRecordExpenses: false, canCreateInvoices: false, canViewReports: true, canViewTax: true, canManageSettings: false, canInviteUsers: false, canAddNotes: true, canExportData: true },
};

export function getPermissions(role: AgentBookRole): RolePermissions {
  return ROLE_PERMISSIONS[role];
}

export async function grantAccess(grant: AccessGrant, db: any): Promise<any> {
  return db.abTenantAccess.upsert({
    where: { tenantId_userId: { tenantId: grant.tenantId, userId: grant.userId } },
    update: { role: grant.role, email: grant.email },
    create: { tenantId: grant.tenantId, userId: grant.userId, email: grant.email, role: grant.role },
  });
}

export async function revokeAccess(tenantId: string, userId: string, db: any): Promise<void> {
  await db.abTenantAccess.deleteMany({ where: { tenantId, userId } });
}

export async function generateCPALink(tenantId: string, cpaEmail: string, db: any): Promise<string> {
  const token = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30-day expiry

  await db.abTenantAccess.create({
    data: {
      tenantId,
      userId: `cpa-${token.slice(0, 8)}`,
      email: cpaEmail,
      role: 'cpa',
      accessToken: token,
      expiresAt,
    },
  });

  return token; // Frontend constructs URL: /agentbook/cpa?token=...
}

export async function validateCPAToken(token: string, db: any): Promise<{ tenantId: string; email: string } | null> {
  const access = await db.abTenantAccess.findUnique({ where: { accessToken: token } });
  if (!access || access.role !== 'cpa') return null;
  if (access.expiresAt && new Date() > access.expiresAt) return null;
  return { tenantId: access.tenantId, email: access.email };
}

export async function checkPermission(tenantId: string, userId: string, permission: keyof RolePermissions, db: any): Promise<boolean> {
  const access = await db.abTenantAccess.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
  });
  if (!access) return false;
  return ROLE_PERMISSIONS[access.role as AgentBookRole]?.[permission] ?? false;
}
