/**
 * Service Gateway — Upstream Proxy
 *
 * Sends the transformed request to the upstream service.
 * Handles: timeouts, retries, SSE streaming, SSRF protection.
 */

import type { UpstreamRequest, ProxyResult } from './types';
import { validateHost } from './types';

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
  streaming: boolean
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

      return {
        response,
        upstreamLatencyMs,
        cached: false,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on abort (timeout) or SSRF block
      if (controller.signal.aborted) {
        throw new ProxyError(
          'UPSTREAM_TIMEOUT',
          `Upstream timed out after ${timeout}ms`,
          504
        );
      }

      // Retry on network errors only
      if (attempt < attempts - 1) {
        // Exponential backoff: 100ms, 200ms, 400ms...
        await sleep(100 * Math.pow(2, attempt));
        continue;
      }
    }
  }

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
