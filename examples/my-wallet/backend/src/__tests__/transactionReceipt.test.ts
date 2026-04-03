import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

vi.mock('../db/client.js', () => ({ prisma: {} }));

describe('getTransactionReceipt', () => {
  let getTransactionReceipt: typeof import('../lib/livepeer.js').getTransactionReceipt;

  beforeEach(async () => {
    vi.resetModules();
    fetchMock.mockReset();
    const mod = await import('../lib/livepeer.js');
    getTransactionReceipt = mod.getTransactionReceipt;
  });

  it('returns gasUsed and effectiveGasPrice from RPC response', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: {
          gasUsed: '0x5208',
          effectiveGasPrice: '0x3b9aca00',
          status: '0x1',
          blockNumber: '0xa',
        },
      }),
    });

    const receipt = await getTransactionReceipt('0xabc123');
    expect(receipt).not.toBeNull();
    expect(receipt!.gasUsed).toBe('0x5208');
    expect(receipt!.effectiveGasPrice).toBe('0x3b9aca00');
    expect(receipt!.status).toBe('0x1');
  });

  it('returns null for unknown tx hash', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: null,
      }),
    });

    const receipt = await getTransactionReceipt('0xnonexistent');
    expect(receipt).toBeNull();
  });

  it('returns null on RPC timeout/error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('fetch timeout'));

    const receipt = await getTransactionReceipt('0xtimeout');
    expect(receipt).toBeNull();
  });
});
