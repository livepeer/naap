/**
 * Key-validation front-door helpers (NAAP-C).
 *
 * The front door (`POST /api/v1/keys/validate`) is the SINGLE entry point apps
 * and services call (BPP ③). It resolves a native `naap_` key → seat → team →
 * `billingAccountRef` → provider adapter → a provider-neutral response:
 *
 *     { user, app, billingAccount, capabilities, quota, signerSession }
 *
 * Decision D1: native `naap_` keys ONLY — there is NO provider-token
 * passthrough. A presented provider token is rejected.
 *
 * This module holds the DB-free parsing + response-shaping logic so it can be
 * unit-tested in isolation; the route persists/looks up rows.
 */

import type { SignerSession } from '@/lib/billing/adapter';
import type { BillingAccountRef } from '@/lib/teams/billing-account-ref';

/** Feature flag gating the validation front door (default OFF → 404 / fallback). */
export const FRONT_DOOR_FLAG = 'key_validation_front_door';

/** Native key prefix (D1). */
export const NATIVE_KEY_PREFIX = 'naap_';

/** App-id (X-App-Id) format: lowercase slug or a uuid; bounded length. */
const APP_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

/** Extract a Bearer token from an Authorization header, or null. */
export function parseBearer(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** True when the token is (claims to be) a native NaaP key. */
export function isNativeKeyToken(token: string): boolean {
  return token.startsWith(NATIVE_KEY_PREFIX);
}

/**
 * Validate + normalize an optional X-App-Id header. Returns the appId, or null
 * when absent. Returns the sentinel `INVALID_APP_ID` when present but malformed
 * so the caller can 400 (never used to build a URL or query — attribution only).
 */
export const INVALID_APP_ID = Symbol('invalid_app_id');
export function extractAppId(header: string | null): string | null | typeof INVALID_APP_ID {
  if (header == null) return null;
  const v = header.trim();
  if (v === '') return null;
  if (!APP_ID_RE.test(v)) return INVALID_APP_ID;
  return v;
}

/** BPP ③ front-door response (provider-neutral). */
export interface FrontDoorResponse {
  valid: true;
  user: { sub: string };
  app?: { id: string; scopes?: string[] };
  billingAccount: { id: string; providerSlug: string };
  capabilities: string[];
  quota: { remaining: number; resetAt?: string } | null;
  signerSession: SignerSession;
}

export interface BuildFrontDoorInput {
  userSub: string;
  appId?: string | null;
  appScopes?: string[];
  billingAccountRef: BillingAccountRef;
  capabilities?: string[] | null;
  quota?: { remaining: number; resetAt?: string } | null;
  signerSession: SignerSession;
}

/**
 * Shape the provider-neutral ③ response. Capabilities default to `[]` (not `*`)
 * when the provider hasn't wired BPP validate yet — fail CLOSED for capability
 * surface (NAAP-E enforces), while the key itself is still valid.
 */
export function buildFrontDoorResponse(input: BuildFrontDoorInput): FrontDoorResponse {
  const res: FrontDoorResponse = {
    valid: true,
    user: { sub: input.userSub },
    billingAccount: {
      id: input.billingAccountRef.accountId,
      providerSlug: input.billingAccountRef.providerSlug,
    },
    capabilities: Array.isArray(input.capabilities) ? input.capabilities : [],
    quota: input.quota ?? null,
    signerSession: input.signerSession,
  };
  if (input.appId) {
    res.app = { id: input.appId, ...(input.appScopes ? { scopes: input.appScopes } : {}) };
  }
  return res;
}
