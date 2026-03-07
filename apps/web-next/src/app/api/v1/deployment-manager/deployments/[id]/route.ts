import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';
import { getServices, UpdateDeploymentSchema } from '@/lib/deployment-manager';

const IN_PROGRESS_STATES = ['PROVISIONING', 'DEPLOYING', 'VALIDATING'];

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = getAuthToken(request);
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const user = await validateSession(token);
    if (!user) return NextResponse.json({ success: false, error: 'Invalid session' }, { status: 401 });

    const { id } = await params;
    const { orchestrator } = getServices();
    let deployment = await orchestrator.get(id);
    if (!deployment) return NextResponse.json({ success: false, error: 'Deployment not found' }, { status: 404 });

    if (IN_PROGRESS_STATES.includes(deployment.status) && deployment.providerDeploymentId) {
      try {
        deployment = await orchestrator.syncStatus(id, user.id);
      } catch {
        // sync failed — return stale data rather than error
      }
    }

    return NextResponse.json({ success: true, data: deployment });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = getAuthToken(request);
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const user = await validateSession(token);
    if (!user) return NextResponse.json({ success: false, error: 'Invalid session' }, { status: 401 });

    const { id } = await params;
    const body = await request.json();
    const parsed = UpdateDeploymentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Validation failed', details: parsed.error.format() }, { status: 400 });
    }

    const { orchestrator } = getServices();
    const deployment = await orchestrator.updateDeployment(id, parsed.data, user.id);
    return NextResponse.json({ success: true, data: deployment });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = getAuthToken(request);
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const user = await validateSession(token);
    if (!user) return NextResponse.json({ success: false, error: 'Invalid session' }, { status: 401 });

    const { id } = await params;
    const { orchestrator } = getServices();
    const record = await orchestrator.destroy(id, user.id);
    const allClean = record.status === 'DESTROYED';
    return NextResponse.json({
      success: true,
      data: record,
      destroyResult: {
        allClean,
        steps: [{ step: 'destroy', success: allClean, detail: allClean ? 'Destroyed' : record.statusMessage }],
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}
