import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken, getClientIP } from '@/lib/api/response';

const DEFAULT_SUBGRAPH_ID = 'FE63YgkzcpVocxdCEyEYbvjYqEf2kb1A6daMYRxmejYC';
const UPSTREAM_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_QUERY_DEPTH = 12;
const MAX_VARIABLES_BYTES = 8 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const ALLOWED_OPERATION_NAMES = new Set(['FeesOverview', 'ProtocolOverview']);
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function readEnvVar(...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = process.env[key];
    const value = raw?.trim();
    if (value) return value;
  }
  return undefined;
}

function isAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // Allow non-browser/server-side callers.
  return origin === request.nextUrl.origin;
}

function getQueryDepth(query: string): number {
  let maxDepth = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (const ch of query) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
    }
  }

  return maxDepth;
}

function checkRateLimit(identity: string): boolean {
  const now = Date.now();
  const current = rateLimitStore.get(identity);
  if (!current || now >= current.resetAt) {
    rateLimitStore.set(identity, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }

  current.count += 1;
  return current.count <= RATE_LIMIT_MAX_REQUESTS;
}

function validateGraphqlPayload(rawBody: string): { query: string; variables?: Record<string, unknown>; operationName?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error('Invalid JSON body');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('GraphQL body must be an object');
  }

  const payload = parsed as {
    query?: unknown;
    variables?: unknown;
    operationName?: unknown;
  };

  if (typeof payload.query !== 'string' || payload.query.trim().length === 0) {
    throw new Error('GraphQL query is required');
  }

  const query = payload.query;
  if (query.length > MAX_BODY_BYTES) {
    throw new Error('GraphQL query is too large');
  }
  if (query.includes('__schema') || query.includes('__type')) {
    throw new Error('Introspection queries are not allowed');
  }
  if (/\bmutation\b/i.test(query) || /\bsubscription\b/i.test(query)) {
    throw new Error('Only query operations are allowed');
  }
  if (getQueryDepth(query) > MAX_QUERY_DEPTH) {
    throw new Error('GraphQL query depth exceeds limit');
  }

  let operationName: string | undefined;
  if (typeof payload.operationName === 'string' && payload.operationName.trim().length > 0) {
    operationName = payload.operationName.trim();
  } else {
    const match = query.match(/\bquery\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (match) operationName = match[1];
  }
  if (!operationName || !ALLOWED_OPERATION_NAMES.has(operationName)) {
    throw new Error('Operation is not allowed');
  }

  let variables: Record<string, unknown> | undefined;
  if (payload.variables != null) {
    if (typeof payload.variables !== 'object' || Array.isArray(payload.variables)) {
      throw new Error('GraphQL variables must be an object');
    }
    const variablesString = JSON.stringify(payload.variables);
    if (variablesString.length > MAX_VARIABLES_BYTES) {
      throw new Error('GraphQL variables exceed size limit');
    }
    variables = payload.variables as Record<string, unknown>;
  }

  return { query, variables, operationName };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const apiKey = readEnvVar('SUBGRAPH_API_KEY');
  const subgraphId = readEnvVar('SUBGRAPH_ID') || DEFAULT_SUBGRAPH_ID;

  if (!apiKey) {
    return NextResponse.json(
      {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message:
            'Subgraph proxy is unavailable (set SUBGRAPH_API_KEY in apps/web-next/.env.local and restart Next.js)',
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 503 }
    );
  }

  if (!isAllowedOrigin(request)) {
    return NextResponse.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: 'Request origin is not allowed',
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 403 }
    );
  }

  const token = getAuthToken(request);
  if (!token) {
    return NextResponse.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'No auth token provided',
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 401 }
    );
  }

  const user = await validateSession(token);
  if (!user) {
    return NextResponse.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired session',
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 401 }
    );
  }

  const rateLimitIdentity = `${user.id}:${getClientIP(request) || 'unknown'}`;
  if (!checkRateLimit(rateLimitIdentity)) {
    return NextResponse.json(
      {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many subgraph requests. Please try again shortly.',
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 429 }
    );
  }

  const targetUrl = `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`;

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        {
          error: {
            code: 'BAD_REQUEST',
            message: 'GraphQL request body too large',
          },
          meta: { timestamp: new Date().toISOString() },
        },
        { status: 400 }
      );
    }

    let validatedPayload: { query: string; variables?: Record<string, unknown>; operationName?: string };
    try {
      validatedPayload = validateGraphqlPayload(rawBody);
    } catch (validationError) {
      return NextResponse.json(
        {
          error: {
            code: 'BAD_REQUEST',
            message: validationError instanceof Error ? validationError.message : 'Invalid GraphQL request',
          },
          meta: { timestamp: new Date().toISOString() },
        },
        { status: 400 }
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(validatedPayload),
        cache: 'no-store',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const responseBody = await response.text();
    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json',
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json(
        {
          error: {
            code: 'GATEWAY_TIMEOUT',
            message: 'Subgraph request timed out',
          },
          meta: { timestamp: new Date().toISOString() },
        },
        { status: 504 }
      );
    }

    let msg = err instanceof Error ? err.message : String(err);
    msg = msg.replace(/https?:\/\/[^\s]+/g, '[REDACTED]');
    console.error('[subgraph] proxy error:', msg);
    return NextResponse.json(
      {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Subgraph API is unavailable',
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 503 }
    );
  }
}
