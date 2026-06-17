/**
 * Provider-agnostic billing-account reference (NAAP-1).
 *
 * A NaaP team binds to exactly ONE billing account through a provider-agnostic
 * pointer — the BPP `billingAccountRef`:
 *
 *     billingAccountRef = { providerSlug, accountId }
 *
 * `providerSlug` selects a `BillingProviderAdapter` from the registry (NAAP-A);
 * `accountId` is the provider's OWN opaque customer/subscription id (e.g. an
 * OpenMeter customer id behind the pymthouse adapter). NaaP never interprets
 * `accountId` — it is resolved back through the adapter. This module is
 * DB-free so the binding rules can be unit-tested in isolation.
 *
 * IMPORTANT (Decision D2): there is NO separate NaaP-side billing-account
 * entity (PYMT-1 is retired). The team row stores the ref directly and the
 * provider owns the account.
 */

import {
  getBillingProviderAdapter,
  hasBillingProviderAdapter,
} from '@/lib/billing/registry';

/** Feature flag gating the team-seats + billing-account-binding surface (default OFF). */
export const TEAM_SEATS_FLAG = 'team_seats';

/** Provider-agnostic pointer to the paying account (BPP ⑤ `billingAccountRef`). */
export interface BillingAccountRef {
  providerSlug: string;
  accountId: string;
}

/** Lowercase slug, 1–63 chars; mirrors the generic billing route's slug rule. */
const PROVIDER_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Defensive upper bound on the opaque provider account id. */
const MAX_ACCOUNT_ID_LEN = 256;

/**
 * Validate + normalize a raw billing-account-ref payload. Returns the trimmed
 * ref, or `null` when the shape is invalid. Does NOT check adapter
 * registration — call {@link isProviderResolvable} for that.
 */
export function normalizeBillingAccountRef(input: unknown): BillingAccountRef | null {
  if (!input || typeof input !== 'object') return null;
  const { providerSlug, accountId } = input as Record<string, unknown>;
  if (typeof providerSlug !== 'string' || typeof accountId !== 'string') return null;

  const slug = providerSlug.trim().toLowerCase();
  const id = accountId.trim();
  if (!PROVIDER_SLUG_RE.test(slug)) return null;
  if (id.length === 0 || id.length > MAX_ACCOUNT_ID_LEN) return null;

  return { providerSlug: slug, accountId: id };
}

/**
 * True when the ref's provider has a registered adapter (NAAP-A) — the binding
 * is resolvable. Keeps NaaP generic: any provider with an adapter (pymthouse,
 * the C0 stub, …) is bindable; an unknown provider is rejected.
 */
export function isProviderResolvable(ref: BillingAccountRef): boolean {
  return hasBillingProviderAdapter(ref.providerSlug);
}

/** Minimal team shape needed to read its binding (subset of the Prisma row). */
export interface TeamBillingBinding {
  id: string;
  billingAccountProviderSlug: string | null;
  billingAccountId: string | null;
}

/**
 * Read a team's `billingAccountRef`, or `null` when the team is unbound.
 * A partially-populated binding (one column set, the other null) is treated as
 * unbound — the API only ever writes both columns together.
 */
export function teamBillingAccountRef(team: TeamBillingBinding): BillingAccountRef | null {
  const slug = team.billingAccountProviderSlug?.trim().toLowerCase();
  const id = team.billingAccountId?.trim();
  if (!slug || !id) return null;
  return { providerSlug: slug, accountId: id };
}

/**
 * Whether the bound provider is currently configured to serve requests. Used to
 * fail safe / surface a clear error when a team is bound to a provider whose
 * adapter lacks configuration (lag tolerance, D6).
 */
export function isBoundProviderConfigured(ref: BillingAccountRef): boolean {
  const adapter = getBillingProviderAdapter(ref.providerSlug);
  return Boolean(adapter?.isConfigured());
}
