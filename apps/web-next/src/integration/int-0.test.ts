/** @vitest-environment node */

/**
 * INT-0 — BPP contract conformance (consolidated branch).
 *
 * Proves both providers' payloads validate against the C0 JSON Schemas and that
 * the provider-agnostic seam holds: no provider-internal (OpenMeter ⑨) field
 * names leak through ② validate / ⑥ usage. Runs against:
 *   - the C0 in-memory stub provider, and
 *   - a pymthouse MOCK (C0 shapes; neutral subscriptionRef per PR #149).
 *
 * No live secrets — stub + mock only.
 */

import { describe, it, expect } from 'vitest';

import { createStubBillingProvider } from '@/lib/billing/bpp/stub-provider';
import {
  compileAllSchemas,
  findLeakedInternalFields,
  getForbiddenInternalFieldNames,
  runConformance,
  validateAgainstBppSchema,
} from '@/lib/billing/bpp/conformance';
import { StubAdapter } from '@/lib/billing/stub-adapter';
import {
  PYMTHOUSE_MOCK_SUBSCRIPTION_REF,
  PymthouseMockAdapter,
  createPymthouseMockProvider,
} from './_mocks/pymthouse-mock';

describe('INT-0 — schema lint', () => {
  it('every BPP schema compiles (2020-12)', () => {
    expect(() => compileAllSchemas()).not.toThrow();
  });
});

describe('INT-0 — conformance: stub provider', () => {
  it('passes all BPP seams with no leaks and a consistent account ref', async () => {
    const report = await runConformance(createStubBillingProvider());
    expect(report.seams.every((s) => s.valid)).toBe(true);
    expect(report.leakedFields).toEqual([]);
    expect(report.accountRefMismatches).toEqual([]);
    expect(report.passed).toBe(true);
  });
});

describe('INT-0 — conformance: pymthouse mock', () => {
  it('passes all BPP seams with no OpenMeter leakage', async () => {
    const report = await runConformance(createPymthouseMockProvider());
    expect(report.passed).toBe(true);
    expect(report.leakedFields).toEqual([]);
    expect(report.accountRefMismatches).toEqual([]);
  });

  it('surfaces a NEUTRAL opaque subscriptionRef (PR #149), not an internal id', async () => {
    const v = (await createPymthouseMockProvider().validate('k')) as Record<string, unknown>;
    expect(v.subscriptionRef).toBe(PYMTHOUSE_MOCK_SUBSCRIPTION_REF);
    expect(JSON.stringify(v)).not.toMatch(/openmeter|konnect|source"\s*:\s*"openmeter/i);
  });
});

describe('INT-0 — seam isolation guard works', () => {
  it('catches a planted provider-internal field name', () => {
    const forbidden = getForbiddenInternalFieldNames();
    const leak = findLeakedInternalFields(
      { valid: true, openmeter_subscription_id: 'sub_123' },
      forbidden,
    );
    expect(leak).toContain('openmeter_subscription_id');
  });
});

describe('INT-0 — adapter validate() outputs conform to validate.schema.json', () => {
  it('stub adapter', async () => {
    const out = await new StubAdapter().validate('k');
    expect(validateAgainstBppSchema('validate', out).valid).toBe(true);
  });
  it('pymthouse mock adapter', async () => {
    const out = await new PymthouseMockAdapter().validate('k');
    const check = validateAgainstBppSchema('validate', out);
    expect(check.valid, JSON.stringify(check.errors)).toBe(true);
  });
});
