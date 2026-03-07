import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';
import { getServices } from '@/lib/deployment-manager';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const token = getAuthToken(request);
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const user = await validateSession(token);
    if (!user) return NextResponse.json({ success: false, error: 'Invalid session' }, { status: 401 });

    const { id } = await params;
    const { orchestrator } = getServices();
    const deployment = await orchestrator.get(id);

    if (!deployment) {
      return NextResponse.json({ success: false, error: 'Deployment not found' }, { status: 404 });
    }

    const artifactConfig = deployment.artifactConfig as Record<string, unknown> | undefined;
    const pipelineStatus = {
      capabilityName: artifactConfig?.capabilityName || 'unknown',
      topology: artifactConfig?.topology || 'unknown',
      adapterHealthy: deployment.healthStatus === 'GREEN',
      deploymentStatus: deployment.status,
      healthStatus: deployment.healthStatus,
      endpointUrl: deployment.endpointUrl,
      orchestratorSecret: artifactConfig?.orchestratorSecret ? '***' : undefined,
    };

    return NextResponse.json({ success: true, data: pipelineStatus });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
