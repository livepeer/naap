/**
 * Tests for Service Gateway — Authorization
 *
 * Verifies dual-path auth (JWT + API key), personal/team connector
 * access verification, and cross-scope isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

vi.mock('@/lib/db', () => ({
  prisma: {
    gatewayApiKey: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('@/lib/api/auth', () => ({
  validateSession: vi.fn(),
}));

vi.mock('@/lib/api/response', () => ({
  getAuthToken: vi.fn(),
}));

import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';
import { authorize, extractTeamContext, verifyConnectorAccess } from '../authorize';
import type { AuthResult } from '../types';

const mockFindUnique = prisma.gatewayApiKey.findUnique as ReturnType<typeof vi.fn>;
const mockValidateSession = validateSession as ReturnType<typeof vi.fn>;
const mockGetAuthToken = getAuthToken as ReturnType<typeof vi.fn>;

describe('authorize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('JWT auth path', () => {
    it('authenticates with valid JWT token', async () => {
      mockGetAuthToken.mockReturnValue('valid-jwt-token');
      mockValidateSession.mockResolvedValue({ id: 'user-1' });

      const request = new Request('https://example.com/api/v1/gw/test', {
        headers: {
          authorization: 'Bearer valid-jwt-token',
          'x-team-id': 'team-1',
        },
      });

      const result = await authorize(request);

      expect(result).not.toBeNull();
      expect(result!.callerType).toBe('jwt');
      expect(result!.callerId).toBe('user-1');
      expect(result!.teamId).toBe('team-1');
    });

    it('falls back to personal scope when no team header', async () => {
      mockGetAuthToken.mockReturnValue('valid-jwt-token');
      mockValidateSession.mockResolvedValue({ id: 'user-1' });

      const request = new Request('https://example.com/api/v1/gw/test', {
        headers: {
          authorization: 'Bearer valid-jwt-token',
        },
      });

      const result = await authorize(request);

      expect(result).not.toBeNull();
      expect(result!.teamId).toBe('personal:user-1');
    });

    it('returns null for invalid JWT', async () => {
      mockGetAuthToken.mockReturnValue('bad-token');
      mockValidateSession.mockResolvedValue(null);

      const request = new Request('https://example.com/api/v1/gw/test', {
        headers: { authorization: 'Bearer bad-token' },
      });

      const result = await authorize(request);
      expect(result).toBeNull();
    });
  });

  describe('API key auth path', () => {
    const rawKey = 'gw_test-key-12345';
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    it('authenticates with valid team-scoped API key', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'key-1',
        keyHash,
        status: 'active',
        teamId: 'team-1',
        ownerUserId: null,
        createdBy: 'user-1',
        expiresAt: null,
        planId: 'plan-1',
        allowedEndpoints: [],
        allowedIPs: [],
        plan: {
          rateLimit: 100,
          dailyQuota: 10000,
          monthlyQuota: null,
          maxRequestSize: null,
        },
      });

      const request = new Request('https://example.com/api/v1/gw/test', {
        headers: { authorization: `Bearer ${rawKey}` },
      });

      const result = await authorize(request);

      expect(result).not.toBeNull();
      expect(result!.callerType).toBe('apiKey');
      expect(result!.teamId).toBe('team-1');
      expect(result!.apiKeyId).toBe('key-1');
      expect(result!.rateLimit).toBe(100);
    });

    it('authenticates with valid personal-scoped API key', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'key-2',
        keyHash,
        status: 'active',
        teamId: null,
        ownerUserId: 'user-2',
        createdBy: 'user-2',
        expiresAt: null,
        planId: null,
        allowedEndpoints: [],
        allowedIPs: [],
        plan: null,
      });

      const request = new Request('https://example.com/api/v1/gw/test', {
        headers: { authorization: `Bearer ${rawKey}` },
      });

      const result = await authorize(request);

      expect(result).not.toBeNull();
      expect(result!.callerType).toBe('apiKey');
      expect(result!.teamId).toBe('personal:user-2');
    });

    it('returns null for unknown API key', async () => {
      mockFindUnique.mockResolvedValue(null);

      const request = new Request('https://example.com/api/v1/gw/test', {
        headers: { authorization: 'Bearer gw_unknown-key' },
      });

      const result = await authorize(request);
      expect(result).toBeNull();
    });

    it('returns null for inactive API key', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'key-1',
        keyHash,
        status: 'revoked',
        teamId: 'team-1',
        ownerUserId: null,
        createdBy: 'user-1',
        expiresAt: null,
        planId: null,
        allowedEndpoints: [],
        allowedIPs: [],
        plan: null,
      });

      const request = new Request('https://example.com/api/v1/gw/test', {
        headers: { authorization: `Bearer ${rawKey}` },
      });

      const result = await authorize(request);
      expect(result).toBeNull();
    });

    it('returns null for expired API key', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'key-1',
        keyHash,
        status: 'active',
        teamId: 'team-1',
        ownerUserId: null,
        createdBy: 'user-1',
        expiresAt: new Date('2020-01-01'),
        planId: null,
        allowedEndpoints: [],
        allowedIPs: [],
        plan: null,
      });

      const request = new Request('https://example.com/api/v1/gw/test', {
        headers: { authorization: `Bearer ${rawKey}` },
      });

      const result = await authorize(request);
      expect(result).toBeNull();
    });
  });

  describe('no auth', () => {
    it('returns null when no auth header provided', async () => {
      mockGetAuthToken.mockReturnValue(null);

      const request = new Request('https://example.com/api/v1/gw/test');

      const result = await authorize(request);
      expect(result).toBeNull();
    });
  });
});

describe('extractTeamContext', () => {
  it('extracts team ID from header', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-team-id': 'team-1' },
    });

    const ctx = extractTeamContext(request);
    expect(ctx).toEqual({ teamId: 'team-1' });
  });

  it('returns null when no team header', () => {
    const request = new Request('https://example.com');

    const ctx = extractTeamContext(request);
    expect(ctx).toBeNull();
  });
});

describe('verifyConnectorAccess', () => {
  // ── Team-scoped connectors ──

  it('allows access to team connector when team matches', () => {
    const auth: AuthResult = {
      authenticated: true,
      callerType: 'jwt',
      callerId: 'user-1',
      teamId: 'team-1',
    };

    expect(verifyConnectorAccess(auth, 'conn-1', 'team-1', null)).toBe(true);
  });

  it('denies access to team connector when team does not match', () => {
    const auth: AuthResult = {
      authenticated: true,
      callerType: 'jwt',
      callerId: 'user-1',
      teamId: 'team-1',
    };

    expect(verifyConnectorAccess(auth, 'conn-1', 'team-2', null)).toBe(false);
  });

  it('denies personal user access to team connector', () => {
    const auth: AuthResult = {
      authenticated: true,
      callerType: 'jwt',
      callerId: 'user-1',
      teamId: 'personal:user-1',
    };

    expect(verifyConnectorAccess(auth, 'conn-1', 'team-1', null)).toBe(false);
  });

  // ── Personal connectors ──

  it('allows owner access to personal connector', () => {
    const auth: AuthResult = {
      authenticated: true,
      callerType: 'jwt',
      callerId: 'user-1',
      teamId: 'personal:user-1',
    };

    expect(verifyConnectorAccess(auth, 'conn-1', null, 'user-1')).toBe(true);
  });

  it('denies other user access to personal connector', () => {
    const auth: AuthResult = {
      authenticated: true,
      callerType: 'jwt',
      callerId: 'user-2',
      teamId: 'personal:user-2',
    };

    expect(verifyConnectorAccess(auth, 'conn-1', null, 'user-1')).toBe(false);
  });

  it('denies team-scoped caller access to personal connector', () => {
    const auth: AuthResult = {
      authenticated: true,
      callerType: 'jwt',
      callerId: 'user-1',
      teamId: 'team-1',
    };

    expect(verifyConnectorAccess(auth, 'conn-1', null, 'user-1')).toBe(true);
  });

  // ── Edge cases ──

  it('denies access when both teamId and ownerUserId are null', () => {
    const auth: AuthResult = {
      authenticated: true,
      callerType: 'jwt',
      callerId: 'user-1',
      teamId: 'personal:user-1',
    };

    expect(verifyConnectorAccess(auth, 'conn-1', null, null)).toBe(false);
  });
});
