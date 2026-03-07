import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';
import { getServices } from '@/lib/deployment-manager';
import { hasSecret, storeSecret } from '@/lib/deployment-manager/secrets';

export async function GET(request: NextRequest, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    const token = getAuthToken(request);
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const user = await validateSession(token);
    if (!user) return NextResponse.json({ success: false, error: 'Invalid session' }, { status: 401 });

    const { providerId } = await params;
    const { registry } = getServices();

    if (!registry.has(providerId)) {
      return NextResponse.json({ success: true, data: { configured: false, providerId } });
    }

    const adapter = registry.get(providerId);
    const secretName = adapter.apiConfig.secretNames[0];
    const secretStatus = await hasSecret(user.id, providerId, secretName);

    return NextResponse.json({
      success: true,
      data: {
        configured: secretStatus.configured,
        providerId,
        maskedValue: secretStatus.maskedValue,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ providerId: string }> }) {
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

    const body = await request.json();
    const { apiKey } = body;

    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'apiKey is required' }, { status: 400 });
    }

    const adapter = registry.get(providerId);
    const secretName = adapter.apiConfig.secretNames[0];
    const ok = await storeSecret(user.id, providerId, secretName, apiKey);

    if (!ok) {
      return NextResponse.json({ success: false, error: 'Failed to store credentials' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: { configured: true, providerId } });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
