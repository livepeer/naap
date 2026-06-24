/**
 * Idempotent default-subscription backfill (NAAP P1).
 *
 * The P1 migration is a pure schema expand (no data writes), so existing keys
 * keep `subscriptionId = NULL` and resolve via today's path. This module is the
 * SEPARATE, explicitly-invoked, idempotent backfill an operator runs to seed the
 * default multi-app rows for the existing single-app deployment:
 *
 *   1. the global `PYMTHOUSE_*` env app  → one default `ProviderInstance`
 *      (`pymthouse-default`); config holds NON-SECRET params only, the M2M
 *      secret is referenced by `secretRef` (a SecretVault key), never inlined.
 *   2. each team bound to a pymthouse `billingAccountRef` → one default
 *      `Subscription` (providerInstanceId = default, accountId = the team's
 *      billing account id).
 *   3. that team's keys with a NULL `subscriptionId` → linked to the default
 *      subscription.
 *
 * Every step is idempotent (re-running creates/links nothing new) and additive —
 * it never changes a team's billing account or a key's provider resolution
 * (resolution only consults `subscriptionId` when `multi_subscription` is ON,
 * which is a later phase). Never logs the secret.
 */

import 'server-only';

import { readPymthouseEnv } from '@pymthouse/builder-sdk/config';

import { prisma } from '@/lib/db';
import { PYMTHOUSE_ADAPTER_SLUG } from './pymthouse-adapter';

/** Slug of the default pymthouse instance seeded from the global env app. */
export const DEFAULT_PYMTHOUSE_INSTANCE_SLUG = 'pymthouse-default';

/**
 * SecretVault key the default instance's `secretRef` points at. The backfill
 * does NOT write the secret value (operators provision it in the vault); it only
 * records the reference so the per-instance adapter can resolve it later.
 */
export const DEFAULT_PYMTHOUSE_SECRET_REF = 'pymthouse:default:m2m-secret';

export const SUBSCRIPTION_STATUS_ACTIVE = 'active';

export interface BackfillSubscriptionsResult {
  /** False when the global pymthouse env is not configured (nothing to seed). */
  ran: boolean;
  providerInstanceId: string | null;
  providerInstanceCreated: boolean;
  subscriptionsCreated: number;
  keysLinked: number;
}

/**
 * Run the idempotent default-subscription backfill. Safe to call repeatedly:
 * the second run reports 0 created / 0 linked. Returns counts for logging.
 */
export async function backfillDefaultSubscriptions(): Promise<BackfillSubscriptionsResult> {
  const env = readPymthouseEnv();
  if (!env) {
    // No global pymthouse app configured → nothing to backfill (no-op).
    return {
      ran: false,
      providerInstanceId: null,
      providerInstanceCreated: false,
      subscriptionsCreated: 0,
      keysLinked: 0,
    };
  }

  const { instanceId, created: providerInstanceCreated } =
    await ensureDefaultProviderInstance(env);

  const teams = await prisma.team.findMany({
    where: {
      billingAccountProviderSlug: PYMTHOUSE_ADAPTER_SLUG,
      billingAccountId: { not: null },
    },
    select: { id: true, billingAccountId: true },
  });

  let subscriptionsCreated = 0;
  let keysLinked = 0;

  for (const team of teams) {
    const accountId = team.billingAccountId;
    if (!accountId) {
      continue;
    }

    const subscriptionId = await ensureDefaultSubscription(team.id, instanceId, accountId);
    if (subscriptionId.created) {
      subscriptionsCreated += 1;
    }

    // Link only this team's UNLINKED keys; already-linked keys are left as-is.
    const linked = await prisma.devApiKey.updateMany({
      where: { teamId: team.id, subscriptionId: null },
      data: { subscriptionId: subscriptionId.id },
    });
    keysLinked += linked.count;
  }

  return {
    ran: true,
    providerInstanceId: instanceId,
    providerInstanceCreated,
    subscriptionsCreated,
    keysLinked,
  };
}

/**
 * Ensure the default `ProviderInstance` exists for the global env app. Stores
 * only NON-SECRET config; `secretRef` points at the vault key. Idempotent: an
 * existing row is reused untouched (operator edits are preserved).
 */
async function ensureDefaultProviderInstance(env: {
  issuerUrl: string;
  publicClientId: string;
  m2mClientId: string;
}): Promise<{ instanceId: string; created: boolean }> {
  const existing = await prisma.providerInstance.findUnique({
    where: { slug: DEFAULT_PYMTHOUSE_INSTANCE_SLUG },
    select: { id: true },
  });
  if (existing) {
    return { instanceId: existing.id, created: false };
  }

  const row = await prisma.providerInstance.create({
    data: {
      adapterType: PYMTHOUSE_ADAPTER_SLUG,
      slug: DEFAULT_PYMTHOUSE_INSTANCE_SLUG,
      displayName: 'Pymthouse (default)',
      config: {
        issuerUrl: env.issuerUrl,
        publicClientId: env.publicClientId,
        m2mClientId: env.m2mClientId,
      },
      secretRef: DEFAULT_PYMTHOUSE_SECRET_REF,
      status: 'active',
      enabled: true,
    },
    select: { id: true },
  });
  return { instanceId: row.id, created: true };
}

/**
 * Ensure a default `Subscription` exists for (team, providerInstance, account).
 * Idempotent via an existence check on that triple — re-runs create nothing.
 */
async function ensureDefaultSubscription(
  teamId: string,
  providerInstanceId: string,
  accountId: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.subscription.findFirst({
    where: { teamId, providerInstanceId, accountId },
    select: { id: true },
  });
  if (existing) {
    return { id: existing.id, created: false };
  }

  const row = await prisma.subscription.create({
    data: {
      teamId,
      providerInstanceId,
      providerPlanId: null,
      accountId,
      status: SUBSCRIPTION_STATUS_ACTIVE,
    },
    select: { id: true },
  });
  return { id: row.id, created: true };
}
