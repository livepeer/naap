/**
 * Service Gateway — Admin Audit Logger
 *
 * Records admin operations (connector CRUD, secret management, key
 * management) to the AuditLog table for compliance and debugging.
 * Writes are non-blocking to avoid slowing admin responses.
 */

import { prisma } from '@/lib/db';
import type { AdminContext } from './team-guard';

export type AuditAction =
  | 'connector.create'
  | 'connector.update'
  | 'connector.delete'
  | 'connector.publish'
  | 'endpoint.create'
  | 'endpoint.update'
  | 'endpoint.delete'
  | 'secret.set'
  | 'secret.delete'
  | 'key.create'
  | 'key.revoke'
  | 'key.rotate'
  | 'plan.create'
  | 'plan.delete';

interface AuditEntry {
  action: AuditAction;
  resourceId?: string;
  details?: Record<string, unknown>;
  request?: Request;
}

export function logAudit(ctx: AdminContext, entry: AuditEntry): void {
  const ipAddress = entry.request?.headers.get('x-forwarded-for')
    || entry.request?.headers.get('x-real-ip')
    || null;
  const userAgent = entry.request?.headers.get('user-agent') || null;

  prisma.auditLog.create({
    data: {
      action: entry.action,
      resource: 'service-gateway',
      resourceId: entry.resourceId,
      userId: ctx.userId,
      ipAddress,
      userAgent,
      details: {
        scope: ctx.teamId,
        ...entry.details,
      },
      status: 'success',
    },
  }).catch((err) => {
    console.error('[gateway] audit log write failed:', err);
  });
}
