/**
 * Contract + seam-isolation tests for BPP ⑥ usage ingest (NAAP-2).
 *
 * The "contract test for ingest payload" required by the catalog:
 *  - sample payloads that pass the C0 JSON Schema also pass the runtime parser
 *    (and vice-versa), so the runtime never drifts from the contract;
 *  - provider-internal field names (⑨) are rejected on the seam, and the
 *    runtime FORBIDDEN list stays a superset of the contract's.
 */

import { describe, it, expect } from 'vitest';
import {
  compileAllSchemas,
  getForbiddenInternalFieldNames,
} from '@/lib/billing/bpp/conformance';
import {
  FORBIDDEN_INTERNAL_FIELDS,
  findLeakedInternalFields,
  parseUsageIngest,
} from './usage-ingest';

const schemaValidate = compileAllSchemas()['usage-ingest.schema.json'];

const validPayload = {
  providerSlug: 'pymthouse',
  accountId: 'acct_123',
  appId: 'app_sb',
  window: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T23:59:59.999Z' },
  sessions: 12,
  tickets: 340,
  feeWei: '1000000000000000',
  networkFeeUsdMicros: '4200000',
  byCapability: {
    'text-to-image:sdxl': { tickets: 300, networkFeeUsdMicros: '4000000' },
  },
};

describe('usage ingest — contract conformance', () => {
  it('a payload valid under the runtime parser is valid under the C0 schema', () => {
    const parsed = parseUsageIngest(validPayload);
    expect(parsed.ok).toBe(true);
    expect(schemaValidate(validPayload)).toBe(true);
  });

  it('the minimal required payload (providerSlug, accountId, window) conforms both ways', () => {
    const minimal = {
      providerSlug: 'stub',
      accountId: 'acct_min',
      window: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-02T00:00:00.000Z' },
    };
    expect(parseUsageIngest(minimal).ok).toBe(true);
    expect(schemaValidate(minimal)).toBe(true);
  });

  it('rejects unknown top-level fields both ways (strict / additionalProperties:false)', () => {
    const withExtra = { ...validPayload, somethingExtra: true };
    expect(schemaValidate(withExtra)).toBe(false);
    const parsed = parseUsageIngest(withExtra);
    expect(parsed.ok).toBe(false);
  });

  it('rejects a missing required field both ways', () => {
    const { accountId, ...noAccount } = validPayload;
    void accountId;
    expect(schemaValidate(noAccount)).toBe(false);
    expect(parseUsageIngest(noAccount).ok).toBe(false);
  });
});

describe('usage ingest — seam isolation (⑨ must not leak)', () => {
  it('runtime FORBIDDEN list is a superset of the contract list', () => {
    const contractList = getForbiddenInternalFieldNames();
    for (const name of contractList) {
      expect(FORBIDDEN_INTERNAL_FIELDS).toContain(name);
    }
  });

  it('detects provider-internal field names anywhere in the payload', () => {
    expect(findLeakedInternalFields({ openmeter_subscription_id: 'x' })).toContain(
      'openmeter_subscription_id',
    );
    expect(
      findLeakedInternalFields({ data: { nested: { network_fee_usd_micros: '1' } } }),
    ).toContain('network_fee_usd_micros');
  });

  it('rejects a leaked-field payload before shape validation', () => {
    const leaky = { ...validPayload, openmeter_subscription_id: '01J...' };
    const parsed = parseUsageIngest(leaky);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok && parsed.reason === 'leaked_internal_fields') {
      expect(parsed.leaked).toContain('openmeter_subscription_id');
    } else {
      throw new Error('expected leaked_internal_fields rejection');
    }
  });
});
