/**
 * Protocol Params API Route
 * GET /api/v1/wallet/protocol/params - Get cached Livepeer protocol parameters
 */

import { NextRequest } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

const LIVEPEER_SUBGRAPH = 'https://api.thegraph.com/subgraphs/name/livepeer/arbitrum-one';

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

async function fetchProtocolParams(): Promise<ProtocolParams> {
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
            currentRound { id }
            totalActiveStake
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

    if (!proto) throw new Error('No protocol data');

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
  } catch {
    return cachedParams || {
      currentRound: 0,
      roundLength: 5760,
      unbondingPeriod: 7,
      totalBonded: '0',
      participationRate: 0,
      inflation: '0',
      lastUpdated: new Date().toISOString(),
    };
  }
}

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');

    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const params = await fetchProtocolParams();
    return success({ params });
  } catch (err) {
    console.error('Error fetching protocol params:', err);
    return errors.internal('Failed to fetch protocol params');
  }
}
