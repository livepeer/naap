import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { naapPricingAdapter } from '../../sources/naap-pricing';

const mockFetch = vi.fn();

describe('NaapPricingAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const ctx = { authToken: 'test-token', requestUrl: 'http://localhost:3000/test' };

  it('kind is naap-pricing', () => {
    expect(naapPricingAdapter.kind).toBe('naap-pricing');
  });

  it('normalizes pricing rows', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ([
        {
          orchAddress: '0xAAA',
          orchName: 'Orchestrator A',
          pipeline: 'text-to-image',
          model: 'sdxl',
          priceWeiPerUnit: 50000,
          pixelsPerUnit: 1000000,
          isWarm: true,
        },
        {
          orchAddress: '0xBBB',
          orchName: 'Orchestrator B',
          pipeline: 'live-video-to-video',
          model: 'streamdiffusion',
          priceWeiPerUnit: 80000,
          pixelsPerUnit: 500000,
          isWarm: false,
        },
      ]),
    });

    const result = await naapPricingAdapter.fetchAll(ctx);
    expect(result.stats.ok).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].ethAddress).toBe('0xaaa');
    expect(result.rows[0].pricePerUnit).toBe(50000);
    expect(result.rows[0].isWarm).toBe(true);
    expect(result.rows[1].ethAddress).toBe('0xbbb');
  });

  it('handles data envelope', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            orchAddress: '0xCCC',
            orchName: 'Orch C',
            pipeline: 'noop',
            model: 'noop',
            priceWeiPerUnit: 10,
            pixelsPerUnit: 1,
            isWarm: true,
          },
        ],
      }),
    });

    const result = await naapPricingAdapter.fetchAll(ctx);
    expect(result.rows).toHaveLength(1);
  });

  it('throws on non-200 response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    await expect(naapPricingAdapter.fetchAll(ctx)).rejects.toThrow('Pricing API failed (404)');
  });
});
