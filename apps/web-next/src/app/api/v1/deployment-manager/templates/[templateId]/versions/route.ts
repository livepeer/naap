import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';
import { getServices } from '@/lib/deployment-manager';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) {
  try {
    const token = getAuthToken(request);
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const user = await validateSession(token);
    if (!user) return NextResponse.json({ success: false, error: 'Invalid session' }, { status: 401 });

    const { templateId } = await params;
    const { artifactRegistry } = getServices();

    const artifact = artifactRegistry.getArtifact(templateId);
    if (!artifact) {
      return NextResponse.json({ success: false, error: `Unknown template: ${templateId}` }, { status: 404 });
    }

    const versions = await artifactRegistry.getVersions(templateId);
    return NextResponse.json({ success: true, data: versions });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
