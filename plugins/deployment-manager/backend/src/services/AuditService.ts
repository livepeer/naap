export interface AuditEntry {
  deploymentId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
  status: 'success' | 'failure';
  errorMsg?: string;
}

/**
 * Audit log service. In-memory store for now; will integrate with
 * Prisma DmDeploymentAuditLog in a later PR when the database
 * client is available.
 */
export class AuditService {
  private logs: (AuditEntry & { id: string; createdAt: Date })[] = [];

  async log(entry: AuditEntry): Promise<void> {
    const record = {
      ...entry,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    };
    this.logs.push(record);

    const level = entry.status === 'failure' ? 'warn' : 'info';
    console[level](
      `[audit] ${entry.action} ${entry.resource}${entry.resourceId ? `:${entry.resourceId}` : ''} by=${entry.userId} status=${entry.status}${entry.errorMsg ? ` error="${entry.errorMsg}"` : ''}`,
    );
  }

  async query(filters: {
    deploymentId?: string;
    userId?: string;
    action?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: (AuditEntry & { id: string; createdAt: Date })[]; total: number }> {
    let results = [...this.logs];

    if (filters.deploymentId) {
      results = results.filter((l) => l.deploymentId === filters.deploymentId);
    }
    if (filters.userId) {
      results = results.filter((l) => l.userId === filters.userId);
    }
    if (filters.action) {
      results = results.filter((l) => l.action === filters.action);
    }

    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = results.length;
    const offset = filters.offset || 0;
    const limit = filters.limit || 50;

    return {
      data: results.slice(offset, offset + limit),
      total,
    };
  }
}
