/**
 * Service Gateway — Test Connectivity
 *
 * Sends a health-check request to the upstream service to verify
 * the connection and auth configuration are working.
 */

import { resolveSecrets } from '@/lib/gateway/secrets';
import { validateHost } from '@/lib/gateway/types';

export interface ConnectivityResult {
  success: boolean;
  statusCode: number | null;
  latencyMs: number;
  error: string | null;
}

/**
 * Test upstream connectivity by sending a health check request.
 */
export async function testUpstreamConnectivity(
  upstreamBaseUrl: string,
  healthCheckPath: string | null,
  authType: string,
  authConfig: Record<string, unknown>,
  secretRefs: string[],
  allowedHosts: string[],
  teamId: string,
  authToken: string
): Promise<ConnectivityResult> {
  const startMs = Date.now();

  try {
    // Validate host
    const url = new URL(upstreamBaseUrl);
    if (!validateHost(url.hostname, allowedHosts.length > 0 ? allowedHosts : [url.hostname])) {
      return {
        success: false,
        statusCode: null,
        latencyMs: Date.now() - startMs,
        error: `Host "${url.hostname}" is blocked by SSRF protection`,
      };
    }

    // Resolve secrets for auth
    const secrets = await resolveSecrets(teamId, secretRefs, authToken);

    // Build headers
    const headers: Record<string, string> = {};
    if (authType === 'bearer') {
      const tokenRef = (authConfig.tokenRef as string) || 'token';
      const token = secrets[tokenRef] || '';
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } else if (authType === 'basic') {
      const username = secrets[(authConfig.usernameRef as string) || 'username'] || '';
      const password = secrets[(authConfig.passwordRef as string) || 'password'] || '';
      headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    } else if (authType === 'header') {
      const headerEntries = (authConfig.headers as Record<string, string>) || {};
      for (const [key, valueRef] of Object.entries(headerEntries)) {
        headers[key] = secrets[valueRef] || valueRef;
      }
    }

    const testPath = healthCheckPath || '/';
    const testUrl = `${upstreamBaseUrl.replace(/\/$/, '')}${testPath}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(testUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    return {
      success: response.ok,
      statusCode: response.status,
      latencyMs: Date.now() - startMs,
      error: response.ok ? null : `Upstream returned ${response.status} ${response.statusText}`,
    };
  } catch (err) {
    return {
      success: false,
      statusCode: null,
      latencyMs: Date.now() - startMs,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
