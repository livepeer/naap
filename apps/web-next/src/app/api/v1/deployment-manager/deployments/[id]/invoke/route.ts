import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';
import { getServices } from '@/lib/deployment-manager';
import { authenticatedProviderFetch, setCurrentUserId } from '@/lib/deployment-manager/provider-fetch';
import { getSecret } from '@/lib/deployment-manager/secrets';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = getAuthToken(request);
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const user = await validateSession(token);
    if (!user) return NextResponse.json({ success: false, error: 'Invalid session' }, { status: 401 });

    const { id } = await params;
    const timeoutMs = parseInt(request.nextUrl.searchParams.get('timeout') || '60000', 10);
    const { orchestrator, registry, usageService } = getServices();
    const deployment = await orchestrator.get(id);
    if (!deployment) return NextResponse.json({ success: false, error: 'Deployment not found' }, { status: 404 });
    if (!deployment.endpointUrl && !deployment.providerDeploymentId) {
      return NextResponse.json({ success: false, error: 'No endpoint URL configured' }, { status: 400 });
    }

    const adapter = registry.has(deployment.providerSlug) ? registry.get(deployment.providerSlug) : null;
    const body = await request.json().catch(() => ({}));
    const start = Date.now();
    setCurrentUserId(user.id);
    try {
      let proxyRes: Response;

      if (deployment.providerSlug === 'runpod' && deployment.providerDeploymentId && adapter) {
        proxyRes = await authenticatedProviderFetch(
          adapter.slug,
          { ...adapter.apiConfig, upstreamBaseUrl: 'https://api.runpod.ai' },
          `/v2/${deployment.providerDeploymentId}/run`,
          { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) },
        );
      } else if (deployment.endpointUrl) {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (adapter && adapter.apiConfig.authType !== 'none' && adapter.apiConfig.secretNames[0]) {
          const secret = await getSecret(user.id, deployment.providerSlug, adapter.apiConfig.secretNames[0]);
          if (secret && adapter.apiConfig.authHeaderTemplate) {
            const name = adapter.apiConfig.authHeaderName || 'Authorization';
            headers[name] = adapter.apiConfig.authHeaderTemplate.replace('{{secret}}', secret);
          }
        }
        proxyRes = await fetch(deployment.endpointUrl, {
          method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
        });
      } else {
        return NextResponse.json({ success: false, error: 'No endpoint URL configured' }, { status: 400 });
      }

      const responseTimeMs = Date.now() - start;
      const responseBody = await proxyRes.text();
      const outcome = proxyRes.ok ? 'completed' : 'failed';
      await usageService.record(id, outcome, responseTimeMs);

      let parsedResponse;
      try { parsedResponse = JSON.parse(responseBody); } catch { parsedResponse = responseBody; }

      return NextResponse.json({
        success: proxyRes.ok,
        data: {
          status: proxyRes.status,
          statusText: proxyRes.statusText,
          responseTimeMs,
          body: parsedResponse,
        },
      }, { status: proxyRes.ok ? 200 : 502 });
    } catch (err: any) {
      const responseTimeMs = Date.now() - start;
      await usageService.record(id, 'failed', responseTimeMs);
      return NextResponse.json({
        success: false,
        error: err.name === 'TimeoutError' ? `Request timed out (${timeoutMs / 1000}s)` : err.message,
        data: { responseTimeMs },
      }, { status: 504 });
    } finally {
      setCurrentUserId(null);
    }
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
