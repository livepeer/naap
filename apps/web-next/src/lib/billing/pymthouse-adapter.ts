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

import { getPmtHouseServerClient } from '@/lib/pymthouse-client';
import {
  AdapterNotImplementedError,
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

  async mintSignerSession(input: MintSignerSessionInput): Promise<SignerSessionToken> {
    const session = await getPmtHouseServerClient().mintSignerSessionForExternalUser({
      externalUserId: input.externalUserId,
      email: input.email,
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
