/**
 * Tests for Service Gateway — Secrets Admin API
 *
 * Unit tests for the secrets route logic.
 * Tests secret status retrieval, updates, and deletion
 * without requiring a running database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the logic patterns used by the secrets route handler rather than
// the Next.js route directly (which requires a full app context).

describe('Secrets Admin Logic', () => {
  const mockSecretRefs = ['token', 'password'];

  describe('secret key construction', () => {
    it('builds connector-scoped key for team scope', () => {
      const scopeId = 'team-123';
      const connectorSlug = 'daydream';
      const name = 'token';
      const key = `gw:${scopeId}:${connectorSlug}:${name}`;
      expect(key).toBe('gw:team-123:daydream:token');
    });

    it('builds connector-scoped key for personal scope', () => {
      const scopeId = 'personal:user-456';
      const connectorSlug = 'gemini';
      const name = 'token';
      const key = `gw:${scopeId}:${connectorSlug}:${name}`;
      expect(key).toBe('gw:personal:user-456:gemini:token');
    });

    it('different connectors with same ref produce different keys', () => {
      const scopeId = 'personal:user-456';
      const keyA = `gw:${scopeId}:daydream:token`;
      const keyB = `gw:${scopeId}:gemini:token`;
      expect(keyA).not.toBe(keyB);
    });
  });

  describe('PUT validation', () => {
    function validateSecretPut(
      body: Record<string, string>,
      secretRefs: string[]
    ): { valid: boolean; error?: string } {
      const refSet = new Set(secretRefs);

      const invalidKeys = Object.keys(body).filter((k) => !refSet.has(k));
      if (invalidKeys.length > 0) {
        return {
          valid: false,
          error: `Unknown secret ref(s): ${invalidKeys.join(', ')}. Valid refs: ${secretRefs.join(', ')}`,
        };
      }

      const emptyKeys = Object.entries(body).filter(
        ([, v]) => !v || typeof v !== 'string' || v.trim() === ''
      );
      if (emptyKeys.length > 0) {
        return {
          valid: false,
          error: `Secret value(s) cannot be empty: ${emptyKeys.map(([k]) => k).join(', ')}`,
        };
      }

      return { valid: true };
    }

    it('accepts known secret refs with non-empty values', () => {
      const result = validateSecretPut({ token: 'sk-abc123' }, mockSecretRefs);
      expect(result.valid).toBe(true);
    });

    it('rejects unknown secret refs', () => {
      const result = validateSecretPut(
        { token: 'sk-abc', unknown_key: 'val' },
        mockSecretRefs
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('unknown_key');
      expect(result.error).toContain('Valid refs');
    });

    it('rejects empty string values', () => {
      const result = validateSecretPut({ token: '' }, mockSecretRefs);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('rejects whitespace-only values', () => {
      const result = validateSecretPut({ token: '   ' }, mockSecretRefs);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('accepts multiple known refs', () => {
      const result = validateSecretPut(
        { token: 'sk-abc', password: 'p4ss' },
        mockSecretRefs
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('GET response shape', () => {
    interface SecretStatus {
      name: string;
      configured: boolean;
      updatedAt?: string;
    }

    function buildSecretStatuses(
      secretRefs: string[],
      configuredMap: Record<string, Date | null>
    ): SecretStatus[] {
      return secretRefs.map((name) => {
        const updatedAt = configuredMap[name];
        return {
          name,
          configured: !!updatedAt,
          ...(updatedAt ? { updatedAt: updatedAt.toISOString() } : {}),
        };
      });
    }

    it('returns configured: true with updatedAt when secret exists', () => {
      const now = new Date('2026-02-23T12:00:00Z');
      const statuses = buildSecretStatuses(['token'], { token: now });
      expect(statuses).toEqual([
        { name: 'token', configured: true, updatedAt: '2026-02-23T12:00:00.000Z' },
      ]);
    });

    it('returns configured: false without updatedAt when secret missing', () => {
      const statuses = buildSecretStatuses(['token'], { token: null });
      expect(statuses).toEqual([{ name: 'token', configured: false }]);
    });

    it('never includes the raw secret value', () => {
      const now = new Date();
      const statuses = buildSecretStatuses(['token', 'password'], {
        token: now,
        password: null,
      });
      for (const status of statuses) {
        expect(status).not.toHaveProperty('value');
      }
    });

    it('handles multiple refs with mixed status', () => {
      const now = new Date('2026-01-01T00:00:00Z');
      const statuses = buildSecretStatuses(['token', 'password'], {
        token: now,
        password: null,
      });
      expect(statuses[0].configured).toBe(true);
      expect(statuses[1].configured).toBe(false);
    });
  });

  describe('DELETE validation', () => {
    it('allows deletion of a ref in secretRefs', () => {
      const name = 'token';
      expect(mockSecretRefs.includes(name)).toBe(true);
    });

    it('rejects deletion of a ref not in secretRefs', () => {
      const name = 'nonexistent';
      expect(mockSecretRefs.includes(name)).toBe(false);
    });
  });
});
