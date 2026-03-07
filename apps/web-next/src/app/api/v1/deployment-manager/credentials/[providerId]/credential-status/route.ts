import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';
import { getServices } from '@/lib/deployment-manager';
import { hasSecret } from '@/lib/deployment-manager/secrets';

export async function GET(
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
      return NextResponse.json({ success: false, error: `Provider not found: ${providerId}` }, { status: 404 });
    }

    const adapter = registry.get(providerId);
    const secretNames = adapter.apiConfig.secretNames;

    const secretStatuses = await Promise.all(
      secretNames.map((name) => hasSecret(user.id, providerId, name)),
    );

    const configured = secretStatuses.every((s) => s.configured);

    return NextResponse.json({
      success: true,
      data: {
        configured,
        secrets: secretStatuses,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
