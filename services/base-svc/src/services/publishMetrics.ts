/**
 * Publish Metrics Service
 * Track and monitor publishing activity
 */

import { db } from '../db/client';

export interface PublishEvent {
  type: 'publish' | 'deprecate' | 'unpublish' | 'download' | 'install' | 'uninstall';
  packageName: string;
  version?: string;
  publisherId?: string;
  success: boolean;
  duration?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface MetricsSummary {
  period: string;
  publishes: number;
  downloads: number;
  installs: number;
  uninstalls: number;
  failures: number;
  topPackages: Array<{ name: string; downloads: number }>;
  topPublishers: Array<{ id: string; name: string; packages: number }>;
}

/**
 * Create publish metrics service
 */
export function createPublishMetrics() {
  // In-memory metrics buffer for batch writes
  const buffer: PublishEvent[] = [];
  const BUFFER_SIZE = 100;
  const FLUSH_INTERVAL = 30000; // 30 seconds

  // Periodic flush
  const flushInterval = setInterval(async () => {
    await flushBuffer();
  }, FLUSH_INTERVAL);

  async function flushBuffer() {
    if (buffer.length === 0) return;
    
    const events = buffer.splice(0, buffer.length);
    
    try {
      // Store in audit log for now
      // In production, this would go to a time-series database
      for (const event of events) {
        await db.auditLog.create({
          data: {
            action: `publish.${event.type}`,
            resource: 'plugin',
            resourceId: event.packageName,
            userId: event.publisherId,
            status: event.success ? 'success' : 'failure',
            errorMsg: event.error,
            details: {
              version: event.version,
              duration: event.duration,
              ...event.metadata,
            },
          },
        });
      }
    } catch (error) {
      console.error('Failed to flush metrics buffer:', error);
      // Re-add events to buffer on failure
      buffer.unshift(...events);
    }
  }

  return {
    /**
     * Record a publish event
     */
    async recordEvent(event: PublishEvent): Promise<void> {
      buffer.push({
        ...event,
        metadata: {
          ...event.metadata,
          timestamp: new Date().toISOString(),
        },
      });

      // Flush if buffer is full
      if (buffer.length >= BUFFER_SIZE) {
        await flushBuffer();
      }
    },

    /**
     * Record a successful publish
     */
    async recordPublish(
      packageName: string,
      version: string,
      publisherId?: string,
      duration?: number
    ): Promise<void> {
      await this.recordEvent({
        type: 'publish',
        packageName,
        version,
        publisherId,
        success: true,
        duration,
      });

      // Update package download count (for "new version" notifications)
      await db.pluginPackage.update({
        where: { name: packageName },
        data: { updatedAt: new Date() },
      }).catch(() => {});
    },

    /**
     * Record a failed publish
     */
    async recordPublishFailure(
      packageName: string,
      version: string,
      error: string,
      publisherId?: string
    ): Promise<void> {
      await this.recordEvent({
        type: 'publish',
        packageName,
        version,
        publisherId,
        success: false,
        error,
      });
    },

    /**
     * Record a download
     */
    async recordDownload(packageName: string, version?: string): Promise<void> {
      await this.recordEvent({
        type: 'download',
        packageName,
        version,
        success: true,
      });

      // Update download counts
      await db.pluginPackage.update({
        where: { name: packageName },
        data: { downloads: { increment: 1 } },
      }).catch(() => {});

      if (version) {
        const pkg = await db.pluginPackage.findUnique({ where: { name: packageName } });
        if (pkg) {
          await db.pluginVersion.updateMany({
            where: { packageId: pkg.id, version },
            data: { downloads: { increment: 1 } },
          }).catch(() => {});
        }
      }
    },

    /**
     * Record an installation
     */
    async recordInstall(packageName: string, version: string, userId?: string): Promise<void> {
      await this.recordEvent({
        type: 'install',
        packageName,
        version,
        publisherId: userId,
        success: true,
      });
    },

    /**
     * Record an uninstallation
     */
    async recordUninstall(packageName: string, userId?: string): Promise<void> {
      await this.recordEvent({
        type: 'uninstall',
        packageName,
        publisherId: userId,
        success: true,
      });
    },

    /**
     * Get metrics summary for a time period
     */
    async getSummary(
      period: '24h' | '7d' | '30d' = '7d'
    ): Promise<MetricsSummary> {
      const since = new Date();
      switch (period) {
        case '24h':
          since.setHours(since.getHours() - 24);
          break;
        case '7d':
          since.setDate(since.getDate() - 7);
          break;
        case '30d':
          since.setDate(since.getDate() - 30);
          break;
      }

      // Get event counts from audit log
      const events = await db.auditLog.groupBy({
        by: ['action', 'status'],
        where: {
          action: { startsWith: 'publish.' },
          createdAt: { gte: since },
        },
        _count: true,
      });

      let publishes = 0;
      let downloads = 0;
      let installs = 0;
      let uninstalls = 0;
      let failures = 0;

      for (const event of events) {
        const count = event._count;
        if (event.status === 'failure') {
          failures += count;
          continue;
        }

        switch (event.action) {
          case 'publish.publish':
            publishes += count;
            break;
          case 'publish.download':
            downloads += count;
            break;
          case 'publish.install':
            installs += count;
            break;
          case 'publish.uninstall':
            uninstalls += count;
            break;
        }
      }

      // Get top packages by downloads
      const topPackages = await db.pluginPackage.findMany({
        select: { name: true, downloads: true },
        orderBy: { downloads: 'desc' },
        take: 10,
      });

      // Get top publishers
      const publishers = await db.publisher.findMany({
        select: {
          id: true,
          name: true,
          _count: { select: { packages: true } },
        },
        orderBy: { packages: { _count: 'desc' } },
        take: 10,
      });

      return {
        period,
        publishes,
        downloads,
        installs,
        uninstalls,
        failures,
        topPackages: topPackages.map(p => ({
          name: p.name,
          downloads: p.downloads,
        })),
        topPublishers: publishers.map(p => ({
          id: p.id,
          name: p.name,
          packages: p._count.packages,
        })),
      };
    },

    /**
     * Get package-specific metrics
     */
    async getPackageMetrics(
      packageName: string,
      period: '24h' | '7d' | '30d' = '7d'
    ): Promise<{
      downloads: number;
      installs: number;
      versions: Array<{ version: string; downloads: number; publishedAt: Date }>;
      downloadsByDay: Array<{ date: string; count: number }>;
    }> {
      const since = new Date();
      switch (period) {
        case '24h':
          since.setHours(since.getHours() - 24);
          break;
        case '7d':
          since.setDate(since.getDate() - 7);
          break;
        case '30d':
          since.setDate(since.getDate() - 30);
          break;
      }

      const pkg = await db.pluginPackage.findUnique({
        where: { name: packageName },
        include: {
          versions: {
            select: {
              version: true,
              downloads: true,
              publishedAt: true,
            },
            orderBy: { publishedAt: 'desc' },
          },
        },
      });

      if (!pkg) {
        return {
          downloads: 0,
          installs: 0,
          versions: [],
          downloadsByDay: [],
        };
      }

      // Get download events
      const downloadEvents = await db.auditLog.findMany({
        where: {
          action: 'publish.download',
          resourceId: packageName,
          createdAt: { gte: since },
        },
        select: { createdAt: true },
      });

      // Group by day
      const byDay = new Map<string, number>();
      for (const event of downloadEvents) {
        const day = event.createdAt.toISOString().split('T')[0];
        byDay.set(day, (byDay.get(day) || 0) + 1);
      }

      // Get install events
      const installEvents = await db.auditLog.count({
        where: {
          action: 'publish.install',
          resourceId: packageName,
          createdAt: { gte: since },
        },
      });

      return {
        downloads: downloadEvents.length,
        installs: installEvents,
        versions: pkg.versions.map(v => ({
          version: v.version,
          downloads: v.downloads,
          publishedAt: v.publishedAt,
        })),
        downloadsByDay: Array.from(byDay.entries())
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      };
    },

    /**
     * Stop the metrics service
     */
    async stop(): Promise<void> {
      clearInterval(flushInterval);
      await flushBuffer();
    },
  };
}

// Export singleton
export const publishMetrics = createPublishMetrics();
