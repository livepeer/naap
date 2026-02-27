/**
 * Service Gateway — Upstream Proxy
 *
 * Sends the transformed request to the upstream service.
 * Handles: timeouts, retries, SSE streaming, SSRF protection, circuit breaking.
 */

import type { UpstreamRequest, ProxyResult } from './types';
import { validateHost } from './types';

// ── Circuit Breaker ──

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreaker {
  state: CircuitState;
  failures: number;
  lastFailureAt: number;
  nextProbeAt: number;
}

const FAILURE_THRESHOLD = 5;
const OPEN_DURATION_MS = 30_000;
const circuitBreakers = new Map<string, CircuitBreaker>();

function getCircuit(slug: string): CircuitBreaker {
  let cb = circuitBreakers.get(slug);
  if (!cb) {
    cb = { state: 'CLOSED', failures: 0, lastFailureAt: 0, nextProbeAt: 0 };
    circuitBreakers.set(slug, cb);
  }
  if (cb.state === 'OPEN' && Date.now() >= cb.nextProbeAt) {
    cb.state = 'HALF_OPEN';
  }
  return cb;
}

function recordSuccess(slug: string): void {
  const cb = circuitBreakers.get(slug);
  if (cb) {
    cb.state = 'CLOSED';
    cb.failures = 0;
  }
}

function recordFailure(slug: string): void {
  const cb = getCircuit(slug);
  cb.failures++;
  cb.lastFailureAt = Date.now();
  if (cb.failures >= FAILURE_THRESHOLD || cb.state === 'HALF_OPEN') {
    cb.state = 'OPEN';
    cb.nextProbeAt = Date.now() + OPEN_DURATION_MS;
  }
}

/**
 * Proxy a request to the upstream service.
 *
 * @param upstream  - Fully built upstream request (URL, method, headers, body)
 * @param timeout   - Timeout in milliseconds
 * @param retries   - Number of retry attempts on failure
 * @param allowedHosts - Allowed upstream hostnames (SSRF protection)
 * @param streaming - Whether SSE streaming is enabled for this connector
 */
export async function proxyToUpstream(
  upstream: UpstreamRequest,
  timeout: number,
  retries: number,
  allowedHosts: string[],
  streaming: boolean,
  connectorSlug?: string
): Promise<ProxyResult> {
  // ── SSRF Protection ──
  const url = new URL(upstream.url);
  if (!validateHost(url.hostname, allowedHosts)) {
    throw new ProxyError(
      'SSRF_BLOCKED',
      `Host "${url.hostname}" is not allowed`,
      403
    );
  }

  // ── Circuit Breaker ──
  if (connectorSlug) {
    const cb = getCircuit(connectorSlug);
    if (cb.state === 'OPEN') {
      throw new ProxyError(
        'CIRCUIT_OPEN',
        `Circuit breaker open for connector "${connectorSlug}". Retry after cooldown.`,
        503
      );
    }
  }

  let lastError: Error | null = null;
  const attempts = 1 + Math.max(0, retries);

  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const startMs = Date.now();

    try {
      const response = await fetch(upstream.url, {
        method: upstream.method,
        headers: upstream.headers,
        body: upstream.body,
        signal: controller.signal,
        // @ts-expect-error -- Next.js fetch option
        cache: 'no-store',
      });

      clearTimeout(timeoutId);
      const upstreamLatencyMs = Date.now() - startMs;

      if (connectorSlug) recordSuccess(connectorSlug);

      return {
        response,
        upstreamLatencyMs,
        cached: false,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err instanceof Error ? err : new Error(String(err));

      if (controller.signal.aborted) {
        if (connectorSlug) recordFailure(connectorSlug);
        throw new ProxyError(
          'UPSTREAM_TIMEOUT',
          `Upstream timed out after ${timeout}ms`,
          504
        );
      }

      if (attempt < attempts - 1) {
        await sleep(100 * Math.pow(2, attempt));
        continue;
      }
    }
  }

  if (connectorSlug) recordFailure(connectorSlug);

  throw new ProxyError(
    'UPSTREAM_UNAVAILABLE',
    lastError?.message || 'Upstream service unavailable',
    503
  );
}

/**
 * Custom error class for proxy failures with HTTP status codes.
 */
export class ProxyError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.name = 'ProxyError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
