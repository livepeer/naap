import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Mock pipeline capabilities data (matches original plugin backend)
    const capabilities = [
      {
        pipeline: 'text-to-image',
        displayName: 'Text to Image',
        orchestratorCount: 85,
        demandLevel: 'high',
        averageLatency: 1250,
        totalJobs24h: 8500,
        successRate: 99.5,
      },
      {
        pipeline: 'llm',
        displayName: 'Large Language Model',
        orchestratorCount: 42,
        demandLevel: 'very-high',
        averageLatency: 2100,
        totalJobs24h: 12000,
        successRate: 99.8,
      },
      {
        pipeline: 'upscale',
        displayName: 'Image Upscaling',
        orchestratorCount: 65,
        demandLevel: 'medium',
        averageLatency: 450,
        totalJobs24h: 3200,
        successRate: 99.9,
      },
      {
        pipeline: 'image-to-video',
        displayName: 'Image to Video',
        orchestratorCount: 18,
        demandLevel: 'high',
        averageLatency: 8500,
        totalJobs24h: 890,
        successRate: 98.5,
      },
      {
        pipeline: 'audio-to-text',
        displayName: 'Speech to Text',
        orchestratorCount: 25,
        demandLevel: 'low',
        averageLatency: 1800,
        totalJobs24h: 450,
        successRate: 99.2,
      },
      {
        pipeline: 'object-detection',
        displayName: 'Object Detection',
        orchestratorCount: 30,
        demandLevel: 'medium',
        averageLatency: 320,
        totalJobs24h: 1200,
        successRate: 99.7,
      },
    ];

    return NextResponse.json({
      capabilities,
      totalPipelines: capabilities.length,
      totalOrchestrators: capabilities.reduce((sum, c) => sum + c.orchestratorCount, 0),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching capabilities:', error);
    return NextResponse.json(
      { error: 'Failed to fetch capabilities' },
      { status: 500 }
    );
  }
}
