/**
 * In-memory stub billing provider adapter (NAAP-A).
 *
 * The second adapter in the registry — it proves the SPI is provider-neutral
 * (the Phase 0 gate requires the registry to resolve ≥2 providers). Tiny and
 * canned by design; it is NOT a real provider.
 */

import {
  type AppUsageInput,
  type BillingProviderAdapter,
  type Capability,
  type CuratedOrchestrator,
  type MintSignerSessionInput,
  type Plan,
  type SignerSessionToken,
  type UsageForExternalUserInput,
  type ValidateResult,
} from './adapter';

export const STUB_ADAPTER_SLUG = 'stub';

export class StubAdapter implements BillingProviderAdapter {
  readonly slug = STUB_ADAPTER_SLUG;

  isConfigured(): boolean {
    return true;
  }

  async validate(key: string): Promise<ValidateResult> {
    if (!key) return { valid: false };
    return {
      valid: true,
      user: { sub: 'stub-user-1' },
      billing_account: {
        id: 'acct_stub_1',
        providerSlug: this.slug,
        billingMode: 'delegated',
      },
      capabilities: ['text-to-image:sdxl'],
      quota: { remaining: 1000, resetAt: '2026-12-31T23:59:59.999Z' },
      subscriptionRef: 'sub_stub_opaque_1',
    };
  }

  async getPlans(): Promise<Plan[]> {
    return [
      {
        id: 'free',
        name: 'Free',
        price: { amount: 0, interval: 'month', currency: 'USD' },
        bundles: [{ capability: 'text-to-image:sdxl' }],
      },
    ];
  }

  async getUsageForExternalUser(input: UsageForExternalUserInput): Promise<unknown> {
    return {
      externalUserId: input.externalUserId,
      period: { start: input.startDate, end: input.endDate },
      requestCount: 0,
    };
  }

  async getAppUsage(input: AppUsageInput): Promise<unknown> {
    return {
      period: { start: input.startDate, end: input.endDate },
      totals: { requestCount: 0 },
    };
  }

  async mintSignerSession(_input: MintSignerSessionInput): Promise<SignerSessionToken> {
    return {
      accessToken: 'stub-signer-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
      scope: 'sign:job',
    };
  }

  async receiveCuratedOrchestrators(
    _plan: string,
    _list: CuratedOrchestrator[],
  ): Promise<void> {
    // no-op for the in-memory stub
  }

  async getCapabilityManifest(): Promise<Capability[]> {
    return [{ id: 'text-to-image:sdxl', description: 'Stub capability' }];
  }
}
