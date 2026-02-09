import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const status = searchParams.get('status');
    const type = searchParams.get('type');

    // Generate mock job data
    const jobTypes = ['text-to-image', 'llm', 'upscale', 'image-to-video'];
    const statuses = ['completed', 'processing', 'failed'];
    
    let jobs = Array.from({ length: limit }, (_, i) => ({
      id: `job-${Date.now()}-${i}`,
      type: jobTypes[Math.floor(Math.random() * jobTypes.length)],
      status: statuses[Math.floor(Math.random() * 10) < 8 ? 0 : Math.floor(Math.random() * 10) < 9 ? 1 : 2],
      latencyMs: Math.floor(Math.random() * 3000) + 200,
      gatewayId: `gw-${(i % 5) + 1}`,
      orchestratorId: `orch-${(i % 4) + 1}`,
      priceWei: (Math.floor(Math.random() * 1000000) + 100000).toString(),
      timestamp: new Date(Date.now() - i * 30000).toISOString(),
    }));

    // Apply filters
    if (status) {
      jobs = jobs.filter(j => j.status === status);
    }
    if (type) {
      jobs = jobs.filter(j => j.type === type);
    }

    // Calculate summary stats
    const summary = {
      total: jobs.length,
      completed: jobs.filter(j => j.status === 'completed').length,
      processing: jobs.filter(j => j.status === 'processing').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      averageLatency: Math.floor(jobs.reduce((sum, j) => sum + j.latencyMs, 0) / jobs.length),
    };

    return NextResponse.json({
      jobs,
      summary,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}
