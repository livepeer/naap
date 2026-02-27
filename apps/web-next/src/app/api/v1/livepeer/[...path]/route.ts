/**
 * Proxy route for livepeer-svc (off-Vercel long-running service)
 * GET/POST/PUT/PATCH/DELETE /api/v1/livepeer/*
 *
 * Proxies requests to the livepeer-svc backend with:
 * - Auth token propagation (JWT)
 * - Observability headers (request-id, trace-id)
 * - Team context forwarding
 * - Mock data fallback when backend is unavailable (for development)
 *
 * livepeer-svc handles: staking, orchestrators, protocol parameters, deposits
 * (Phase 4 implementation)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthToken } from '@/lib/api/response';

const LIVEPEER_SVC_URL = process.env.LIVEPEER_SVC_URL || 'http://localhost:4010';

// Enable mock data fallback when livepeer-svc is unavailable
// Set LIVEPEER_MOCK_FALLBACK=false in production to get real errors
const USE_MOCK_FALLBACK = process.env.LIVEPEER_MOCK_FALLBACK !== 'false';

// ─── Mock Data for Development ───────────────────────────────────────────────

const MOCK_ORCHESTRATORS = [
  {
    address: '0x847791cBF03be716A7fe9Dc8c9Affe17Bd49Ae5e',
    serviceURI: 'https://orchestrator-1.livepeer.network',
    active: true,
    delegatedStake: '125000000000000000000000',
    rewardCut: '10000',
    feeShare: '500000',
    pricePerPixel: '1200',
    status: 'Registered',
  },
  {
    address: '0x9C10672CEE058Fd658103d90872fE431bb6C0AFa',
    serviceURI: 'https://orchestrator-2.livepeer.network',
    active: true,
    delegatedStake: '98000000000000000000000',
    rewardCut: '15000',
    feeShare: '450000',
    pricePerPixel: '1000',
    status: 'Registered',
  },
  {
    address: '0x4f4758F7167B18e1F5B3c1a7575E3eb584894dbc',
    serviceURI: 'https://orchestrator-3.livepeer.network',
    active: true,
    delegatedStake: '75000000000000000000000',
    rewardCut: '5000',
    feeShare: '600000',
    pricePerPixel: '800',
    status: 'Registered',
  },
  {
    address: '0xBD677e96a755207D348578727AA57A512C2022Bd',
    serviceURI: 'https://orchestrator-4.livepeer.network',
    active: false,
    delegatedStake: '50000000000000000000000',
    rewardCut: '20000',
    feeShare: '400000',
    pricePerPixel: '1500',
    status: 'Registered',
  },
  {
    address: '0x525419FF5707190389bfb5C87c375D710F5fCb0E',
    serviceURI: 'https://orchestrator-5.livepeer.network',
    active: true,
    delegatedStake: '200000000000000000000000',
    rewardCut: '8000',
    feeShare: '550000',
    pricePerPixel: '900',
    status: 'Registered',
  },
];

const MOCK_DELEGATOR = {
  bondedAmount: '10000000000000000000000',
  fees: '500000000000000000',
  delegateAddress: '0x847791cBF03be716A7fe9Dc8c9Affe17Bd49Ae5e',
  delegatedAmount: '10000000000000000000000',
  pendingStake: '0',
  pendingFees: '250000000000000000',
  status: 'Bonded',
};

const MOCK_SENDER_INFO = {
  deposit: '5000000000000000000',
  withdrawRound: '0',
  reserve: {
    fundsRemaining: '2500000000000000000',
    claimedInCurrentRound: '100000000000000000',
  },
};

const MOCK_PROTOCOL = {
  roundLength: 5760,
  currentRound: 3245,
  totalBonded: '15000000000000000000000000',
  totalSupply: '30000000000000000000000000',
  inflation: '1500',
  inflationChange: '3',
  targetBondingRate: '500000',
  paused: false,
};

const MOCK_ROUND = {
  number: 3245,
  initialized: true,
  startBlock: 18650000,
};

const MOCK_CAPABILITIES = [
  { id: 1, name: 'text-to-image', description: 'Generate images from text prompts' },
  { id: 2, name: 'image-to-image', description: 'Transform images with AI' },
  { id: 3, name: 'image-to-video', description: 'Animate images into videos' },
  { id: 4, name: 'upscale', description: 'Upscale images to higher resolution' },
  { id: 5, name: 'segment-anything-2', description: 'Segment objects in images/videos' },
  { id: 6, name: 'llm', description: 'Large language model inference' },
  { id: 7, name: 'audio-to-text', description: 'Transcribe audio to text' },
  { id: 8, name: 'live-video-to-video', description: 'Real-time video transformation' },
];

const MOCK_STATUS = {
  connected: true,
  version: '0.7.5-mock',
  network: 'arbitrum-one-mainnet',
  ethAddress: '0x1234567890123456789012345678901234567890',
  orchestratorMode: false,
  broadcasterMode: true,
  transcoder: false,
  mock: true,
};

const MOCK_PRICING = {
  maxPricePerPixel: '2000',
  maxPricePerCapability: {
    'text-to-image': '5000000',
    'image-to-image': '3000000',
    'llm': '1000000',
  },
};

const MOCK_NODES = [
  {
    id: 'default',
    name: 'Mock Gateway',
    cliUrl: 'http://localhost:7935',
    aiUrl: 'http://localhost:9935',
    mediaUrl: 'http://localhost:8935',
    role: 'mixed',
  },
];

const MOCK_METRICS = {
  requests: 1250,
  errors: 12,
  avgLatencyMs: 145,
  lastUpdated: new Date().toISOString(),
};

/**
 * Get mock data based on the requested path
 */
function getMockData(pathString: string): { data: unknown; mock: boolean } | null {
  // Match paths and return appropriate mock data
  if (pathString === 'orchestrators' || pathString === '') {
    return { data: MOCK_ORCHESTRATORS, mock: true };
  }
  if (pathString.startsWith('orchestrators/')) {
    const addr = pathString.replace('orchestrators/', '').toLowerCase();
    const orc = MOCK_ORCHESTRATORS.find(o => o.address.toLowerCase() === addr);
    return orc ? { data: orc, mock: true } : null;
  }
  if (pathString === 'delegator') {
    return { data: MOCK_DELEGATOR, mock: true };
  }
  if (pathString === 'gateway/sender-info') {
    return { data: MOCK_SENDER_INFO, mock: true };
  }
  if (pathString === 'gateway/pricing') {
    return { data: MOCK_PRICING, mock: true };
  }
  if (pathString === 'protocol') {
    return { data: MOCK_PROTOCOL, mock: true };
  }
  if (pathString === 'rounds/current') {
    return { data: MOCK_ROUND, mock: true };
  }
  if (pathString === 'ai/capabilities') {
    return { data: MOCK_CAPABILITIES, mock: true };
  }
  if (pathString === 'status') {
    return { data: MOCK_STATUS, mock: true };
  }
  if (pathString === 'nodes') {
    return { data: MOCK_NODES, mock: true };
  }
  if (pathString === 'metrics') {
    return { data: MOCK_METRICS, mock: true };
  }
  return null;
}

async function handleRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path } = await params;
  const pathString = path.join('/');
  const targetUrl = `${LIVEPEER_SVC_URL}/api/v1/livepeer/${pathString}${request.nextUrl.search}`;

  const token = getAuthToken(request);

  const headers = new Headers();
  headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json');

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Forward observability headers
  const requestId = request.headers.get('x-request-id');
  if (requestId) {
    headers.set('x-request-id', requestId);
  }

  const traceId = request.headers.get('x-trace-id');
  if (traceId) {
    headers.set('x-trace-id', traceId);
  }

  // Forward team context
  const teamId = request.headers.get('x-team-id');
  if (teamId) {
    headers.set('x-team-id', teamId);
  }

  // Forward IP headers
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    headers.set('x-forwarded-for', forwardedFor);
  }

  try {
    let body: string | undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        body = await request.text();
      } catch {
        // No body
      }
    }

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
    });

    const responseBody = await response.text();

    const responseHeaders = new Headers({
      'Content-Type': response.headers.get('Content-Type') || 'application/json',
    });

    if (requestId) {
      responseHeaders.set('x-request-id', requestId);
    }
    if (traceId) {
      responseHeaders.set('x-trace-id', traceId);
    }

    return new NextResponse(responseBody, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error('livepeer-svc proxy error:', err);

    // Return mock data if enabled and available
    if (USE_MOCK_FALLBACK && request.method === 'GET') {
      const mockData = getMockData(pathString);
      if (mockData) {
        console.log(`[livepeer-proxy] Returning mock data for: ${pathString}`);
        return NextResponse.json(
          {
            success: true,
            ...mockData,
            meta: {
              timestamp: new Date().toISOString(),
              fallback: true,
              message: 'livepeer-svc unavailable, returning mock data',
            },
          },
          { status: 200 }
        );
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'livepeer-svc is unavailable',
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 503 }
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, context);
}
