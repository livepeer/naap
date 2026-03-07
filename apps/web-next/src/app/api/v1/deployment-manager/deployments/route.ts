import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';
import { getServices, CreateDeploymentSchema } from '@/lib/deployment-manager';
import type { DeploymentStatus } from '@/lib/deployment-manager';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const user = await validateSession(token);
    if (!user) return NextResponse.json({ success: false, error: 'Invalid session' }, { status: 401 });

    const { orchestrator } = getServices();
    const sp = request.nextUrl.searchParams;
    const deployments = await orchestrator.list({
      status: sp.get('status') as DeploymentStatus | undefined,
      providerSlug: sp.get('provider') || undefined,
      ownerUserId: sp.get('userId') || undefined,
      teamId: sp.get('teamId') || undefined,
    });

    const inProgressStates = ['PROVISIONING', 'DEPLOYING', 'VALIDATING'];
    const synced = await Promise.all(
      deployments.map(async (d) => {
        if (inProgressStates.includes(d.status) && d.providerDeploymentId) {
          try { return await orchestrator.syncStatus(d.id, user.id); } catch { /* ignore */ }
        }
        return d;
      }),
    );

    return NextResponse.json({ success: true, data: synced, total: synced.length });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const user = await validateSession(token);
    if (!user) return NextResponse.json({ success: false, error: 'Invalid session' }, { status: 401 });

    const body = await request.json();
    const parsed = CreateDeploymentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Validation failed', details: parsed.error.format() }, { status: 400 });
    }

    const { orchestrator } = getServices();
    const teamId = request.headers.get('x-team-id') || undefined;
    const deployment = await orchestrator.create(parsed.data, user.id, teamId);
    return NextResponse.json({ success: true, data: deployment }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}
