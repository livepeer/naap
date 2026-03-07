import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';
import { getServices } from '@/lib/deployment-manager';
import { prisma } from '@/lib/db';
import { setCurrentUserId } from '@/lib/deployment-manager/provider-fetch';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = getAuthToken(request);
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const user = await validateSession(token);
    if (!user) return NextResponse.json({ success: false, error: 'Invalid session' }, { status: 401 });

    const { id } = await params;
    const { orchestrator, registry } = getServices();
    const record = await orchestrator.get(id);
    if (!record) return NextResponse.json({ success: false, error: 'Deployment not found' }, { status: 404 });

    if (record.providerDeploymentId) {
      setCurrentUserId(user.id);
      try {
        const adapter = registry.get(record.providerSlug);
        await adapter.destroy(record.providerDeploymentId);
      } catch (err: any) {
        console.warn(`[force-destroy] Provider cleanup failed for ${id}: ${err.message}`);
      } finally {
        setCurrentUserId(null);
      }
    }

    const updated = await prisma.dmDeployment.update({
      where: { id },
      data: { status: 'DESTROYED' },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
