/** @vitest-environment node */

import { describe, it, expect } from 'vitest';

import { createStubBillingProvider, type BppConformanceProvider } from './stub-provider';
import {
  ALL_SCHEMA_FILES,
  compileAllSchemas,
  getForbiddenInternalFieldNames,
  findLeakedInternalFields,
  runConformance,
} from './conformance';

describe('BPP contracts', () => {
  it('every schema file compiles (schema lint)', () => {
    const compiled = compileAllSchemas();
    expect(Object.keys(compiled)).toEqual([...ALL_SCHEMA_FILES]);
    for (const file of ALL_SCHEMA_FILES) {
      expect(typeof compiled[file]).toBe('function');
    }
  });

  it('declares forbidden provider-internal field names (⑨ seam isolation)', () => {
    const forbidden = getForbiddenInternalFieldNames();
    expect(forbidden).toContain('openmeter_subscription_id');
    expect(forbidden).toContain('network_fee_usd_micros');
  });
});

describe('BPP conformance — stub provider', () => {
  it('passes every BPP seam and the seam-isolation assertion', async () => {
    const report = await runConformance(createStubBillingProvider());
    const failing = report.seams.filter((s) => !s.valid);
    expect(failing, JSON.stringify(failing, null, 2)).toHaveLength(0);
    expect(report.leakedFields).toEqual([]);
    expect(report.accountRefMismatches).toEqual([]);
    expect(report.passed).toBe(true);
  });
});

describe('BPP conformance — negative cases (the suite catches drift)', () => {
  it('fails schema validation when validate returns the wrong shape', async () => {
    const broken: BppConformanceProvider = {
      ...createStubBillingProvider(),
      // `valid` must be a boolean; a string violates the schema.
      async validate() {
        return { valid: 'yes' };
      },
    };
    const report = await runConformance(broken);
    expect(report.passed).toBe(false);
    expect(report.seams.find((s) => s.seam === 'validate')?.valid).toBe(false);
  });

  it('fails seam isolation when a provider-internal id leaks through validate', async () => {
    const leaky: BppConformanceProvider = {
      ...createStubBillingProvider(),
      async validate(key: string) {
        const base = (await createStubBillingProvider().validate(key)) as Record<string, unknown>;
        return { ...base, openmeter_subscription_id: '01J-leaky' };
      },
    };
    const report = await runConformance(leaky);
    expect(report.leakedFields).toContain('openmeter_subscription_id');
    expect(report.passed).toBe(false);
  });

  it('fails seam isolation when a provider-internal id leaks through usage ingest (⑥)', async () => {
    const leaky: BppConformanceProvider = {
      ...createStubBillingProvider(),
      async getUsageIngest() {
        const base = (await createStubBillingProvider().getUsageIngest()) as Record<
          string,
          unknown
        >;
        return { ...base, openmeter_subscription_id: '01J-usage-leak' };
      },
    };
    const report = await runConformance(leaky);
    expect(report.leakedFields).toContain('openmeter_subscription_id');
    expect(report.passed).toBe(false);
  });

  it('fails when account.id diverges from billingAccountRef.accountId (⑤ identity)', async () => {
    const mismatched: BppConformanceProvider = {
      ...createStubBillingProvider(),
      async getAccount() {
        const base = (await createStubBillingProvider().getAccount()) as Record<string, unknown>;
        return {
          ...base,
          billingAccountRef: { providerSlug: 'stub', accountId: 'acct_DIFFERENT' },
        };
      },
    };
    const report = await runConformance(mismatched);
    expect(report.accountRefMismatches.length).toBeGreaterThan(0);
    expect(report.passed).toBe(false);
  });

  it('findLeakedInternalFields detects nested leaks', () => {
    const forbidden = getForbiddenInternalFieldNames();
    const leaked = findLeakedInternalFields(
      { window: { from: 'x' }, meta: { source: 'openmeter', model_id: 'm' } },
      forbidden,
    );
    expect(leaked).toContain('model_id');
  });
});
