import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Mock network statistics (matches original plugin backend)
    const stats = {
      healthScore: 98.5,
      activeJobsNow: 127,
      gatewaysOnline: 48,
      orchestratorsOnline: 156,
      feesThisRound: 12450.75,
      currentRound: 3245,
      
      // Additional metrics
      totalJobsToday: 15420,
      averageLatencyMs: 245,
      successRate: 99.4,
      totalEarningsToday: 45678.90,
      
      // Time series data for charts (last 24 hours)
      jobsTimeSeries: Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        count: Math.floor(Math.random() * 500) + 400,
      })),
      
      latencyTimeSeries: Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        p50: Math.floor(Math.random() * 100) + 150,
        p99: Math.floor(Math.random() * 200) + 350,
      })),
      
      capacityTimeSeries: Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        utilization: Math.floor(Math.random() * 30) + 60,
      })),
      
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching network stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch network statistics' },
      { status: 500 }
    );
  }
}
