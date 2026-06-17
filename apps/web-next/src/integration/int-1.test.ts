/** @vitest-environment node */

/**
 * INT-1 / INV-1 — no-regression with ALL new flags OFF (consolidated branch).
 *
 * The whole point of the integration branch is that merging 11 feature branches
 * changes NOTHING until a flag is flipped. This proves it two ways:
 *   1. Every NEW cross-system flag defaults OFF in KNOWN_FLAGS.
 *   2. The front door (the new cross-system entry point) is a 404 no-op when its
 *      flag is OFF and never touches the database — so existing callers fall back
 *      to their current path unchanged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { KNOWN_FLAGS } from '@/lib/feature-flags';

/** The flags introduced by the Phase-0/2 branches — all must default OFF. */
const NEW_CROSS_SYSTEM_FLAGS = [
  'provider_adapters',
  'team_seats',
  'native_keys',
  'key_validation_front_door',
  'app_registry',
  'usage_ingest',
  'db_adapter_registry',
] as const;

describe('INV-1 — every new cross-system flag defaults OFF', () => {
  it.each(NEW_CROSS_SYSTEM_FLAGS)('flag %s is present and OFF by default', (key) => {
    const flag = KNOWN_FLAGS.find((f) => f.key === key);
    expect(flag, `flag ${key} should be registered`).toBeDefined();
    expect(flag?.enabled, `flag ${key} must default OFF`).toBe(false);
  });

  it('the merge introduced no flag that defaults ON (except pre-existing enableTeams)', () => {
    const onByDefault = KNOWN_FLAGS.filter((f) => f.enabled).map((f) => f.key);
    expect(onByDefault).toEqual(['enableTeams']);
  });
});

// Front-door no-op proof (flag OFF) — isolated module mocks.
const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/feature-flags')>();
  return { ...actual, isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a) };
});
vi.mock('@/lib/api/rate-limit', () => ({ enforceRateLimit: vi.fn(() => null) }));
const prisma = vi.hoisted(() => ({
  devApiKey: { findUnique: vi.fn(), update: vi.fn() },
  team: { findUnique: vi.fn() },
  application: { findFirst: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

describe('INT-1 — front door is a 404 no-op when its flag is OFF', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFeatureEnabled.mockResolvedValue(false); // ALL flags OFF
  });

  it('404s and never touches the DB (callers keep their existing path)', async () => {
    const { POST } = await import('@/app/api/v1/keys/validate/route');
    const res = await POST(
      new NextRequest('http://localhost/api/v1/keys/validate', {
        method: 'POST',
        headers: { authorization: 'Bearer naap_anything', 'x-app-id': 'storyboard' },
      }),
    );
    expect(res.status).toBe(404);
    expect(prisma.devApiKey.findUnique).not.toHaveBeenCalled();
    expect(prisma.application.findFirst).not.toHaveBeenCalled();
  });
});
