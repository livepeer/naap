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

    const entries = Object.entries(secretValues).filter(([, v]) => typeof v === 'string' && v.trim());
    if (entries.length === 0) {
      return NextResponse.json(
        { success: false, error: `No valid secrets provided. Received keys: [${Object.keys(secretValues).join(', ')}], types: [${Object.values(secretValues).map(v => typeof v).join(', ')}]` },
        { status: 400 },
      );
    }

    const saved: string[] = [];
    const errors: string[] = [];
    for (const [name, value] of entries) {
      try {
        const ok = await storeSecret(user.id, providerId, name, value.trim());
        if (ok) saved.push(name);
        else errors.push(`${name}: store returned false`);
      } catch (e: any) {
        console.error(`[dm/credentials] storeSecret failed for "${name}":`, e);
        errors.push(`${name}: ${e.message}`);
      }
    }

    if (saved.length === 0) {
      return NextResponse.json(
        { success: false, error: `Failed to save secrets: ${errors.join('; ')}` },
        { status: 500 },
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
