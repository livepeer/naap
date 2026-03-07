import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';
import { getServices } from '@/lib/deployment-manager';
import { getSecret } from '@/lib/deployment-manager/secrets';
import { setCurrentUserId } from '@/lib/deployment-manager/provider-fetch';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ providerId: string }> },
) {
  try {
    const token = getAuthToken(request);
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const user = await validateSession(token);
    if (!user) return NextResponse.json({ success: false, error: 'Invalid session' }, { status: 401 });

    const { providerId } = await params;
    const { registry } = getServices();

    if (!registry.has(providerId)) {
      return NextResponse.json({ success: false, error: `Unknown provider: ${providerId}` }, { status: 404 });
    }

    const adapter = registry.get(providerId);
    const secretName = adapter.apiConfig.secretNames[0];
    const secret = await getSecret(user.id, providerId, secretName);

    if (!secret) {
      return NextResponse.json({
        success: false,
        error: 'No credentials configured. Please save your API key first.',
        data: { connected: false, provider: providerId },
      }, { status: 400 });
    }

    setCurrentUserId(user.id);
    try {
      const testPath = adapter.apiConfig.healthCheckPath || '/';
      const res = await fetch(
        `${adapter.apiConfig.upstreamBaseUrl}${testPath}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(adapter.apiConfig.authHeaderTemplate
              ? { [adapter.apiConfig.authHeaderName || 'Authorization']: adapter.apiConfig.authHeaderTemplate.replace('{{secret}}', secret) }
              : {}),
          },
          signal: AbortSignal.timeout(15000),
        },
      );

      if (res.ok || res.status === 401 || res.status === 403) {
        const connected = res.ok;
        return NextResponse.json({
          success: true,
          data: {
            connected,
            provider: providerId,
            statusCode: res.status,
            message: connected ? 'Connection successful' : 'Authentication failed — check your API key',
          },
        });
      }

      return NextResponse.json({
        success: false,
        error: `Provider returned ${res.status}`,
        data: { connected: false, provider: providerId, statusCode: res.status },
      }, { status: 400 });
    } catch (err: any) {
      return NextResponse.json({
        success: false,
        error: `Connection failed: ${err.message}`,
        data: { connected: false, provider: providerId },
      }, { status: 400 });
    } finally {
      setCurrentUserId(null);
    }
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
