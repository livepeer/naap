/**
 * Pymthouse MOCK — used by INT-0 / INT-G (no live staging secrets).
 *
 * Models the reference provider's BPP surface using the **C0 contract shapes**
 * only. Crucially it returns a NEUTRAL opaque `subscriptionRef` (the shape
 * pymthouse PR #149 standardized on) and NEVER leaks provider-internal
 * OpenMeter fields (`openmeter_subscription_id`, `source:"openmeter"`, …) across
 * the seam — exactly what the BPP requires of the real provider.
 *
 * Two faces:
 *   - `createPymthouseMockProvider()` → a `BppConformanceProvider` for INT-0.
 *   - `PymthouseMockAdapter` → a `BillingProviderAdapter` for INT-G front-door
 *     resolution.
 */

import type { BppConformanceProvider } from '@/lib/billing/bpp/stub-provider';
import {
  type AppUsageInput,
  type BillingProviderAdapter,
  type Capability,
  type CuratedOrchestrator,
  type MintSignerSessionInput,
  type Plan,
  type SignerSession,
  type UsageForExternalUserInput,
  type ValidateResult,
} from '@/lib/billing/adapter';

export const PYMTHOUSE_MOCK_SLUG = 'pymthouse';

/** Neutral opaque subscription pointer (pymthouse PR #149 `subscriptionRef`). */
export const PYMTHOUSE_MOCK_SUBSCRIPTION_REF = 'pmthsub_2x9neutralopaque';

const MOCK_CAPABILITIES = ['text-to-image:sdxl', 'text-to-video:ltx', 'tool:byoc-demo'];

/** C0-shaped ② validate payload — neutral, no OpenMeter field names. */
function validatePayload(valid: boolean): Record<string, unknown> {
  if (!valid) return { valid: false };
  return {
    valid: true,
    user: { sub: 'pmth-user-42' },
    billing_account: {
      id: 'acct_pmth_1',
      providerSlug: PYMTHOUSE_MOCK_SLUG,
      billingMode: 'delegated',
    },
    capabilities: MOCK_CAPABILITIES,
    quota: { remaining: 5000, resetAt: '2026-12-31T23:59:59.999Z' },
    // PR #149: neutral opaque pointer — NOT openmeter_subscription_id.
    subscriptionRef: PYMTHOUSE_MOCK_SUBSCRIPTION_REF,
    signerSession: {
      url: 'https://signer.staging.pymthouse.com/session',
      headers: { Authorization: 'Bearer pmth-mock-signer-token' },
    },
  };
}

/** A BppConformanceProvider (INT-0) backed by C0 shapes. */
export function createPymthouseMockProvider(): BppConformanceProvider {
  return {
    slug: PYMTHOUSE_MOCK_SLUG,
    async validate(key: string) {
      return validatePayload(Boolean(key));
    },
    async getPlans() {
      return [
        {
          id: 'pro',
          name: 'Pro',
          price: { amount: 4900, interval: 'month', currency: 'USD' },
          bundles: [
            { capability: 'text-to-image:sdxl', sla: { uptime: 0.995, p95Ms: 2500 }, maxPriceWeiPerUnit: '1000' },
            { capability: 'text-to-video:ltx', sla: { uptime: 0.99, p95Ms: 8000 }, maxPriceWeiPerUnit: '5000' },
          ],
        },
      ];
    },
    async getAccount() {
      return {
        account: {
          id: 'acct_pmth_1',
          ownerSub: 'pmth-user-42',
          providerSlug: PYMTHOUSE_MOCK_SLUG,
          planId: 'pro',
          creditBalanceWei: '0',
          billingMode: 'delegated',
        },
        members: [{ accountId: 'acct_pmth_1', sub: 'pmth-user-42', role: 'admin' }],
        billingAccountRef: { providerSlug: PYMTHOUSE_MOCK_SLUG, accountId: 'acct_pmth_1' },
      };
    },
    async getUsageIngest() {
      // C0 ⑥ neutral usage — raw OpenMeter field names must NOT appear.
      return {
        providerSlug: PYMTHOUSE_MOCK_SLUG,
        accountId: 'acct_pmth_1',
        appId: 'app-storyboard',
        window: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T23:59:59.999Z' },
        sessions: 21,
        tickets: 480,
        feeWei: '123456789',
        networkFeeUsdMicros: '210000',
        byCapability: {
          'text-to-image:sdxl': { tickets: 400, networkFeeUsdMicros: '180000' },
          'text-to-video:ltx': { tickets: 80, networkFeeUsdMicros: '30000' },
        },
      };
    },
    async getCuratedList() {
      return {
        plan: 'pro',
        version: '2026-06-17T00:00:00.000Z',
        orchestrators: [
          { address: 'https://orch.staging.pymthouse.com:8935', capabilities: MOCK_CAPABILITIES, score: 0.95 },
        ],
      };
    },
  };
}

/** A BillingProviderAdapter (INT-G) backed by the same C0 shapes. */
export class PymthouseMockAdapter implements BillingProviderAdapter {
  readonly slug = PYMTHOUSE_MOCK_SLUG;
  isConfigured(): boolean {
    return true;
  }
  async validate(key: string): Promise<ValidateResult> {
    return validatePayload(Boolean(key)) as unknown as ValidateResult;
  }
  async getPlans(): Promise<Plan[]> {
    return (await createPymthouseMockProvider().getPlans()) as Plan[];
  }
  async getUsageForExternalUser(input: UsageForExternalUserInput): Promise<unknown> {
    return { externalUserId: input.externalUserId, period: { start: input.startDate, end: input.endDate }, requestCount: 120 };
  }
  async getAppUsage(input: AppUsageInput): Promise<unknown> {
    return { period: { start: input.startDate, end: input.endDate }, totals: { requestCount: 480 } };
  }
  async mintSignerSession(_input: MintSignerSessionInput): Promise<SignerSession> {
    return { url: 'https://signer.staging.pymthouse.com/session', headers: { Authorization: 'Bearer pmth-mock-signer-token' } };
  }
  async receiveCuratedOrchestrators(_plan: string, _list: CuratedOrchestrator[]): Promise<void> {
    /* no-op mock */
  }
  async getCapabilityManifest(): Promise<Capability[]> {
    return MOCK_CAPABILITIES.map((id) => ({ id }));
  }
}
