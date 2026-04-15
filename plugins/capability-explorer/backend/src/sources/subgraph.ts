const SUBGRAPH_ID = 'FE63YgkzcpVocxdCEyEYbvjYqEf2kb1A6daMYRxmejYC';

let warned = false;

function getSubgraphUrls(): string[] {
  if (process.env.LIVEPEER_SUBGRAPH_URL) return [process.env.LIVEPEER_SUBGRAPH_URL];
  const key = process.env.SUBGRAPH_API_KEY || process.env.NEXT_PUBLIC_SUBGRAPH_API_KEY;
  if (key) {
    return [
      `https://gateway.thegraph.com/api/${key}/subgraphs/id/${SUBGRAPH_ID}`,
      `https://gateway-arbitrum.network.thegraph.com/api/${key}/subgraphs/id/${SUBGRAPH_ID}`,
    ];
  }
  if (!warned) {
    console.warn('[capability-explorer] No SUBGRAPH_API_KEY — using free endpoint (rate-limited)');
    warned = true;
  }
  return [`https://gateway.thegraph.com/api/subgraphs/id/${SUBGRAPH_ID}`];
}

export async function querySubgraph<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const urls = getSubgraphUrls();
  let lastErr: Error | null = null;

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Subgraph ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
      if (json.errors?.length) throw new Error(json.errors[0].message);
      return json.data as T;
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw lastErr ?? new Error('All subgraph endpoints failed');
}

export interface SubgraphTranscoder {
  id: string;
  active: boolean;
  serviceURI: string | null;
  totalStake: string;
}

export async function fetchActiveOrchestrators(): Promise<SubgraphTranscoder[]> {
  const data = await querySubgraph<{
    transcoders: Array<{
      id: string;
      active: boolean;
      serviceURI: string | null;
      totalStake: string;
      activationRound: string;
      deactivationRound: string;
    }>;
  }>(`{
    transcoders(
      first: 200
      where: { active: true }
      orderBy: totalStake
      orderDirection: desc
    ) {
      id
      active
      serviceURI
      totalStake
      activationRound
      deactivationRound
    }
  }`);

  return data.transcoders.map((t) => ({
    id: t.id,
    active: t.active,
    serviceURI: t.serviceURI,
    totalStake: t.totalStake,
  }));
}
