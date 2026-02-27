/**
 * Service Gateway — Usage Buffer
 *
 * Accumulates usage records in memory and flushes them to the database
 * in batches via `prisma.gatewayUsageRecord.createMany()`.
 *
 * Flush triggers:
 *  - 50 records accumulated
 *  - 5 seconds since last flush
 *  - 500 records (backpressure cap — immediate flush)
 *  - Process shutdown signal
 */

import { prisma } from '@/lib/db';
import type { UsageData } from './types';

const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 5_000;
const BACKPRESSURE_LIMIT = 500;

let buffer: UsageData[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function ensureTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    if (buffer.length > 0) flush();
  }, FLUSH_INTERVAL_MS);
  if (typeof flushTimer === 'object' && 'unref' in flushTimer) {
    flushTimer.unref();
  }
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    await prisma.gatewayUsageRecord.createMany({
      data: batch.map((d) => ({
        teamId: d.teamId,
        connectorId: d.connectorId,
        endpointName: d.endpointName,
        apiKeyId: d.apiKeyId,
        callerType: d.callerType,
        callerId: d.callerId,
        method: d.method,
        path: d.path,
        statusCode: d.statusCode,
        latencyMs: d.latencyMs,
        upstreamLatencyMs: d.upstreamLatencyMs,
        requestBytes: d.requestBytes,
        responseBytes: d.responseBytes,
        cached: d.cached,
        error: d.error,
        region: d.region,
      })),
    });
  } catch (err) {
    console.error('[gateway] batch usage write failed:', err);
  }
}

export function bufferUsage(data: UsageData): void {
  buffer.push(data);
  ensureTimer();
  if (buffer.length >= BACKPRESSURE_LIMIT) {
    flush();
  } else if (buffer.length >= BATCH_SIZE) {
    flush();
  }
}

export async function flushUsageBuffer(): Promise<void> {
  await flush();
}

if (typeof process !== 'undefined') {
  const shutdown = () => { flush(); };
  process.on('beforeExit', shutdown);
}
