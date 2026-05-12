import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subgraphAdapter } from '../../sources/subgraph';

const mockFetch = vi.fn();

describe('SubgraphAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const ctx = { authToken: 'test-token', requestUrl: 'http://localhost:3000/test' };

  it('kind is livepeer-subgraph', () => {
    expect(subgraphAdapter.kind).toBe('livepeer-subgraph');
  });

  it('fetches and normalizes transcoders', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          transcoders: [
            {
              id: '0xAAA',
              serviceURI: 'https://orch-a.test',
              activationRound: '100',
              deactivationRound: '0',
              totalStake: '1000000',
              active: true,
            },
            {
              id: '0xBBB',
              serviceURI: null,
              activationRound: '200',
              deactivationRound: '0',
              totalStake: '500000',
              active: true,
            },
          ],
        },
      }),
    });

    const result = await subgraphAdapter.fetchAll(ctx);
    expect(result.stats.ok).toBe(true);
    // Should filter out orch without serviceURI
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].ethAddress).toBe('0xaaa');
    expect(result.rows[0].orchUri).toBe('https://orch-a.test');
  });

  it('throws on non-200 response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    await expect(subgraphAdapter.fetchAll(ctx)).rejects.toThrow('Subgraph query failed (500)');
  });
});
