/**
 * Native `naap_` key mint + resolution service (NAAP-B).
 *
 * Decision D1: native NaaP keys are the ONLY credential apps/SDK present — they
 * are provider-OPAQUE. A `naap_` key is issued to a SEAT (NAAP-1); server-side
 * it maps to whatever provider backs the seat's team account via the
 * BillingProviderAdapter (NAAP-A). Apps NEVER see `pmth_`, provider tokens, or
 * provider URLs.
 *
 * This module is DB-free so the mapping rules can be unit-tested in isolation;
 * the HTTP routes persist `DevApiKey` rows and the validation front door
 * (NAAP-C) calls {@link resolveNativeKeyToProviderSession}.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';

import { hashApiKey } from '@naap/database';
import { getBillingProviderAdapter } from '@/lib/billing/registry';
import type { BillingProviderAdapter, SignerSessionToken } from '@/lib/billing/adapter';
import {
  type BillingAccountRef,
  type TeamBillingBinding,
  teamBillingAccountRef,
} from '@/lib/teams/billing-account-ref';

/** Feature flag gating native-key issuance + resolution (default OFF). */
export const NATIVE_KEYS_FLAG = 'native_keys';

/** Canonical native key shape: `naap_<16 hex>_<48 hex>` (matches parseApiKey). */
export const NATIVE_KEY_RE = /^naap_[0-9a-f]{16}_[0-9a-f]{48}$/;

export interface GeneratedNativeKey {
  /** The full secret to return to the caller ONCE; never stored in clear. */
  rawKey: string;
  /** Blind-index lookup id (16 hex) — stored as `keyLookupId`. */
  lookupId: string;
  /** Secret portion (48 hex). */
  secret: string;
}

/** Mint a fresh native `naap_` key. The raw key is shown to the caller once. */
export function generateNativeApiKey(): GeneratedNativeKey {
  const lookupId = randomBytes(8).toString('hex'); // 16 hex chars
  const secret = randomBytes(24).toString('hex'); // 48 hex chars
  return { rawKey: `naap_${lookupId}_${secret}`, lookupId, secret };
}

/** True when a raw key has the canonical native shape. */
export function isNativeKeyFormat(rawKey: string): boolean {
  return NATIVE_KEY_RE.test(rawKey.trim());
}

/**
 * Constant-time comparison of a presented raw key against a stored scrypt hash.
 * Returns false on any mismatch (including length) without short-circuiting on
 * content, to avoid timing oracles.
 */
export function verifyNativeKeyHash(rawKey: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const actual = Buffer.from(hashApiKey(rawKey), 'utf8');
  const expected = Buffer.from(storedHash, 'utf8');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Minimal native-key record the resolver needs (subset of the DevApiKey row). */
export interface NativeKeyRecord {
  status: string; // ACTIVE | REVOKED | EXPIRED
  seatId: string | null;
  teamId: string | null;
}

/**
 * P2 per-subscription binding override. When the caller has resolved the key's
 * subscription hop (`key → Subscription → ProviderInstance`), it passes the
 * resolved per-instance adapter + account pointer here; the resolver mints
 * against THIS adapter/account instead of the team's legacy `billingAccountRef`.
 * Absent/null ⇒ today's exact path (zero regression).
 */
export interface SubscriptionBindingOverride {
  adapter: BillingProviderAdapter;
  billingAccountRef: BillingAccountRef;
}

export type ResolveFailureReason =
  | 'revoked'
  | 'unbound_seat'
  | 'team_unbound'
  | 'provider_unavailable'
  | 'mint_failed';

export interface ResolvedProviderSession {
  valid: boolean;
  reason?: ResolveFailureReason;
  /** Provider-agnostic account pointer the session was minted for. */
  billingAccountRef?: BillingAccountRef;
  /**
   * Provider-issued session, OPAQUE to applications. Always the token-bundle
   * form: `mintSignerSession` returns `SignerSessionToken` (the shape NAAP-C and
   * the reference provider return).
   */
  signerSession?: SignerSessionToken;
}

/**
 * Resolve a native key (record + its team binding) into a provider signer
 * session — the core "naap_ → provider session" mapping. Provider-agnostic:
 * works for pymthouse, the C0 stub, or any registered adapter. Revocation is
 * instant because a non-ACTIVE key fails before any provider call.
 *
 * @param key   the stored key record (status + seat/team attribution)
 * @param team  the seat's team billing binding, or null if unresolved
 * @param opts  optional email + a P2 per-subscription binding `override`
 */
export async function resolveNativeKeyToProviderSession(
  key: NativeKeyRecord,
  team: TeamBillingBinding | null,
  opts?: { email?: string; override?: SubscriptionBindingOverride | null },
): Promise<ResolvedProviderSession> {
  // Revocation/expiry invalidates instantly — before touching any provider.
  if (key.status !== 'ACTIVE') return { valid: false, reason: 'revoked' };
  if (!key.teamId) return { valid: false, reason: 'unbound_seat' };
  if (!team || team.id !== key.teamId) return { valid: false, reason: 'team_unbound' };

  // P2: when a per-subscription binding is supplied, mint against THAT instance
  // adapter + account. Otherwise fall through to today's exact team-account path.
  let ref: BillingAccountRef;
  let adapter: BillingProviderAdapter | undefined;
  if (opts?.override) {
    ref = opts.override.billingAccountRef;
    adapter = opts.override.adapter;
  } else {
    const legacyRef = teamBillingAccountRef(team);
    if (!legacyRef) return { valid: false, reason: 'team_unbound' };
    ref = legacyRef;
    adapter = getBillingProviderAdapter(ref.providerSlug);
  }

  if (!adapter || !adapter.isConfigured()) {
    return { valid: false, reason: 'provider_unavailable', billingAccountRef: ref };
  }

  try {
    const signerSession = await adapter.mintSignerSession({
      externalUserId: ref.accountId,
      email: opts?.email,
    });
    return { valid: true, billingAccountRef: ref, signerSession };
  } catch {
    // Never surface provider internals; lag-tolerant fail-safe.
    return { valid: false, reason: 'mint_failed', billingAccountRef: ref };
  }
}
