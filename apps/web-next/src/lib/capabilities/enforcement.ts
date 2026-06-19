/**
 * Capability gate enforcement (NAAP-E).
 *
 * Given the capabilities resolved for a validated key (front door: key → seat →
 * team → billing account → provider plan), decide whether a REQUESTED capability
 * is allowed. The gate is:
 *
 *   - flag-gated by `capability_gate` (default OFF). When OFF the gate is a pure
 *     pass-through: callers behave exactly as before (zero regression / INV-1).
 *   - fail-CLOSED when ON: an empty/missing grant set denies everything, and a
 *     requested capability not in the grant set is denied. Only an explicit
 *     grant (exact id or the `*` wildcard) allows.
 *
 * This module is pure and DB-free so it unit-tests in isolation; routes read the
 * flag (`isFeatureEnabled`) and pass `enabled` in.
 */

import {
  CAPABILITY_WILDCARD,
  normalizeCapabilities,
  parseCapabilityId,
} from './taxonomy';

/** Feature flag gating capability enforcement (default OFF → no enforcement). */
export const CAPABILITY_GATE_FLAG = 'capability_gate';

/**
 * Is `requested` granted by `granted`? A `*` wildcard grants everything; an
 * empty grant set grants nothing (fail closed). Matching is exact on the
 * normalized capability id.
 */
export function isCapabilityGranted(
  granted: readonly string[] | null | undefined,
  requested: string,
): boolean {
  const want = parseCapabilityId(requested);
  if (!want) return false; // malformed request → deny (fail closed)
  const grants = normalizeCapabilities(granted);
  if (grants.length === 0) return false; // no grants → deny everything
  if (grants.includes(CAPABILITY_WILDCARD)) return true; // wildcard grants all
  if (want.kind === 'wildcard') return false; // only a wildcard grant satisfies `*`
  return grants.includes(want.raw);
}

export type CapabilityGateReason =
  | 'flag_off' // gate disabled → pass-through (today's behavior)
  | 'no_request' // nothing requested to gate → pass-through
  | 'granted' // requested capability is in the grant set
  | 'denied_empty' // grant set empty/missing → fail closed
  | 'denied_not_granted' // requested capability not granted → fail closed
  | 'denied_malformed'; // requested capability id malformed → fail closed

export interface CapabilityGateDecision {
  allowed: boolean;
  reason: CapabilityGateReason;
}

export interface CapabilityGateInput {
  /** Whether the `capability_gate` flag is ON. OFF → pure pass-through. */
  enabled: boolean;
  /** Capabilities granted to the caller (from the resolved plan). */
  granted: readonly string[] | null | undefined;
  /** The capability the caller is asking to use, if any. */
  requested: string | null | undefined;
}

/**
 * Decide a single capability request. The ONLY way `allowed` is `false` is when
 * the gate is ON, a capability is requested, and it is not explicitly granted —
 * so with the flag OFF this can never change existing behavior.
 */
export function enforceCapabilityGate(input: CapabilityGateInput): CapabilityGateDecision {
  if (!input.enabled) return { allowed: true, reason: 'flag_off' };

  const requested = typeof input.requested === 'string' ? input.requested.trim() : '';
  if (requested === '') return { allowed: true, reason: 'no_request' };

  if (!parseCapabilityId(requested)) {
    return { allowed: false, reason: 'denied_malformed' };
  }

  const grants = normalizeCapabilities(input.granted);
  if (grants.length === 0) return { allowed: false, reason: 'denied_empty' };

  return isCapabilityGranted(grants, requested)
    ? { allowed: true, reason: 'granted' }
    : { allowed: false, reason: 'denied_not_granted' };
}

/**
 * Filter a list of requested capabilities to those allowed by the gate. With the
 * flag OFF this returns the input unchanged (pass-through). With it ON, only
 * granted capabilities survive (fail closed: empty grants → empty result).
 */
export function filterGrantedCapabilities(
  input: Omit<CapabilityGateInput, 'requested'> & { requested: readonly string[] },
): string[] {
  if (!input.enabled) return [...input.requested];
  return input.requested.filter(
    (cap) => enforceCapabilityGate({ enabled: true, granted: input.granted, requested: cap }).allowed,
  );
}
