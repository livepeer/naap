/**
 * Unit tests for the CPA portal access-token helpers (PR 11).
 *
 * Coverage:
 *   1. generateAccessToken — entropy, format, uniqueness.
 *   2. tokensMatch — constant-time equality, malformed input rejection.
 *
 * resolveAccessByToken hits Prisma and is exercised by the e2e tests;
 * we keep this file pure-CPU so it runs without a database.
 */

import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
// resolveAccessByToken touches @naap/database, so we mock it out — these
// are pure-function tests for generateAccessToken / tokensMatch.
vi.mock('@naap/database', () => ({ prisma: {} }));

import { generateAccessToken, tokensMatch } from './agentbook-cpa-token';

describe('agentbook-cpa-token', () => {
  describe('generateAccessToken', () => {
    it('returns exactly 64 lowercase hex chars (32 bytes)', () => {
      const t = generateAccessToken();
      expect(t).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different tokens on each call', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 100; i++) seen.add(generateAccessToken());
      // Birthday-paradox collision probability for 32 bytes over 100
      // samples is ~10^-72, so any collision means broken entropy.
      expect(seen.size).toBe(100);
    });

    it('has full byte-distribution entropy across many samples', () => {
      // Sanity check on entropy: every nibble (0–f) should appear in
      // the union of 1000 tokens. If randomBytes were broken we'd see
      // gaps. This is cheap and catches "stuck high bits" type bugs.
      const seen = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        for (const ch of generateAccessToken()) seen.add(ch);
        if (seen.size === 16) break;
      }
      expect(seen.size).toBe(16);
    });
  });

  describe('tokensMatch', () => {
    it('returns true for identical tokens', () => {
      const t = generateAccessToken();
      expect(tokensMatch(t, t)).toBe(true);
    });

    it('returns false for different tokens of same length', () => {
      const a = generateAccessToken();
      const b = generateAccessToken();
      expect(tokensMatch(a, b)).toBe(false);
    });

    it('returns false for different-length tokens', () => {
      expect(tokensMatch('aa', 'aaaa')).toBe(false);
    });

    it('rejects null / undefined / empty', () => {
      expect(tokensMatch(null, 'aa')).toBe(false);
      expect(tokensMatch('aa', undefined)).toBe(false);
      expect(tokensMatch('', '')).toBe(false);
      expect(tokensMatch(null, null)).toBe(false);
    });

    it('rejects non-hex strings', () => {
      expect(tokensMatch('zz', 'zz')).toBe(false);
      expect(tokensMatch('hello world', 'hello world')).toBe(false);
    });

    it('treats hex case as equivalent (both decode to same bytes)', () => {
      // Buffer.from('AA', 'hex') === Buffer.from('aa', 'hex'). Our
      // input format is canonically lowercase but defense-in-depth
      // accepts uppercase too.
      expect(tokensMatch('AABBCC', 'aabbcc')).toBe(true);
    });
  });
});
