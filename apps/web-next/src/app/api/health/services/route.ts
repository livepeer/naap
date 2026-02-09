import { NextResponse } from 'next/server';
import {
  baseSvcUrl,
  pluginServerUrl,
  livepeerSvcUrl,
  pipelineGatewayUrl,
  storageSvcUrl,
  infrastructureSvcUrl,
} from '@/lib/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface ServiceHealth {
  name: string;
  url: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  latency?: number;
  message?: string;
}

interface ServicesHealthResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  services: ServiceHealth[];
  summary: {
    total: number;
    healthy: number;
    unhealthy: number;
  };
}

const TIMEOUT_MS = 5000;

/**
 * Check health of a single service
 */
async function checkService(name: string, baseUrl: string): Promise<ServiceHealth> {
  const url = `${baseUrl}/healthz`;
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    clearTimeout(timeoutId);
    const latency = Date.now() - startTime;

    if (response.ok) {
      return {
        name,
        url: baseUrl,
        status: 'healthy',
        latency,
        message: 'OK',
      };
    }

    if (response.status === 503) {
      return {
        name,
        url: baseUrl,
        status: 'degraded',
        latency,
        message: 'Service degraded',
      };
    }

    return {
      name,
      url: baseUrl,
      status: 'unhealthy',
      latency,
      message: `HTTP ${response.status}`,
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    const message =
      error instanceof Error
        ? error.name === 'AbortError'
          ? 'Timeout'
          : error.message
        : 'Unknown error';

    return {
      name,
      url: baseUrl,
      status: 'unhealthy',
      latency,
      message,
    };
  }
}

/**
 * Health check endpoint for all backend services
 * GET /api/health/services
 *
 * Returns health status of all off-Vercel services.
 * Used by monitoring systems and deployment validation.
 */
export async function GET(): Promise<NextResponse> {
  const services = [
    { name: 'base-svc', url: baseSvcUrl },
    { name: 'plugin-server', url: pluginServerUrl },
    { name: 'livepeer-svc', url: livepeerSvcUrl },
    { name: 'pipeline-gateway', url: pipelineGatewayUrl },
    { name: 'storage-svc', url: storageSvcUrl },
    { name: 'infrastructure-svc', url: infrastructureSvcUrl },
  ];

  // Check all services in parallel
  const results = await Promise.all(
    services.map((svc) => checkService(svc.name, svc.url))
  );

  const healthy = results.filter((r) => r.status === 'healthy').length;
  const unhealthy = results.filter((r) => r.status === 'unhealthy').length;

  // Determine overall status
  let status: 'ok' | 'degraded' | 'error';
  if (unhealthy === 0) {
    status = 'ok';
  } else if (healthy > 0) {
    status = 'degraded';
  } else {
    status = 'error';
  }

  const response: ServicesHealthResponse = {
    status,
    timestamp: new Date().toISOString(),
    services: results,
    summary: {
      total: results.length,
      healthy,
      unhealthy,
    },
  };

  const statusCode = status === 'ok' ? 200 : status === 'degraded' ? 207 : 503;

  return NextResponse.json(response, {
    status: statusCode,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  });
}
