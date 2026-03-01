/**
 * Service Gateway — Usage Buffer
 *
 * Records gateway usage to the database. Supports two modes:
 *   - Serverless (Vercel): writes each record immediately in the background
 *   - Long-lived (local dev): batches records and flushes periodically
 *
 * Environment detection is automatic — no configuration needed.
 */

import { prisma } from '@/lib/db';
import type { UsageData } from './types';

const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 5_000;
const BACKPRESSURE_LIMIT = 500;
const MAX_RETRIES = 2;

let buffer: UsageData[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function toDbRecord(d: UsageData) {
  return {
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
  };
}

async function writeOne(data: UsageData): Promise<void> {
  try {
    await prisma.gatewayUsageRecord.create({ data: toDbRecord(data) });
  } catch (err) {
    console.error('[gateway] usage write failed:', err);
  }
}

function ensureTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    if (buffer.length > 0) flush();
  }, FLUSH_INTERVAL_MS);
  if (typeof flushTimer === 'object' && 'unref' in flushTimer) {
    flushTimer.unref();
  }
}

async function flush(retryCount = 0): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    await prisma.gatewayUsageRecord.createMany({
      data: batch.map(toDbRecord),
    });
  } catch (err) {
    console.error('[gateway] batch usage write failed:', err);
    if (retryCount < MAX_RETRIES && buffer.length + batch.length < BACKPRESSURE_LIMIT) {
      buffer.unshift(...batch);
    } else {
      console.error(`[gateway] dropping ${batch.length} usage records after ${retryCount} retries`);
    }
  }
}

/**
 * Record a usage event. In serverless mode, writes immediately (fire-and-forget).
 * In local dev, accumulates in a buffer and flushes periodically.
 */
export function bufferUsage(data: UsageData): void {
  if (IS_SERVERLESS) {
    writeOne(data);
    return;
  }

  buffer.push(data);
  ensureTimer();
  if (buffer.length >= BACKPRESSURE_LIMIT || buffer.length >= BATCH_SIZE) {
    flush();
  }
}

export async function flushUsageBuffer(): Promise<void> {
  await flush();
}
