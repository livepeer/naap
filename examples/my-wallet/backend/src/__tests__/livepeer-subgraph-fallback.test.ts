import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('getSubgraphUrls fallback', () => {
  const SUBGRAPH_ID = 'FE63YgkzcpVocxdCEyEYbvjYqEf2kb1A6daMYRxmejYC';
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.LIVEPEER_SUBGRAPH_URL;
    delete process.env.SUBGRAPH_API_KEY;
    delete process.env.NEXT_PUBLIC_SUBGRAPH_API_KEY;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function loadGetSubgraphUrls() {
    const mod = await import('../lib/livepeer.js');
    return mod.getSubgraphUrls;
  }

  it('returns free decentralized endpoint when no env vars set', async () => {
    const getSubgraphUrls = await loadGetSubgraphUrls();
    const urls = getSubgraphUrls();
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe(`https://gateway.thegraph.com/api/subgraphs/id/${SUBGRAPH_ID}`);
  });

  it('prefers LIVEPEER_SUBGRAPH_URL over fallback', async () => {
    process.env.LIVEPEER_SUBGRAPH_URL = 'https://custom.subgraph.example.com/v1';
    const getSubgraphUrls = await loadGetSubgraphUrls();
    const urls = getSubgraphUrls();
    expect(urls).toEqual(['https://custom.subgraph.example.com/v1']);
  });

  it('prefers SUBGRAPH_API_KEY over fallback', async () => {
    process.env.SUBGRAPH_API_KEY = 'test-api-key-123';
    const getSubgraphUrls = await loadGetSubgraphUrls();
    const urls = getSubgraphUrls();
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('test-api-key-123');
    expect(urls[1]).toContain('test-api-key-123');
  });

  it('uses NEXT_PUBLIC_SUBGRAPH_API_KEY when SUBGRAPH_API_KEY is missing', async () => {
    process.env.NEXT_PUBLIC_SUBGRAPH_API_KEY = 'next-pub-key';
    const getSubgraphUrls = await loadGetSubgraphUrls();
    const urls = getSubgraphUrls();
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('next-pub-key');
  });
});
