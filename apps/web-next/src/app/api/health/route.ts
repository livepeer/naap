import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isVercel, deployStage, features, baseSvcUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

interface HealthCheck {
  name: string;
  status: 'ok' | 'error' | 'warning';
  latency?: number;
  message?: string;
}

interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  timestamp: string;
  environment: {
    stage: string;
    isVercel: boolean;
    nodeEnv: string;
  };
  features: {
    vercelBlob: boolean;
    ably: boolean;
    googleOAuth: boolean;
    githubOAuth: boolean;
  };
  checks: HealthCheck[];
  uptime: number;
}

const startTime = Date.now();

/**
 * Comprehensive health check endpoint
 * GET /api/health
 *
 * Returns:
 * - 200: All checks pass
 * - 503: Critical checks failing
 *
 * Used by:
 * - Vercel deployment validation
 * - Load balancer health probes
 * - Monitoring systems (UptimeRobot, Checkly, etc.)
 */
export async function GET(): Promise<NextResponse> {
  const requestStart = Date.now();

  const health: HealthStatus = {
    status: 'ok',
    version: process.env.npm_package_version || '0.0.1',
    timestamp: new Date().toISOString(),
    environment: {
      stage: deployStage,
      isVercel,
      nodeEnv: process.env.NODE_ENV || 'development',
    },
    features: {
      vercelBlob: features.useVercelBlob,
      ably: features.useAbly,
      googleOAuth: features.hasGoogleOAuth,
      githubOAuth: features.hasGithubOAuth,
    },
    checks: [],
    uptime: Math.floor((Date.now() - startTime) / 1000),
  };

  // Check 1: Server Response (always passes if we get here)
  health.checks.push({
    name: 'server',
    status: 'ok',
    latency: Date.now() - requestStart,
    message: 'Responding',
  });

  // Check 2: Environment Configuration
  const requiredEnv = ['DATABASE_URL', 'NEXTAUTH_SECRET'];
  const missingEnv = requiredEnv.filter((key) => !process.env[key]);
  health.checks.push({
    name: 'environment',
    status: missingEnv.length === 0 ? 'ok' : 'error',
    message:
      missingEnv.length === 0
        ? 'All required variables set'
        : `Missing: ${missingEnv.join(', ')}`,
  });

  // Check 3: Database Connectivity
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    health.checks.push({
      name: 'database',
      status: 'ok',
      latency: Date.now() - dbStart,
      message: 'Connected',
    });
  } catch (error) {
    health.checks.push({
      name: 'database',
      status: 'error',
      message: error instanceof Error ? error.message : 'Connection failed',
    });
  }

  // Check 4: Backend Service (base-svc) - Quick check
  try {
    const svcStart = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${baseSvcUrl}/healthz`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    health.checks.push({
      name: 'backend',
      status: response.ok ? 'ok' : 'warning',
      latency: Date.now() - svcStart,
      message: response.ok ? 'Connected' : `HTTP ${response.status}`,
    });
  } catch {
    health.checks.push({
      name: 'backend',
      status: 'warning',
      message: 'Unreachable (may be starting)',
    });
  }

  // Check 5: Memory Usage
  const memoryUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
  const heapPercent = Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100);

  health.checks.push({
    name: 'memory',
    status: heapPercent < 90 ? 'ok' : 'warning',
    message: `${heapUsedMB}MB / ${heapTotalMB}MB (${heapPercent}%)`,
  });

  // Determine overall status
  const hasError = health.checks.some((check) => check.status === 'error');
  const hasWarning = health.checks.some((check) => check.status === 'warning');

  if (hasError) {
    health.status = 'error';
  } else if (hasWarning) {
    health.status = 'degraded';
  } else {
    health.status = 'ok';
  }

  // Critical checks that affect HTTP status code
  const criticalChecks = ['database', 'environment'];
  const criticalFailing = health.checks.some(
    (check) => criticalChecks.includes(check.name) && check.status === 'error'
  );

  const statusCode = criticalFailing ? 503 : 200;

  return NextResponse.json(health, {
    status: statusCode,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'X-Health-Status': health.status,
    },
  });
}
