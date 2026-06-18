/** @vitest-environment node */

import { describe, it, expect } from 'vitest';

import {
  DEFAULT_SEAT_KEY_LIMIT,
  MAX_SEAT_KEY_LIMIT,
  allSeatsResolveToSingleRef,
  isSeatRole,
  isSeatStatus,
  normalizeKeyLimit,
  resolveSeatBillingAccountRef,
  seatCanMintKey,
} from './seats';
import type { TeamBillingBinding } from './billing-account-ref';

const boundTeam: TeamBillingBinding = {
  id: 'team-1',
  billingAccountProviderSlug: 'pymthouse',
  billingAccountId: 'acct_om_123',
};

const stubTeam: TeamBillingBinding = {
  id: 'team-2',
  billingAccountProviderSlug: 'stub',
  billingAccountId: 'acct_stub_1',
};

const unboundTeam: TeamBillingBinding = {
  id: 'team-3',
  billingAccountProviderSlug: null,
  billingAccountId: null,
};

describe('seat role/status guards', () => {
  it('accepts known roles and statuses', () => {
    expect(isSeatRole('admin')).toBe(true);
    expect(isSeatRole('member')).toBe(true);
    expect(isSeatRole('viewer')).toBe(true);
    expect(isSeatRole('owner')).toBe(false);
    expect(isSeatStatus('active')).toBe(true);
    expect(isSeatStatus('pending')).toBe(true);
    expect(isSeatStatus('revoked')).toBe(true);
    expect(isSeatStatus('deleted')).toBe(false);
  });
});

describe('normalizeKeyLimit', () => {
  it('accepts integers within bounds', () => {
    expect(normalizeKeyLimit(0)).toBe(0);
    expect(normalizeKeyLimit(DEFAULT_SEAT_KEY_LIMIT)).toBe(DEFAULT_SEAT_KEY_LIMIT);
    expect(normalizeKeyLimit(MAX_SEAT_KEY_LIMIT)).toBe(MAX_SEAT_KEY_LIMIT);
  });
  it('rejects out-of-range or non-integers', () => {
    expect(normalizeKeyLimit(-1)).toBeNull();
    expect(normalizeKeyLimit(MAX_SEAT_KEY_LIMIT + 1)).toBeNull();
    expect(normalizeKeyLimit(1.5)).toBeNull();
    expect(normalizeKeyLimit('3')).toBeNull();
  });
});

describe('resolveSeatBillingAccountRef', () => {
  it('resolves a seat through its bound team', () => {
    expect(resolveSeatBillingAccountRef({ teamId: 'team-1' }, boundTeam)).toEqual({
      providerSlug: 'pymthouse',
      accountId: 'acct_om_123',
    });
  });
  it('returns null when the seat does not belong to the team', () => {
    expect(resolveSeatBillingAccountRef({ teamId: 'other' }, boundTeam)).toBeNull();
  });
  it('returns null for an unbound team', () => {
    expect(resolveSeatBillingAccountRef({ teamId: 'team-3' }, unboundTeam)).toBeNull();
  });
});

describe('guardrail: all seats in a team resolve to one billingAccountRef', () => {
  it('holds for many seats on a pymthouse-bound team', () => {
    const seats = [{ teamId: 'team-1' }, { teamId: 'team-1' }, { teamId: 'team-1' }];
    expect(allSeatsResolveToSingleRef(boundTeam, seats)).toBe(true);
  });

  it('holds for the C0 stub provider too (provider-agnostic)', () => {
    const seats = [{ teamId: 'team-2' }, { teamId: 'team-2' }];
    expect(allSeatsResolveToSingleRef(stubTeam, seats)).toBe(true);
  });

  it('holds (vacuously) for an unbound team', () => {
    const seats = [{ teamId: 'team-3' }, { teamId: 'team-3' }];
    expect(allSeatsResolveToSingleRef(unboundTeam, seats)).toBe(true);
  });

  it('fails if a foreign seat is mixed in', () => {
    const seats = [{ teamId: 'team-1' }, { teamId: 'foreign' }];
    expect(allSeatsResolveToSingleRef(boundTeam, seats)).toBe(false);
  });
});

describe('seatCanMintKey', () => {
  it('allows minting under the limit on an active seat', () => {
    expect(seatCanMintKey({ status: 'active', keyLimit: 5 }, 4)).toBe(true);
  });
  it('blocks at/over the limit', () => {
    expect(seatCanMintKey({ status: 'active', keyLimit: 5 }, 5)).toBe(false);
  });
  it('blocks a zero-limit seat', () => {
    expect(seatCanMintKey({ status: 'active', keyLimit: 0 }, 0)).toBe(false);
  });
  it('blocks revoked/pending seats', () => {
    expect(seatCanMintKey({ status: 'revoked', keyLimit: 5 }, 0)).toBe(false);
    expect(seatCanMintKey({ status: 'pending', keyLimit: 5 }, 0)).toBe(false);
  });
});
