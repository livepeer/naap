import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';
import { getServices } from '@/lib/deployment-manager';
import { storeSecret } from '@/lib/deployment-manager/secrets';

export async function PUT(
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

    const body = await request.json();
    const secretValues: Record<string, string> = body.secrets;

    if (!secretValues || typeof secretValues !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Body must contain { secrets: { name: value } }' },
        { status: 400 },
      );
    }

    const saved: string[] = [];
    for (const [name, value] of Object.entries(secretValues)) {
      if (!value || !value.trim()) continue;
      const ok = await storeSecret(user.id, providerId, name, value.trim());
      if (ok) saved.push(name);
    }

    if (saved.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid secrets provided' },
        { status: 400 },
      );
    }

    const adapter = registry.get(providerId);
    return NextResponse.json({
      success: true,
      data: {
        message: `Credentials saved for ${adapter.displayName}`,
        savedSecrets: saved,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
