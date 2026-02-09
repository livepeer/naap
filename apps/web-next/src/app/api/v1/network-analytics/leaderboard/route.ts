import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '24h'; // 24h, 7d, 30d
    const limit = parseInt(searchParams.get('limit') || '10');

    // Mock leaderboard data
    const leaderboard = [
      {
        rank: 1,
        orchestratorId: 'orch-4',
        operatorName: 'Cloud GPU Solutions',
        address: '0xfedcba9876543210fedcba9876543210fedcba98',
        earnings: 567.80,
        jobsProcessed: 3200,
        successRate: 99.5,
        averageLatency: 210,
        trend: 'up',
        trendPercent: 12.5,
      },
      {
        rank: 2,
        orchestratorId: 'orch-2',
        operatorName: 'Neural Compute Co',
        address: '0xabcdef1234567890abcdef1234567890abcdef12',
        earnings: 389.20,
        jobsProcessed: 2100,
        successRate: 99.8,
        averageLatency: 185,
        trend: 'up',
        trendPercent: 8.3,
      },
      {
        rank: 3,
        orchestratorId: 'orch-1',
        operatorName: 'GPU Fleet Alpha',
        address: '0x1234567890abcdef1234567890abcdef12345678',
        earnings: 245.50,
        jobsProcessed: 1250,
        successRate: 99.2,
        averageLatency: 245,
        trend: 'stable',
        trendPercent: 0.5,
      },
      {
        rank: 4,
        orchestratorId: 'orch-5',
        operatorName: 'Distributed AI Labs',
        address: '0x5678901234abcdef5678901234abcdef56789012',
        earnings: 198.40,
        jobsProcessed: 980,
        successRate: 99.0,
        averageLatency: 290,
        trend: 'down',
        trendPercent: -3.2,
      },
      {
        rank: 5,
        orchestratorId: 'orch-6',
        operatorName: 'GPU Miners United',
        address: '0x9012345678abcdef9012345678abcdef90123456',
        earnings: 156.75,
        jobsProcessed: 820,
        successRate: 98.8,
        averageLatency: 310,
        trend: 'up',
        trendPercent: 5.1,
      },
      {
        rank: 6,
        orchestratorId: 'orch-7',
        operatorName: 'DeepMind Collective',
        address: '0xbcdef12345678901bcdef12345678901bcdef123',
        earnings: 134.20,
        jobsProcessed: 720,
        successRate: 99.3,
        averageLatency: 225,
        trend: 'up',
        trendPercent: 15.8,
      },
      {
        rank: 7,
        orchestratorId: 'orch-8',
        operatorName: 'Tensor Flow Farm',
        address: '0x3456789012abcdef3456789012abcdef34567890',
        earnings: 112.90,
        jobsProcessed: 650,
        successRate: 98.5,
        averageLatency: 380,
        trend: 'stable',
        trendPercent: 1.2,
      },
      {
        rank: 8,
        orchestratorId: 'orch-9',
        operatorName: 'AI Pipeline Pro',
        address: '0xdef0123456789012def0123456789012def01234',
        earnings: 98.50,
        jobsProcessed: 540,
        successRate: 99.1,
        averageLatency: 265,
        trend: 'down',
        trendPercent: -8.4,
      },
      {
        rank: 9,
        orchestratorId: 'orch-10',
        operatorName: 'Neural Net Hub',
        address: '0x67890123456abcde67890123456abcde67890123',
        earnings: 87.30,
        jobsProcessed: 480,
        successRate: 98.9,
        averageLatency: 340,
        trend: 'up',
        trendPercent: 4.2,
      },
      {
        rank: 10,
        orchestratorId: 'orch-3',
        operatorName: 'Decentralized AI',
        address: '0x9876543210fedcba9876543210fedcba98765432',
        earnings: 0,
        jobsProcessed: 0,
        successRate: 98.5,
        averageLatency: 0,
        trend: 'down',
        trendPercent: -100,
      },
    ];

    return NextResponse.json({
      leaderboard: leaderboard.slice(0, limit),
      period,
      totalOrchestrators: 156,
      totalEarnings: leaderboard.reduce((sum, o) => sum + o.earnings, 0),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return NextResponse.json(
      { error: 'Failed to fetch leaderboard' },
      { status: 500 }
    );
  }
}
