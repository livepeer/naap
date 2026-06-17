/**
 * Tiny in-memory **stub billing provider** (C0).
 *
 * It is the *second* implementation of the Billing Provider Protocol (after the
 * reference provider, pymthouse). It exists only to prove the seam is
 * provider-neutral — it is NOT a real provider. Keep it minimal.
 *
 * Every method returns a payload that conforms to the matching BPP schema in
 * `contracts/billing-provider-protocol/`. The conformance suite validates it.
 */

export const STUB_PROVIDER_SLUG = 'stub';

/** The provider surface the BPP conformance suite exercises (② ④ ⑤ ⑥ ⑧). */
export interface BppConformanceProvider {
  readonly slug: string;
  /** ② validate */
  validate(key: string): Promise<unknown>;
  /** ④ plans */
  getPlans(): Promise<unknown>;
  /** ⑤ account + member + billingAccountRef */
  getAccount(): Promise<unknown>;
  /** ⑥ usage ingest payload */
  getUsageIngest(): Promise<unknown>;
  /** ⑧ curated list (+ optional token bundle) */
  getCuratedList(): Promise<unknown>;
}

export function createStubBillingProvider(): BppConformanceProvider {
  return {
    slug: STUB_PROVIDER_SLUG,

    async validate(key: string): Promise<unknown> {
      if (!key || key.length < 1) {
        return { valid: false };
      }
      return {
        valid: true,
        user: { sub: 'stub-user-1' },
        billing_account: {
          id: 'acct_stub_1',
          providerSlug: STUB_PROVIDER_SLUG,
          billingMode: 'delegated',
        },
        capabilities: ['text-to-image:sdxl', 'tool:byoc-demo'],
        quota: { remaining: 1000, resetAt: '2026-12-31T23:59:59.999Z' },
        // Neutral opaque pointer — never a provider-internal id name.
        subscriptionRef: 'sub_stub_opaque_1',
        signerSession: {
          url: 'https://signer.stub.example/session',
          headers: { Authorization: 'Bearer stub-signer-token' },
        },
      };
    },

    async getPlans(): Promise<unknown> {
      return [
        {
          id: 'free',
          name: 'Free',
          price: { amount: 0, interval: 'month', currency: 'USD' },
          bundles: [
            {
              capability: 'text-to-image:sdxl',
              sla: { uptime: 0.99, p95Ms: 3000 },
              maxPriceWeiPerUnit: '500',
            },
          ],
        },
      ];
    },

    async getAccount(): Promise<unknown> {
      return {
        account: {
          id: 'acct_stub_1',
          ownerSub: 'stub-user-1',
          providerSlug: STUB_PROVIDER_SLUG,
          planId: 'free',
          creditBalanceWei: '0',
          billingMode: 'delegated',
        },
        members: [{ accountId: 'acct_stub_1', sub: 'stub-user-1', role: 'admin' }],
        billingAccountRef: { providerSlug: STUB_PROVIDER_SLUG, accountId: 'acct_stub_1' },
      };
    },

    async getUsageIngest(): Promise<unknown> {
      return {
        providerSlug: STUB_PROVIDER_SLUG,
        accountId: 'acct_stub_1',
        appId: 'app_demo',
        window: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T23:59:59.999Z' },
        sessions: 3,
        tickets: 12,
        feeWei: '1000',
        networkFeeUsdMicros: '5000',
        byCapability: {
          'text-to-image:sdxl': { tickets: 12, networkFeeUsdMicros: '5000' },
        },
      };
    },

    async getCuratedList(): Promise<unknown> {
      return {
        plan: 'free',
        version: '2026-06-17T00:00:00.000Z',
        orchestrators: [
          {
            address: 'https://orch.stub.example:8935',
            capabilities: ['text-to-image:sdxl'],
            score: 0.9,
          },
        ],
      };
    },
  };
}
