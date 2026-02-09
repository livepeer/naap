import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // In a real implementation, this would:
    // 1. Verify the orchestrator can fulfill the commitment
    // 2. Update the soft commit count
    // 3. Notify the gateway operator
    // 4. Log the commitment

    const commitment = {
      requestId: id,
      orchestratorId: body.orchestratorId,
      orchestratorName: body.orchestratorName || 'Unknown Orchestrator',
      gpuCount: body.gpuCount,
      committedAt: new Date().toISOString(),
      status: 'pending_confirmation',
    };

    return NextResponse.json({
      success: true,
      commitment,
      message: 'Soft commitment registered successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating soft commitment:', error);
    return NextResponse.json(
      { error: 'Failed to create soft commitment' },
      { status: 500 }
    );
  }
}
