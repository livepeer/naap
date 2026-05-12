import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { naapDiscoverAdapter } from '../../sources/naap-discover';

const mockFetch = vi.fn();

describe('NaapDiscoverAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const ctx = { authToken: 'test-token', requestUrl: 'http://localhost:3000/test' };

  it('kind is naap-discover', () => {
    expect(naapDiscoverAdapter.kind).toBe('naap-discover');
  });

  it('normalizes discover rows with capability splitting', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ([
        {
          address: 'https://orch-a.test',
          score: 0.95,
          capabilities: ['text-to-image/sdxl', 'live-video-to-video/streamdiffusion'],
          last_seen_ms: 5000,
          last_seen: '2025-01-01T00:00:00Z',
          recent_work: true,
        },
      ]),
    });

    const result = await naapDiscoverAdapter.fetchAll(ctx);
    expect(result.stats.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].orchUri).toBe('https://orch-a.test');
    expect(result.rows[0].score).toBe(0.95);
    expect(result.rows[0].capabilities).toEqual(['sdxl', 'streamdiffusion']);
    expect(result.rows[0].recentWork).toBe(true);
  });

  it('handles nested data envelope', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            address: 'https://orch-b.test',
            score: 0.8,
            capabilities: ['noop'],
            last_seen_ms: 1000,
            last_seen: '2025-01-01',
            recent_work: false,
          },
        ],
      }),
    });

    const result = await naapDiscoverAdapter.fetchAll(ctx);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].capabilities).toEqual(['noop']);
  });

  it('throws on non-200 response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    await expect(naapDiscoverAdapter.fetchAll(ctx)).rejects.toThrow('Discover API failed (503)');
  });
});
