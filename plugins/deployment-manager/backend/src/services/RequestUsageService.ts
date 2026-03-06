export type InvokeOutcome = 'completed' | 'failed' | 'retried';

interface UsageEntry {
  deploymentId: string;
  outcome: InvokeOutcome;
  responseTimeMs: number;
  timestamp: number;
}

export interface UsageBucket {
  timestamp: number;
  completed: number;
  failed: number;
  retried: number;
}

export interface UsageStats {
  buckets: UsageBucket[];
  totalRequests: number;
  totalCompleted: number;
  totalFailed: number;
  totalRetried: number;
  avgResponseTimeMs: number;
}

const BUCKET_SIZE_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

class RequestUsageService {
  private entries: UsageEntry[] = [];

  record(deploymentId: string, outcome: InvokeOutcome, responseTimeMs: number): void {
    this.entries.push({ deploymentId, outcome, responseTimeMs, timestamp: Date.now() });
    this.prune();
  }

  getUsage(deploymentId: string, range: 'hour' | 'day'): UsageStats {
    const now = Date.now();
    const rangeMs = range === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const cutoff = now - rangeMs;

    const relevant = this.entries.filter(
      e => e.deploymentId === deploymentId && e.timestamp >= cutoff,
    );

    const bucketCount = Math.ceil(rangeMs / BUCKET_SIZE_MS);
    const bucketStart = now - bucketCount * BUCKET_SIZE_MS;

    const buckets: UsageBucket[] = [];
    for (let i = 0; i < bucketCount; i++) {
      buckets.push({
        timestamp: bucketStart + i * BUCKET_SIZE_MS,
        completed: 0,
        failed: 0,
        retried: 0,
      });
    }

    let totalResponseTime = 0;
    for (const entry of relevant) {
      const bucketIdx = Math.floor((entry.timestamp - bucketStart) / BUCKET_SIZE_MS);
      const bucket = buckets[bucketIdx];
      if (bucket) {
        bucket[entry.outcome]++;
      }
      totalResponseTime += entry.responseTimeMs;
    }

    const totalCompleted = relevant.filter(e => e.outcome === 'completed').length;
    const totalFailed = relevant.filter(e => e.outcome === 'failed').length;
    const totalRetried = relevant.filter(e => e.outcome === 'retried').length;

    return {
      buckets,
      totalRequests: relevant.length,
      totalCompleted,
      totalFailed,
      totalRetried,
      avgResponseTimeMs: relevant.length > 0 ? Math.round(totalResponseTime / relevant.length) : 0,
    };
  }

  private prune(): void {
    const cutoff = Date.now() - MAX_AGE_MS;
    this.entries = this.entries.filter(e => e.timestamp >= cutoff);
  }
}

export const usageService = new RequestUsageService();
