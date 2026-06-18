/**
 * BPP ⑥ usage ingest endpoint (NAAP-2).
 *
 *   POST /api/v1/metrics/ingest
 *
 * Any billing provider pushes a NEUTRAL usage payload here (sessions/tickets/
 * fees by account+app). This is the authoritative cross-provider usage path.
 *
 * Auth: a shared service token in the `Authorization: Bearer …` header, compared
 * against `NAAP_METRICS_INGEST_TOKEN` (timing-safe). Gated behind the
 * `usage_ingest` flag (default OFF) → 404 when OFF (no-op, zero regression).
 *
 * Seam isolation: provider-internal field names (BPP ⑨) are rejected — NaaP must
 * never learn a provider's internal metering shape. Never logs secrets/PII.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { randomUUID, timingSafeEqual } from 'node:crypto';

import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { USAGE_INGEST_FLAG } from '@/lib/metrics/flags';
import { parseUsageIngest } from '@/lib/metrics/usage-ingest';

function correlationId(request: NextRequest): string {
  return request.headers.get('x-request-id')?.trim() || randomUUID();
}

function log(level: 'info' | 'warn', event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'warn') console.warn(line);
  else console.info(line);
}

/** Timing-safe bearer-token check against NAAP_METRICS_INGEST_TOKEN. */
function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.NAAP_METRICS_INGEST_TOKEN;
  if (!expected) return false; // not configured → ingest stays closed
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return false;
  const provided = header.slice(7).trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!(await isFeatureEnabled(USAGE_INGEST_FLAG))) return errors.notFound('Resource');

  const cid = correlationId(request);

  if (!isAuthorized(request)) {
    log('warn', 'metrics.ingest.unauthorized', { correlationId: cid });
    return errors.unauthorized('Invalid ingest token');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.badRequest('Invalid JSON body');
  }

  const parsed = parseUsageIngest(body);
  if (!parsed.ok) {
    if (parsed.reason === 'leaked_internal_fields') {
      log('warn', 'metrics.ingest.seam_violation', { correlationId: cid, leaked: parsed.leaked });
      return errors.badRequest('Payload contains provider-internal fields', {
        leaked: parsed.leaked,
      });
    }
    return errors.validationError(parsed.errors);
  }

  const data = parsed.data;
  // Account-level records (no app) use an empty-string sentinel so they share a
  // single, de-duplicating row in the usage-window unique key (a NULL would be
  // treated as distinct on every retry).
  const appId = data.appId ?? '';
  const windowFrom = new Date(data.window.from);
  const windowTo = new Date(data.window.to);
  const values = {
    sessions: data.sessions ?? 0,
    tickets: data.tickets ?? 0,
    feeWei: data.feeWei ?? null,
    networkFeeUsdMicros: data.networkFeeUsdMicros ?? null,
    byCapability: data.byCapability ?? undefined,
  };

  // Idempotent on the usage-window natural key so a provider that retries a push
  // does not double-count. Backed by a UNIQUE index, this compiles to
  // INSERT ... ON CONFLICT DO UPDATE, which also covers concurrent retries. A
  // re-sent window overwrites with the latest values rather than inserting a
  // duplicate row.
  await prisma.providerUsageRecord.upsert({
    where: {
      providerUsageWindow: {
        providerSlug: data.providerSlug,
        accountId: data.accountId,
        appId,
        windowFrom,
        windowTo,
      },
    },
    create: {
      providerSlug: data.providerSlug,
      accountId: data.accountId,
      appId,
      windowFrom,
      windowTo,
      ...values,
    },
    update: {
      ...values,
      receivedAt: new Date(),
    },
  });

  log('info', 'metrics.ingest.accepted', {
    correlationId: cid,
    providerSlug: data.providerSlug,
    hasApp: Boolean(data.appId),
  });

  return success({ accepted: true });
}
