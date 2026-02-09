import { NextRequest, NextResponse } from 'next/server';

// Mock orchestrator data (same as parent route)
const orchestrators = [
  {
    id: 'orch-1',
    address: '0x1234567890abcdef1234567890abcdef12345678',
    operatorName: 'GPU Fleet Alpha',
    serviceUri: 'https://gpu-alpha.livepeer.cloud',
    region: 'us-east-1',
    gpuType: 'RTX 4090',
    gpuCount: 8,
    vram: '24GB',
    cudaVersion: '12.1',
    memoryBandwidth: '1008 GB/s',
    interconnects: ['PCIe 4.0', 'NVLink'],
    status: 'active',
    currentLoad: 75,
    maxCapacity: 100,
    successRate: 99.2,
    latencyScore: 85,
    pricePerUnit: { 'text-to-image': 0.001, 'llm': 0.002, 'upscale': 0.0005 },
    supportedPipelines: ['text-to-image', 'llm', 'upscale'],
    earningsToday: 245.50,
    ticketsWon: 1250,
    ticketsPending: 15,
    version: '1.0.0',
    aiWorkers: [
      { name: 'worker-1', status: 'running', load: 80 },
      { name: 'worker-2', status: 'running', load: 70 },
    ],
  },
  {
    id: 'orch-2',
    address: '0xabcdef1234567890abcdef1234567890abcdef12',
    operatorName: 'Neural Compute Co',
    serviceUri: 'https://neural.livepeer.cloud',
    region: 'eu-west-1',
    gpuType: 'A100',
    gpuCount: 4,
    vram: '80GB',
    cudaVersion: '12.2',
    memoryBandwidth: '2039 GB/s',
    interconnects: ['PCIe 5.0', 'NVLink'],
    status: 'active',
    currentLoad: 60,
    maxCapacity: 100,
    successRate: 99.8,
    latencyScore: 92,
    pricePerUnit: { 'text-to-image': 0.002, 'llm': 0.003, 'image-to-video': 0.01 },
    supportedPipelines: ['text-to-image', 'llm', 'image-to-video'],
    earningsToday: 389.20,
    ticketsWon: 2100,
    ticketsPending: 8,
    version: '1.1.0',
    aiWorkers: [
      { name: 'worker-1', status: 'running', load: 65 },
      { name: 'worker-2', status: 'running', load: 55 },
    ],
  },
  {
    id: 'orch-3',
    address: '0x9876543210fedcba9876543210fedcba98765432',
    operatorName: 'Decentralized AI',
    serviceUri: 'https://dec-ai.livepeer.cloud',
    region: 'ap-northeast-1',
    gpuType: 'H100',
    gpuCount: 2,
    vram: '80GB',
    cudaVersion: '12.3',
    memoryBandwidth: '3350 GB/s',
    interconnects: ['PCIe 5.0', 'NVLink', 'NVSwitch'],
    status: 'suspended',
    currentLoad: 0,
    maxCapacity: 100,
    successRate: 98.5,
    latencyScore: 78,
    pricePerUnit: { 'llm': 0.005, 'image-to-video': 0.02 },
    supportedPipelines: ['llm', 'image-to-video'],
    earningsToday: 0,
    ticketsWon: 850,
    ticketsPending: 0,
    version: '0.9.0',
    aiWorkers: [],
  },
  {
    id: 'orch-4',
    address: '0xfedcba9876543210fedcba9876543210fedcba98',
    operatorName: 'Cloud GPU Solutions',
    serviceUri: 'https://cloud-gpu.livepeer.cloud',
    region: 'us-west-2',
    gpuType: 'RTX 4080',
    gpuCount: 16,
    vram: '16GB',
    cudaVersion: '12.1',
    memoryBandwidth: '716 GB/s',
    interconnects: ['PCIe 4.0'],
    status: 'active',
    currentLoad: 85,
    maxCapacity: 100,
    successRate: 99.5,
    latencyScore: 88,
    pricePerUnit: { 'text-to-image': 0.0008, 'upscale': 0.0003 },
    supportedPipelines: ['text-to-image', 'upscale'],
    earningsToday: 567.80,
    ticketsWon: 3200,
    ticketsPending: 25,
    version: '1.0.2',
    aiWorkers: [
      { name: 'worker-1', status: 'running', load: 90 },
      { name: 'worker-2', status: 'running', load: 80 },
      { name: 'worker-3', status: 'idle', load: 0 },
    ],
  },
];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orchestrator = orchestrators.find(o => o.id === id);

    if (!orchestrator) {
      return NextResponse.json(
        { error: 'Orchestrator not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(orchestrator);
  } catch (error) {
    console.error('Error fetching orchestrator:', error);
    return NextResponse.json(
      { error: 'Failed to fetch orchestrator' },
      { status: 500 }
    );
  }
}
