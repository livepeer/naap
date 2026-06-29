/**
 * Per-key provider binding (NAAP P2).
 *
 * Wires the P0 per-instance adapter + the P1 subscription model into LIVE key
 * resolution. Given a key's `subscriptionId` (+ owning `teamId`), it resolves
 * the subscription hop:
 *
 *     key → Subscription → ProviderInstance → per-instance adapter + accountId
 *
 * This is the ONLY new branch the front door / native-key resolver take. It is
 * reachable only when `multi_subscription` is ON AND the key has a non-null
 * `subscriptionId` (gated inside `resolveSubscriptionForKey`). Every other case —
 * flag OFF, null subscription, missing/inactive subscription, a subscription
 * that does not belong to the key's team, or an unresolved instance — returns
 * `{ mode: 'legacy' }`, so callers fall through to today's exact code path
 * (team `billingAccountRef` → global env adapter). Never hard-fails an existing
 * key; never logs secrets.
 */

import 'server-only';

import type { BillingAccountRef } from '@/lib/teams/billing-account-ref';
import type { BillingProviderAdapter } from './adapter';
import { resolveAdapterForProviderInstanceById } from './registry-db';
import {
  resolveSubscriptionForKey,
  type LegacyReason,
  type SubscriptionRecord,
} from './subscription';

/** Why a key fell back to the legacy (today's) resolution path. */
export type KeyBindingLegacyReason =
  | LegacyReason // flag_off | no_subscription | subscription_missing | subscription_inactive | error
  | 'team_mismatch' // subscription does not belong to the key's team (isolation)
  | 'instance_unresolved'; // no adapter could be resolved for the instance

export type KeyProviderBinding =
  | { mode: 'legacy'; reason: KeyBindingLegacyReason }
  | {
      mode: 'subscription';
      subscription: SubscriptionRecord;
      adapter: BillingProviderAdapter;
      billingAccountRef: BillingAccountRef;
    };

/**
 * Resolve the live provider binding for a key.
 *
 * Returns `subscription` mode ONLY when the multi-subscription model is ON, the
 * key links an active subscription that belongs to the key's team, and a
 * per-instance adapter resolves. The returned `billingAccountRef` uses the
 * instance's `adapterType` as the provider slug and the subscription's opaque
 * `accountId` — so capability resolution, the signer mint, and usage all scope
 * to {providerInstance, accountId} for that key. Any other outcome is `legacy`.
 */
export async function resolveKeyProviderBinding(key: {
  subscriptionId: string | null;
  teamId: string | null;
}): Promise<KeyProviderBinding> {
  // Flag evaluation (multi_subscription, provider_instances) resolves in the
  // key's OWN team scope so a per-team override enables the subscription hop for
  // that team only; a team with no override inherits today's global value.
  const sub = await resolveSubscriptionForKey({ subscriptionId: key.subscriptionId }, key.teamId);
  if (sub.mode === 'legacy') {
    return { mode: 'legacy', reason: sub.reason };
  }

  // Cross-tenant isolation: a key may only resolve its OWN team's subscription.
  if (!key.teamId || sub.subscription.teamId !== key.teamId) {
    return { mode: 'legacy', reason: 'team_mismatch' };
  }

  const adapterRes = await resolveAdapterForProviderInstanceById(
    sub.subscription.providerInstanceId,
    undefined,
    key.teamId,
  );
  if (!adapterRes.adapter) {
    // Unresolved instance → fall back to legacy (never hard-fail an existing key).
    return { mode: 'legacy', reason: 'instance_unresolved' };
  }

  return {
    mode: 'subscription',
    subscription: sub.subscription,
    adapter: adapterRes.adapter,
    billingAccountRef: {
      providerSlug: adapterRes.adapterType,
      accountId: sub.subscription.accountId,
    },
  };
}
