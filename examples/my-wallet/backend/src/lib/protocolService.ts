/**
 * Protocol params fetch with 5-minute cache
 */

interface ProtocolParams {
  currentRound: number;
  roundLength: number;
  unbondingPeriod: number;
  totalBonded: string;
  participationRate: number;
  inflation: string;
  lastUpdated: string;
}

let cachedParams: ProtocolParams | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const LIVEPEER_SUBGRAPH = 'https://api.thegraph.com/subgraphs/name/livepeer/arbitrum-one';

export async function getProtocolParams(): Promise<ProtocolParams> {
  const now = Date.now();
  if (cachedParams && now - cacheTime < CACHE_TTL) {
    return cachedParams;
  }

  try {
    const response = await fetch(LIVEPEER_SUBGRAPH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{
          protocol(id: "0") {
            currentRound { id length startBlock }
            totalActiveStake
            totalSupply
            participationRate
            inflation
            roundLength
            unbondingPeriod
          }
        }`,
      }),
    });

    const json = await response.json();
    const proto = json?.data?.protocol;

    if (!proto) {
      // Return cached or defaults if subgraph is unavailable
      return cachedParams || getDefaultParams();
    }

    const params: ProtocolParams = {
      currentRound: parseInt(proto.currentRound?.id || '0'),
      roundLength: parseInt(proto.roundLength || '5760'),
      unbondingPeriod: parseInt(proto.unbondingPeriod || '7'),
      totalBonded: proto.totalActiveStake || '0',
      participationRate: parseFloat(proto.participationRate || '0'),
      inflation: proto.inflation || '0',
      lastUpdated: new Date().toISOString(),
    };

    cachedParams = params;
    cacheTime = now;
    return params;
  } catch (err) {
    console.error('Failed to fetch protocol params:', err);
    return cachedParams || getDefaultParams();
  }
}

function getDefaultParams(): ProtocolParams {
  return {
    currentRound: 0,
    roundLength: 5760,
    unbondingPeriod: 7,
    totalBonded: '0',
    participationRate: 0,
    inflation: '0',
    lastUpdated: new Date().toISOString(),
  };
}
