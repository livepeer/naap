import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/client.js', () => ({ prisma: {} }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// Mock cache to be passthrough
vi.mock('@naap/cache', () => ({
  cacheGetOrSet: (_key: string, fn: () => any) => fn(),
}));

describe('getStakingHistoryFromState fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
  });

  function padHex(val: bigint): string {
    return val.toString(16).padStart(64, '0');
  }

  function setupRpcMocks(opts: {
    bondedAmount: bigint;
    fees: bigint;
    delegateAddr: string;
    pendingStake?: bigint;
    currentRound?: bigint;
  }) {
    const { bondedAmount, fees, delegateAddr, currentRound = 4000n } = opts;
    const pendingStake = opts.pendingStake ?? bondedAmount;
    let ethCallCount = 0;

    fetchMock.mockImplementation(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);

      // Subgraph POST — always fail to force RPC fallback
      if (body.query) {
        return { ok: false, text: async () => 'subgraph down' };
      }

      if (body.method === 'eth_call') {
        ethCallCount++;
        // Call 1: getProtocol → currentRound (via eth_call to RoundsManager)
        // The order of eth_call may vary; match by target contract selector
        const calldata = body.params?.[0]?.data || '';

        // currentRound selector: 0x8a19c8bc
        if (calldata.startsWith('0x8a19c8bc')) {
          return { json: async () => ({ result: '0x' + padHex(currentRound) }) };
        }
        // roundLength: 0xbf5eee47
        if (calldata.startsWith('0xbf5eee47')) {
          return { json: async () => ({ result: '0x' + padHex(5760n) }) };
        }
        // lockPeriod: 0x0e5f0480 
        if (calldata.startsWith('0x0e5f0480')) {
          return { json: async () => ({ result: '0x' + padHex(2n) }) };
        }
        // totalSupply: 0x18160ddd
        if (calldata.startsWith('0x18160ddd')) {
          return { json: async () => ({ result: '0x' + padHex(25000000n * 10n ** 18n) }) };
        }
        // totalStake: various
        if (calldata.startsWith('0x3a47e7b2') || calldata.startsWith('0x6b2eb7ed')) {
          return { json: async () => ({ result: '0x' + padHex(15000000n * 10n ** 18n) }) };
        }
        // getDelegator selector: 0xa64ad595 (or similar)
        if (calldata.startsWith('0xa64ad595')) {
          const delegateClean = delegateAddr.replace('0x', '').padStart(64, '0');
          const result = '0x' + padHex(bondedAmount) + padHex(fees) + delegateClean +
            padHex(0n) + padHex(100n) + padHex(3990n);
          return { json: async () => ({ result }) };
        }
        // pendingStake selector: 0x9d0b2c7a
        if (calldata.startsWith('0x9d0b2c7a')) {
          return { json: async () => ({ result: '0x' + padHex(pendingStake) }) };
        }
        // pendingFees: 0xf595f1cc
        if (calldata.startsWith('0xf595f1cc')) {
          return { json: async () => ({ result: '0x' + padHex(fees) }) };
        }
        // paused: 0x5c975abb
        if (calldata.startsWith('0x5c975abb')) {
          return { json: async () => ({ result: '0x' + padHex(0n) }) };
        }
        // inflation: 0xd5189233
        if (calldata.startsWith('0xd5189233')) {
          return { json: async () => ({ result: '0x' + padHex(137n) }) };
        }
        // inflationChange: 0x9ae8bcb3
        if (calldata.startsWith('0x9ae8bcb3')) {
          return { json: async () => ({ result: '0x' + padHex(0n) }) };
        }
        // activeTranscoderCount or transcoderPoolSize
        if (calldata.startsWith('0x2a4e0d55')) {
          return { json: async () => ({ result: '0x' + padHex(100n) }) };
        }

        // Default fallback for any other selectors
        return { json: async () => ({ result: '0x' + padHex(0n) }) };
      }

      // Default
      return { ok: false, text: async () => 'unknown' };
    });
  }

  it('returns empty array when delegator is null', async () => {
    fetchMock.mockImplementation(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (body.query) return { ok: false, text: async () => 'fail' };
      if (body.method === 'eth_call') {
        const calldata = body.params?.[0]?.data || '';
        // currentRound
        if (calldata.startsWith('0x8a19c8bc')) {
          return { json: async () => ({ result: '0x' + '0'.repeat(63) + 'a' }) };
        }
        // getDelegator — null (zero)
        return { json: async () => ({ result: '0x' }) };
      }
      return { ok: false, text: async () => '' };
    });

    const { getStakingHistory } = await import('../lib/livepeer.js');
    const events = await getStakingHistory('0x0000000000000000000000000000000000000001');
    expect(events).toEqual([]);
  });

  it('includes bond event with principal value', async () => {
    const bondedAmount = 1000n * 10n ** 18n;
    const pendingStake = 1050n * 10n ** 18n;
    setupRpcMocks({
      bondedAmount,
      fees: 0n,
      delegateAddr: '0x' + 'aa'.repeat(20),
      pendingStake,
    });

    const { getStakingHistory } = await import('../lib/livepeer.js');
    const events = await getStakingHistory('0x' + 'bb'.repeat(20));

    const bondEvent = events.find(e => e.type === 'bond');
    expect(bondEvent).toBeDefined();
    // principal is bondedAmount from contract (before pending rewards)
    expect(bondEvent!.amount).toBe(bondedAmount.toString());
  });

  it('includes synthetic reward event when pendingStake > bondedAmount', async () => {
    const bondedAmount = 1000n * 10n ** 18n;
    const pendingStake = 1050n * 10n ** 18n;
    setupRpcMocks({
      bondedAmount,
      fees: 0n,
      delegateAddr: '0x' + 'aa'.repeat(20),
      pendingStake,
    });

    const { getStakingHistory } = await import('../lib/livepeer.js');
    const events = await getStakingHistory('0x' + 'cc'.repeat(20));

    const rewardEvent = events.find(e => e.type === 'reward');
    expect(rewardEvent).toBeDefined();
    expect(BigInt(rewardEvent!.amount)).toBe(pendingStake - bondedAmount);
  });

  it('includes synthetic withdrawFees event when fees > 0', async () => {
    const fees = 5n * 10n ** 16n;
    setupRpcMocks({
      bondedAmount: 1000n * 10n ** 18n,
      fees,
      delegateAddr: '0x' + 'aa'.repeat(20),
    });

    const { getStakingHistory } = await import('../lib/livepeer.js');
    const events = await getStakingHistory('0x' + 'dd'.repeat(20));

    const feeEvent = events.find(e => e.type === 'withdrawFees');
    expect(feeEvent).toBeDefined();
    expect(BigInt(feeEvent!.amount)).toBe(fees);
  });
});
