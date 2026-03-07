import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';
import { getServices } from '@/lib/deployment-manager';

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const token = getAuthToken(request);
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const user = await validateSession(token);
    if (!user) return NextResponse.json({ success: false, error: 'Invalid session' }, { status: 401 });

    const { slug } = await params;
    const { registry } = getServices();
    if (!registry.has(slug)) return NextResponse.json({ success: false, error: `Provider not found: ${slug}` }, { status: 404 });

    const adapter = registry.get(slug);
    return NextResponse.json({
      success: true,
      data: {
        slug: adapter.slug, displayName: adapter.displayName, description: adapter.description,
        icon: adapter.icon, mode: adapter.mode, authMethod: adapter.authMethod, secretNames: adapter.apiConfig.secretNames,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
