/**
 * Reference billing provider adapter: pymthouse (NAAP-A).
 *
 * Wraps the existing `getPmtHouseServerClient()` BEHIND the BillingProviderAdapter
 * SPI. This is the ONLY place that may import the pymthouse client; all other NaaP
 * code goes through the adapter + registry. Methods the NaaP side does not yet
 * support (BPP validate/plans/curation/manifest — PYMT-3/5/7 pending) throw
 * AdapterNotImplementedError rather than fabricating a response.
 */

import 'server-only';

import { isPymthouseConfigured } from '@pymthouse/builder-sdk/config';

import type { MeScopeUsagePayload, UsageApiResponse } from '@pymthouse/builder-sdk';

import {
  getPmtHouseServerClient,
  mintSignerSessionForExternalUserCompat,
} from '@/lib/pymthouse-client';
import {
  AdapterNotImplementedError,
  type AppUsageInput,
  type BillingProviderAdapter,
  type Capability,
  type CuratedOrchestrator,
  type MintSignerSessionInput,
  type Plan,
  type ProviderSpendRecord,
  type ProviderSpendResult,
  type ProviderSpendScope,
  type SignerSessionToken,
  type UsageForExternalUserInput,
  type ValidateResult,
} from './adapter';

export const PYMTHOUSE_ADAPTER_SLUG = 'pymthouse';

export class PymthouseAdapter implements BillingProviderAdapter {
  readonly slug = PYMTHOUSE_ADAPTER_SLUG;

  isConfigured(): boolean {
    return isPymthouseConfigured();
  }

  async validate(_key: string): Promise<ValidateResult> {
    // BPP ② validate is provider-side (PYMT-3) and not yet C0-shaped on the NaaP
    // side; do not fabricate identity/capabilities here.
    throw new AdapterNotImplementedError(this.slug, 'validate');
  }

  async getPlans(): Promise<Plan[]> {
    throw new AdapterNotImplementedError(this.slug, 'getPlans');
  }

  async getUsageForExternalUser(input: UsageForExternalUserInput): Promise<unknown> {
    return getPmtHouseServerClient().fetchUsageForExternalUser({
      externalUserId: input.externalUserId,
      startDate: input.startDate,
      endDate: input.endDate,
      ...(input.maxEndUserIds != null ? { maxEndUserIds: input.maxEndUserIds } : {}),
    });
  }

  async getAppUsage(input: AppUsageInput): Promise<unknown> {
    return getPmtHouseServerClient().getUsage({
      startDate: input.startDate,
      endDate: input.endDate,
      ...(input.groupBy ? { groupBy: input.groupBy } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
    });
  }

  /**
   * Dashboard PULL: fetch pymthouse spend live via the M2M client and map the
   * SDK response into neutral `ProviderSpendRecord`s. Provider-internal wire
   * shapes never escape this method.
   *
   *  - Scoped (`accountId` present): `fetchUsageForExternalUser` is bound to that
   *    one external user, so pymthouse itself enforces the tenant boundary — we
   *    never even receive another tenant's usage. Yields one record with a
   *    per-pipeline/model `byCapability` rollup.
   *  - App-wide (`accountId` omitted): `getUsage(groupBy=user)` returns one row
   *    per app user, mapped to one record each (route layer restricts app-wide
   *    pulls to system:admin).
   */
  async getSpend(scope: ProviderSpendScope): Promise<ProviderSpendResult> {
    const client = getPmtHouseServerClient();

    if (scope.accountId) {
      const payload: MeScopeUsagePayload = await client.fetchUsageForExternalUser({
        externalUserId: scope.accountId,
        startDate: scope.startDate,
        endDate: scope.endDate,
      });
      return { records: [this.mapMeScopePayload(scope.accountId, payload)] };
    }

    const usage: UsageApiResponse = await client.getUsage({
      startDate: scope.startDate,
      endDate: scope.endDate,
      groupBy: 'user',
    });
    return {
      source: usage.source,
      records: this.mapAppUsage(usage),
    };
  }

  /** Map a per-external-user payload → one neutral record (with capability rollup). */
  private mapMeScopePayload(
    accountId: string,
    payload: MeScopeUsagePayload,
  ): ProviderSpendRecord {
    const u = payload.currentUser;
    const byCapability: Record<string, { tickets?: number; networkFeeUsdMicros?: string }> = {};
    for (const row of u.pipelineModels ?? []) {
      // Key by pipeline:model so the dashboard can break spend down by capability.
      byCapability[`${row.pipeline}:${row.modelId}`] = {
        tickets: row.requestCount,
        networkFeeUsdMicros: row.networkFeeUsdMicros,
      };
    }
    return {
      providerSlug: this.slug,
      accountId,
      appId: null,
      // pymthouse meters signed tickets per request; there is no separate session
      // count on this seam, so sessions stays 0 and tickets carries requestCount.
      sessions: 0,
      tickets: u.requestCount,
      // The fiat (USD-micros) usage path does not return wei; leave it null.
      feeWei: null,
      networkFeeUsdMicros: u.networkFeeUsdMicros,
      ...(Object.keys(byCapability).length > 0 ? { byCapability } : {}),
    };
  }

  /** Map an app-wide usage response → one neutral record per app user. */
  private mapAppUsage(usage: UsageApiResponse): ProviderSpendRecord[] {
    return (usage.byUser ?? []).map((row) => ({
      providerSlug: this.slug,
      // Unattributed rows roll up under "unknown" (matches the Usage API).
      accountId: row.externalUserId ?? row.endUserId ?? 'unknown',
      appId: null,
      sessions: 0,
      tickets: row.requestCount,
      feeWei: row.feeWei ?? null,
      networkFeeUsdMicros: row.networkFeeUsdMicros ?? null,
    }));
  }

  async mintSignerSession(input: MintSignerSessionInput): Promise<SignerSessionToken> {
    const session = await mintSignerSessionForExternalUserCompat({
      externalUserId: input.externalUserId,
      ...(input.email != null ? { email: input.email } : {}),
    });
    return {
      accessToken: session.accessToken,
      tokenType: session.tokenType,
      expiresIn: session.expiresIn,
      scope: session.scope,
    };
  }

  async receiveCuratedOrchestrators(
    _plan: string,
    _list: CuratedOrchestrator[],
  ): Promise<void> {
    throw new AdapterNotImplementedError(this.slug, 'receiveCuratedOrchestrators');
  }

  async getCapabilityManifest(): Promise<Capability[]> {
    throw new AdapterNotImplementedError(this.slug, 'getCapabilityManifest');
  }
}
