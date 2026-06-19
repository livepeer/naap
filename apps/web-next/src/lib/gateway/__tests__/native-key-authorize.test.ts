/**
 * Tests for Service Gateway — Native NaaP key (`naap_`) authorization (NAAP-5).
 *
 * Covers the new flag-gated authorize branch that lets an app holding a native
 * `naap_` key authorize against PUBLIC connectors (e.g. the `sdk` connector):
 *
 *   - INV-1 / zero-regression: with `sdk_connector` OFF, a `naap_` key is
 *     rejected at the gateway exactly as today (returns null → 401) and the
 *     DevApiKey table is never queried.
 *   - Flag ON: a valid ACTIVE key authorizes (callerType 'nativeKey'), revoked /
 *     unknown / malformed keys are rejected, and team vs personal scope resolve.
 *   - gw_/gwm_/JWT paths are untouched by the flag.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
  SDK_CONNECTOR_FLAG: 'sdk_connector',
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    gatewayApiKey: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    gatewayMasterKey: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    teamMember: { findFirst: vi.fn().mockResolvedValue({ id: 'member-1' }) },
    devApiKey: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock('@/lib/api/auth', () => ({ validateSession: vi.fn() }));

vi.mock('@/lib/api/response', () => ({
  getAuthToken: vi.fn(),
  getClientIP: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('@naap/cache', () => ({
  createRateLimiter: () => ({
    consume: vi.fn().mockResolvedValue({ allowed: true, remaining: 10, limit: 10, resetIn: 60 }),
    get: vi.fn().mockResolvedValue({ allowed: true, remaining: 10, limit: 10, resetIn: 60 }),
    reset: vi.fn(),
    config: { points: 10, duration: 60, blockDuration: 300, keyPrefix: 'gw:auth:fail' },
  }),
}));

import { prisma } from '@/lib/db';
import { hashApiKey } from '@naap/database';
import { authorize } from '../authorize';

const mockDevApiKeyFind = (
  prisma as unknown as { devApiKey: { findUnique: ReturnType<typeof vi.fn> } }
).devApiKey.findUnique;
const mockGatewayApiKeyFind = prisma.gatewayApiKey.findUnique as ReturnType<typeof vi.fn>;

// A syntactically valid native key: naap_<16 hex>_<48 hex>.
const LOOKUP_ID = 'a'.repeat(16);
const SECRET = 'b'.repeat(48);
const RAW_KEY = `naap_${LOOKUP_ID}_${SECRET}`;
const KEY_HASH = hashApiKey(RAW_KEY);

function nativeKeyRequest(rawKey = RAW_KEY): Request {
  return new Request('https://example.com/api/v1/gw/sdk/inference', {
    method: 'POST',
    headers: { authorization: `Bearer ${rawKey}` },
  });
}

describe('authorize — native naap_ key (NAAP-5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('flag OFF (INV-1: zero-regression)', () => {
    it('rejects a valid naap_ key and never touches DevApiKey', async () => {
      isFeatureEnabled.mockResolvedValue(false);
      mockDevApiKeyFind.mockResolvedValue({
        id: 'key-1',
        userId: 'user-1',
        keyHash: KEY_HASH,
        status: 'ACTIVE',
        seatId: 'seat-1',
        teamId: 'team-1',
      });

      const result = await authorize(nativeKeyRequest());

      expect(result).toBeNull();
      expect(mockDevApiKeyFind).not.toHaveBeenCalled();
    });
  });

  describe('flag ON', () => {
    beforeEach(() => {
      isFeatureEnabled.mockResolvedValue(true);
    });

    it('authorizes a valid ACTIVE team-bound key as callerType nativeKey', async () => {
      mockDevApiKeyFind.mockResolvedValue({
        id: 'key-1',
        userId: 'user-1',
        keyHash: KEY_HASH,
        status: 'ACTIVE',
        seatId: 'seat-1',
        teamId: 'team-1',
      });

      const result = await authorize(nativeKeyRequest());

      expect(result).not.toBeNull();
      expect(result!.callerType).toBe('nativeKey');
      expect(result!.callerId).toBe('user-1');
      expect(result!.teamId).toBe('team-1');
      expect(mockDevApiKeyFind).toHaveBeenCalledWith(
        expect.objectContaining({ where: { keyLookupId: LOOKUP_ID } }),
      );
    });

    it('resolves personal scope when the key has no teamId', async () => {
      mockDevApiKeyFind.mockResolvedValue({
        id: 'key-2',
        userId: 'user-2',
        keyHash: KEY_HASH,
        status: 'ACTIVE',
        seatId: null,
        teamId: null,
      });

      const result = await authorize(nativeKeyRequest());

      expect(result).not.toBeNull();
      expect(result!.teamId).toBe('personal:user-2');
    });

    it('rejects a revoked (non-ACTIVE) key', async () => {
      mockDevApiKeyFind.mockResolvedValue({
        id: 'key-3',
        userId: 'user-3',
        keyHash: KEY_HASH,
        status: 'REVOKED',
        seatId: null,
        teamId: 'team-3',
      });

      const result = await authorize(nativeKeyRequest());
      expect(result).toBeNull();
    });

    it('rejects an unknown key (no row)', async () => {
      mockDevApiKeyFind.mockResolvedValue(null);

      const result = await authorize(nativeKeyRequest());
      expect(result).toBeNull();
    });

    it('rejects a key whose secret hash does not match', async () => {
      mockDevApiKeyFind.mockResolvedValue({
        id: 'key-4',
        userId: 'user-4',
        keyHash: hashApiKey('naap_' + 'c'.repeat(16) + '_' + 'd'.repeat(48)),
        status: 'ACTIVE',
        seatId: null,
        teamId: 'team-4',
      });

      const result = await authorize(nativeKeyRequest());
      expect(result).toBeNull();
    });

    it('rejects a malformed naap_ key without a DB lookup', async () => {
      const result = await authorize(nativeKeyRequest('naap_not-a-valid-key'));
      expect(result).toBeNull();
      expect(mockDevApiKeyFind).not.toHaveBeenCalled();
    });

    it('does not affect gw_ key auth (still routed to gatewayApiKey)', async () => {
      mockGatewayApiKeyFind.mockResolvedValue(null);
      const request = new Request('https://example.com/api/v1/gw/sdk/inference', {
        headers: { authorization: 'Bearer gw_some-key' },
      });

      await authorize(request);

      expect(mockGatewayApiKeyFind).toHaveBeenCalled();
      expect(mockDevApiKeyFind).not.toHaveBeenCalled();
    });
  });
});
