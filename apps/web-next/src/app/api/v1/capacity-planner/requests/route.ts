import { NextRequest, NextResponse } from 'next/server';

// Mock capacity request data (matches new CapacityRequest type)
const capacityRequests = [
  {
    id: 'req-1',
    requesterName: 'Livepeer Gateway Primary',
    requesterAccount: '0x7a3b...f29c',
    gpuModel: 'RTX 4090',
    vram: 24,
    osVersion: 'Ubuntu 22.04',
    cudaVersion: '12.2',
    count: 8,
    pipeline: 'text-to-image',
    startDate: '2026-02-15',
    endDate: '2026-04-15',
    validUntil: '2026-02-28',
    hourlyRate: 1.20,
    reason: 'Increased demand for Stable Diffusion workloads expected during product launch',
    riskLevel: 5,
    softCommits: [
      { id: 'sc-1', userId: 'u-1', userName: 'NodeRunner Pro', timestamp: '2026-01-20T10:00:00Z' },
      { id: 'sc-2', userId: 'u-2', userName: 'GPU Capital', timestamp: '2026-01-21T14:30:00Z' },
      { id: 'sc-3', userId: 'u-3', userName: 'CloudNodes', timestamp: '2026-01-22T09:15:00Z' },
    ],
    comments: [
      { id: 'c1', author: 'ops@livepeer.org', text: 'Reviewing current orchestrator availability', timestamp: '2026-02-01T10:00:00Z' },
    ],
    createdAt: '2026-01-28T14:00:00Z',
    status: 'active',
  },
  {
    id: 'req-2',
    requesterName: 'AI Services Gateway',
    requesterAccount: '0x3f91...a84e',
    gpuModel: 'A100 80GB',
    vram: 80,
    osVersion: 'Ubuntu 22.04',
    cudaVersion: '12.1',
    count: 4,
    pipeline: 'llm',
    startDate: '2026-03-01',
    endDate: '2026-06-01',
    validUntil: '2026-02-20',
    hourlyRate: 2.50,
    reason: 'New LLM inference endpoint launching, need high-memory GPUs',
    riskLevel: 4,
    softCommits: [
      { id: 'sc-4', userId: 'u-4', userName: 'DataCenter One', timestamp: '2026-01-30T09:00:00Z' },
    ],
    comments: [],
    createdAt: '2026-01-30T09:00:00Z',
    status: 'active',
  },
  {
    id: 'req-3',
    requesterName: 'Media Processing Hub',
    requesterAccount: '0x8bc2...d71f',
    gpuModel: 'H100',
    vram: 80,
    osVersion: 'Ubuntu 24.04',
    cudaVersion: '12.4',
    count: 2,
    pipeline: 'image-to-video',
    startDate: '2026-03-15',
    endDate: '2026-05-15',
    validUntil: '2026-03-01',
    hourlyRate: 3.80,
    reason: 'Video generation feature beta launch',
    riskLevel: 3,
    softCommits: [],
    comments: [
      { id: 'c2', author: 'capacity@livepeer.org', text: 'Reaching out to H100 operators', timestamp: '2026-02-02T15:30:00Z' },
    ],
    createdAt: '2026-02-01T11:00:00Z',
    status: 'active',
  },
  {
    id: 'req-4',
    requesterName: 'Enterprise Gateway',
    requesterAccount: '0x5d4a...e38b',
    gpuModel: 'RTX 4080',
    vram: 16,
    osVersion: 'Ubuntu 22.04',
    cudaVersion: '12.3',
    count: 16,
    pipeline: 'upscale',
    startDate: '2026-02-10',
    endDate: '2026-04-10',
    validUntil: '2026-02-10',
    hourlyRate: 0.95,
    reason: 'Enterprise customer onboarding with high-volume upscaling needs',
    riskLevel: 4,
    softCommits: [
      { id: 'sc-5', userId: 'u-5', userName: 'EcoCompute', timestamp: '2026-01-25T08:00:00Z' },
      { id: 'sc-6', userId: 'u-6', userName: 'InferenceNet', timestamp: '2026-01-26T10:00:00Z' },
      { id: 'sc-7', userId: 'u-7', userName: 'HashPower Labs', timestamp: '2026-01-27T12:00:00Z' },
      { id: 'sc-8', userId: 'u-8', userName: 'NodeRunner Pro', timestamp: '2026-01-28T09:00:00Z' },
      { id: 'sc-9', userId: 'u-9', userName: 'GPU Capital', timestamp: '2026-01-29T15:00:00Z' },
    ],
    comments: [],
    createdAt: '2026-01-25T08:00:00Z',
    status: 'active',
  },
];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pipeline = searchParams.get('pipeline');
    const gpuModel = searchParams.get('gpuModel');
    const search = searchParams.get('search');

    let filtered = capacityRequests;

    if (pipeline) {
      filtered = filtered.filter(r => r.pipeline === pipeline);
    }

    if (gpuModel) {
      filtered = filtered.filter(r => r.gpuModel === gpuModel);
    }

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(r =>
        r.requesterName.toLowerCase().includes(q) ||
        r.gpuModel.toLowerCase().includes(q) ||
        r.pipeline.toLowerCase().includes(q) ||
        r.reason.toLowerCase().includes(q)
      );
    }

    return NextResponse.json({
      success: true,
      data: filtered,
      total: filtered.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching capacity requests:', error);
    return NextResponse.json(
      { error: 'Failed to fetch capacity requests' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const newRequest = {
      id: `req-${Date.now()}`,
      requesterName: body.requesterName,
      requesterAccount: body.requesterAccount || '0x0000...0000',
      gpuModel: body.gpuModel,
      vram: body.vram,
      osVersion: body.osVersion || 'Any',
      cudaVersion: body.cudaVersion || 'Any',
      count: body.count,
      pipeline: body.pipeline,
      startDate: body.startDate,
      endDate: body.endDate,
      validUntil: body.validUntil,
      hourlyRate: body.hourlyRate,
      reason: body.reason,
      riskLevel: body.riskLevel || 3,
      softCommits: [],
      comments: [],
      createdAt: new Date().toISOString(),
      status: 'active',
    };

    return NextResponse.json({ success: true, data: newRequest }, { status: 201 });
  } catch (error) {
    console.error('Error creating capacity request:', error);
    return NextResponse.json(
      { error: 'Failed to create capacity request' },
      { status: 500 }
    );
  }
}
