/**
 * BPP ⑥ usage ingest — runtime validation + seam isolation (NAAP-2).
 *
 * Providers push a NEUTRAL usage payload to
 * `POST {NAAP_METRICS_URL}/api/v1/metrics/ingest`. This is the authoritative
 * cross-provider usage path (NOT `validate`). NaaP must never learn about a
 * provider's internal metering (e.g. OpenMeter): provider-internal field names
 * (BPP ⑨) must never appear on this seam.
 *
 * The zod schema mirrors `contracts/billing-provider-protocol/usage-ingest.schema.json`
 * (the C0 contract); a conformance test asserts they stay in sync.
 */

import { z } from 'zod';

const decimalString = z.string().regex(/^[0-9]+$/, 'must be a non-negative integer string');

const capabilityUsageSchema = z
  .object({
    tickets: z.number().int().min(0).optional(),
    networkFeeUsdMicros: decimalString.optional(),
  })
  .strict();

/** Neutral usage payload (BPP ⑥). `additionalProperties: false` → `.strict()`. */
export const usageIngestSchema = z
  .object({
    providerSlug: z.string().min(1),
    accountId: z.string().min(1),
    appId: z.string().min(1).optional(),
    window: z
      .object({
        from: z.string().datetime({ offset: true }),
        to: z.string().datetime({ offset: true }),
      })
      .strict(),
    sessions: z.number().int().min(0).optional(),
    tickets: z.number().int().min(0).optional(),
    feeWei: decimalString.optional(),
    networkFeeUsdMicros: decimalString.optional(),
    byCapability: z.record(z.string(), capabilityUsageSchema).optional(),
  })
  .strict();

export type UsageIngestPayload = z.infer<typeof usageIngestSchema>;

/**
 * Provider-internal field names that MUST NOT leak through the BPP seam (⑨).
 * Kept in sync with `provider-internal-openmeter.schema.json`'s
 * `x-bpp-forbidden-field-names` (asserted by the conformance test).
 */
export const FORBIDDEN_INTERNAL_FIELDS: readonly string[] = [
  'openmeter_subscription_id',
  'openmeter_customer_id',
  'network_fee_usd_micros',
  'fee_wei',
  'eth_usd_price',
  'eth_usd_round_id',
  'eth_usd_observed_at',
  'external_user_id',
  'client_id',
  'model_id',
  'gateway_request_id',
  'specversion',
];

const FORBIDDEN_SET = new Set(FORBIDDEN_INTERNAL_FIELDS);

/** Recursively collect any provider-internal field names present in the payload. */
export function findLeakedInternalFields(value: unknown, acc: Set<string> = new Set()): string[] {
  if (Array.isArray(value)) {
    for (const item of value) findLeakedInternalFields(item, acc);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_SET.has(key)) acc.add(key);
      findLeakedInternalFields(child, acc);
    }
  }
  return [...acc];
}

export type ParseUsageIngestResult =
  | { ok: true; data: UsageIngestPayload }
  | { ok: false; reason: 'leaked_internal_fields'; leaked: string[] }
  | { ok: false; reason: 'invalid'; errors: Record<string, string> };

/**
 * Validate a raw ingest payload: reject provider-internal leaks first (seam
 * isolation), then validate the neutral shape.
 */
export function parseUsageIngest(payload: unknown): ParseUsageIngestResult {
  const leaked = findLeakedInternalFields(payload);
  if (leaked.length > 0) {
    return { ok: false, reason: 'leaked_internal_fields', leaked };
  }

  const parsed = usageIngestSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid',
      errors: Object.fromEntries(parsed.error.errors.map((e) => [e.path.join('.'), e.message])),
    };
  }
  return { ok: true, data: parsed.data };
}
