/**
 * Team-seat domain logic (NAAP-1) — DB-free so it can be unit-tested in
 * isolation. The HTTP routes under `src/app/api/v1/teams/[teamId]/seats/*`
 * persist `Seat` rows and delegate the rules here.
 *
 * Core invariant (guardrail): EVERY seat in a team resolves to the SAME
 * `billingAccountRef`, because the ref is a property of the team, not the seat.
 * {@link allSeatsResolveToSingleRef} proves this holds for pymthouse and the
 * C0 stub provider alike.
 */

import {
  type BillingAccountRef,
  type TeamBillingBinding,
  teamBillingAccountRef,
} from './billing-account-ref';

/** Roles a seat may hold (mirrors team-member roles, excluding `owner`). */
export const SEAT_ROLES = ['admin', 'member', 'viewer'] as const;
export type SeatRole = (typeof SEAT_ROLES)[number];

/** Lifecycle states for a seat. */
export const SEAT_STATUSES = ['active', 'pending', 'revoked'] as const;
export type SeatStatus = (typeof SEAT_STATUSES)[number];

/** Default per-seat cap on active API keys (NAAP-B issues keys to seats). */
export const DEFAULT_SEAT_KEY_LIMIT = 5;
/** Defensive upper bound an admin may set for a single seat. */
export const MAX_SEAT_KEY_LIMIT = 100;

/** Minimal seat shape the domain logic needs (subset of the Prisma row). */
export interface SeatShape {
  id: string;
  teamId: string;
  userId: string | null;
  role: string;
  status: string;
  keyLimit: number;
}

export function isSeatRole(value: unknown): value is SeatRole {
  return typeof value === 'string' && (SEAT_ROLES as readonly string[]).includes(value);
}

export function isSeatStatus(value: unknown): value is SeatStatus {
  return typeof value === 'string' && (SEAT_STATUSES as readonly string[]).includes(value);
}

/** Clamp/validate a requested per-seat key limit; returns null when invalid. */
export function normalizeKeyLimit(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 0 || value > MAX_SEAT_KEY_LIMIT) return null;
  return value;
}

/**
 * Resolve the `billingAccountRef` a seat bills to. A seat always resolves
 * through its TEAM, so the seat itself carries no provider coupling. Returns
 * null when the seat does not belong to the given team, or the team is unbound.
 */
export function resolveSeatBillingAccountRef(
  seat: Pick<SeatShape, 'teamId'>,
  team: TeamBillingBinding,
): BillingAccountRef | null {
  if (seat.teamId !== team.id) return null;
  return teamBillingAccountRef(team);
}

/**
 * Guardrail: assert that every seat in a team resolves to exactly ONE
 * `billingAccountRef`. True for an unbound team only when it has zero seats
 * resolving to a ref (i.e. all resolve to null → still "single": none).
 */
export function allSeatsResolveToSingleRef(
  team: TeamBillingBinding,
  seats: Array<Pick<SeatShape, 'teamId'>>,
): boolean {
  // Any seat not belonging to this team is a programming error → not single.
  if (seats.some((s) => s.teamId !== team.id)) return false;
  const refs = seats.map((s) => resolveSeatBillingAccountRef(s, team));
  const distinct = new Set(
    refs
      .filter((r): r is BillingAccountRef => r !== null)
      .map((r) => `${r.providerSlug}:${r.accountId}`),
  );
  return distinct.size <= 1;
}

/** Whether a seat is currently usable (active and not revoked). */
export function isSeatActive(seat: Pick<SeatShape, 'status'>): boolean {
  return seat.status === 'active';
}

/**
 * Whether an active seat may mint another API key given how many active keys it
 * already holds. A `keyLimit` of 0 means "no keys allowed".
 */
export function seatCanMintKey(
  seat: Pick<SeatShape, 'status' | 'keyLimit'>,
  activeKeyCount: number,
): boolean {
  if (!isSeatActive(seat)) return false;
  return activeKeyCount < seat.keyLimit;
}
