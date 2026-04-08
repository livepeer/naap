/**
 * Capacity Planner Summary API Route
 * GET /api/v1/capacity-planner/summary - Get capacity summary / analytics
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const requests = await prisma.capacityRequest.findMany({
      where: { status: 'ACTIVE' },
    });

    const totalGPUs = requests.reduce((sum, r) => sum + r.count, 0);
    const gpuCounts: Record<string, number> = {};
    const pipelineCounts: Record<string, number> = {};
    const requestorCounts: Record<string, number> = {};

    for (const r of requests) {
      gpuCounts[r.gpuModel] = (gpuCounts[r.gpuModel] || 0) + r.count;
      pipelineCounts[r.pipeline] = (pipelineCounts[r.pipeline] || 0) + 1;
      requestorCounts[r.requesterName] = (requestorCounts[r.requesterName] || 0) + 1;
    }

    const topGPU = Object.entries(gpuCounts).sort((a, b) => b[1] - a[1])[0];
    const topPipeline = Object.entries(pipelineCounts).sort((a, b) => b[1] - a[1])[0];
    const topRequestor = Object.entries(requestorCounts).sort((a, b) => b[1] - a[1])[0];

    const distinctGpuModels = [...new Set(requests.map((r) => r.gpuModel))].sort();
    const distinctPipelines = [...new Set(requests.map((r) => r.pipeline))].sort();

    return success({
      totalRequests: requests.length,
      totalGPUsNeeded: totalGPUs,
      avgHourlyRate:
        requests.length > 0
          ? requests.reduce((s, r) => s + r.hourlyRate, 0) / requests.length
          : 0,
      mostDesiredGPU: topGPU ? { model: topGPU[0], count: topGPU[1] } : null,
      mostPopularPipeline: topPipeline
        ? { name: topPipeline[0], count: topPipeline[1] }
        : null,
      topRequestor: topRequestor ? { name: topRequestor[0], count: topRequestor[1] } : null,
      distinctGpuModels,
      distinctPipelines,
    });
  } catch (err) {
    console.error('Error fetching capacity summary:', err);
    return errors.internal('Failed to fetch capacity summary');
  }
}
