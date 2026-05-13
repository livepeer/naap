import { describe, expect, it } from 'vitest';
import { resolveAccountId } from '../src/account-resolver.js';

describe('resolveAccountId', () => {
  it('returns the tenantId unchanged (v1 — one tenant per account)', async () => {
    const tenantId = 'tenant-abc';
    expect(await resolveAccountId(tenantId)).toBe(tenantId);
  });

  it('returns the same value on repeated calls', async () => {
    const tenantId = 'tenant-xyz';
    expect(await resolveAccountId(tenantId)).toBe(tenantId);
    expect(await resolveAccountId(tenantId)).toBe(tenantId);
  });
});
