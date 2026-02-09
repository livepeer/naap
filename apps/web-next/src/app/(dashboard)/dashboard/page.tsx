'use client';

/**
 * Dashboard Overview Page
 *
 * Network status overview showing key metrics, performance, costs, and live activity.
 * Designed as a single-page command center for the Livepeer network.
 */

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/auth-context';
import {
  Activity,
  CheckCircle2,
  Server,
  Clock,
  Radio,
  Layers,
  Coins,
  Cpu,
  TrendingUp,
  TrendingDown,
  Minus,
  Zap,
} from 'lucide-react';

// ============================================================================
// Mock Data
// ============================================================================

const MOCK_STATS = {
  successRate: { value: 97.3, delta: 1.2 },
  orchestratorsOnline: { value: 142, delta: 8 },
  dailyUsageMins: { value: 48720, delta: 3200 },
  dailyStreamCount: { value: 1843, delta: -47 },
};

const MOCK_PROTOCOL = {
  currentRound: 4127,
  blockProgress: 72,
  totalBlocks: 5760,
  totalStakedLPT: 31_245_890,
};

const MOCK_DAILY_FEES = [
  { day: 'Mon', eth: 12.4 },
  { day: 'Tue', eth: 15.1 },
  { day: 'Wed', eth: 14.8 },
  { day: 'Thu', eth: 18.3 },
  { day: 'Fri', eth: 16.9 },
  { day: 'Sat', eth: 11.2 },
  { day: 'Sun', eth: 13.7 },
];

const MOCK_PIPELINE_USAGE = [
  { name: 'Text-to-Image', mins: 14200, color: '#8b5cf6' },
  { name: 'Image-to-Video', mins: 11300, color: '#06b6d4' },
  { name: 'Video-to-Video', mins: 9800, color: '#10b981' },
  { name: 'Upscale', mins: 7100, color: '#f59e0b' },
  { name: 'Audio-to-Text', mins: 5400, color: '#ef4444' },
];

const MOCK_GPU_CAPACITY = {
  totalGPUs: 384,
  availableCapacity: 61, // percent
};

const MOCK_JOB_FEED = [
  { id: 'job_8f2a1c', startedAt: '2026-02-05T23:14:02Z', pipeline: 'Text-to-Image', status: 'running' as const },
  { id: 'job_7e3b9d', startedAt: '2026-02-05T23:13:45Z', pipeline: 'Video-to-Video', status: 'completed' as const },
  { id: 'job_6d4c8e', startedAt: '2026-02-05T23:13:22Z', pipeline: 'Image-to-Video', status: 'running' as const },
  { id: 'job_5c5d7f', startedAt: '2026-02-05T23:12:58Z', pipeline: 'Upscale', status: 'completed' as const },
  { id: 'job_4b6e6g', startedAt: '2026-02-05T23:12:31Z', pipeline: 'Text-to-Image', status: 'completed' as const },
  { id: 'job_3a7f5h', startedAt: '2026-02-05T23:12:04Z', pipeline: 'Audio-to-Text', status: 'completed' as const },
  { id: 'job_2z8g4i', startedAt: '2026-02-05T23:11:42Z', pipeline: 'Video-to-Video', status: 'completed' as const },
  { id: 'job_1y9h3j', startedAt: '2026-02-05T23:11:18Z', pipeline: 'Image-to-Video', status: 'failed' as const },
];

const MOCK_PIPELINE_PRICING = [
  { pipeline: 'Text-to-Image', unit: 'image', price: 0.004, outputPerDollar: '250 images' },
  { pipeline: 'Image-to-Video', unit: 'second', price: 0.05, outputPerDollar: '20 seconds' },
  { pipeline: 'Video-to-Video', unit: 'minute', price: 0.12, outputPerDollar: '8.3 minutes' },
  { pipeline: 'Upscale', unit: 'image', price: 0.008, outputPerDollar: '125 images' },
  { pipeline: 'Audio-to-Text', unit: 'minute', price: 0.006, outputPerDollar: '166 minutes' },
  { pipeline: 'Segment Anything 2', unit: 'image', price: 0.005, outputPerDollar: '200 images' },
  { pipeline: 'LLM', unit: '1K tokens', price: 0.0002, outputPerDollar: '5M tokens' },
];

// ============================================================================
// Utility Components
// ============================================================================

function DeltaBadge({ value, unit = '%', invert = false }: { value: number; unit?: string; invert?: boolean }) {
  const isPositive = invert ? value < 0 : value >= 0;
  const isNeutral = value === 0;
  const color = isNeutral
    ? 'text-muted-foreground bg-muted'
    : isPositive
      ? 'text-emerald-400 bg-emerald-500/10'
      : 'text-red-400 bg-red-500/10';
  const Icon = isNeutral ? Minus : value >= 0 ? TrendingUp : TrendingDown;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      <Icon className="w-3 h-3" />
      {value >= 0 ? '+' : ''}{value}{unit}
    </span>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

// ============================================================================
// Row 1: Key Performance Indicators
// ============================================================================

function KPICard({
  icon: Icon,
  iconColor,
  label,
  value,
  delta,
  deltaUnit,
  deltaInvert,
  suffix,
}: {
  icon: React.ElementType;
  iconColor: string;
  label: string;
  value: string | number;
  delta: number;
  deltaUnit?: string;
  deltaInvert?: boolean;
  suffix?: string;
}) {
  return (
    <div className="p-5 rounded-2xl bg-card border border-border hover:border-primary/30 transition-colors">
      <div className="flex items-center gap-2 mb-3">
        <div className={`p-1.5 rounded-lg ${iconColor}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-end justify-between">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-foreground tracking-tight">{value}</span>
          {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
        </div>
        <DeltaBadge value={delta} unit={deltaUnit} invert={deltaInvert} />
      </div>
    </div>
  );
}

// ============================================================================
// Row 2: Protocol, Fees, Pipelines, Capacity
// ============================================================================

function ProtocolCard() {
  const { currentRound, blockProgress, totalBlocks, totalStakedLPT } = MOCK_PROTOCOL;
  const progressPct = Math.round((blockProgress / totalBlocks) * 100);

  return (
    <div className="p-5 rounded-2xl bg-card border border-border">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1.5 rounded-lg bg-indigo-500/15 text-indigo-400">
          <Layers className="w-4 h-4" />
        </div>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Protocol</span>
      </div>
      <div className="space-y-4">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground">Round {currentRound.toLocaleString()}</span>
          </div>
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Block Progress</span>
              <span>{progressPct}% ({blockProgress.toLocaleString()} / {totalBlocks.toLocaleString()})</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>
        <div className="pt-3 border-t border-border">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total Staked</span>
            <span className="text-sm font-semibold text-foreground">{formatNumber(totalStakedLPT)} LPT</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeesCard() {
  const maxFee = Math.max(...MOCK_DAILY_FEES.map(d => d.eth));
  const totalFees = MOCK_DAILY_FEES.reduce((sum, d) => sum + d.eth, 0);

  return (
    <div className="p-5 rounded-2xl bg-card border border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-amber-500/15 text-amber-400">
            <Coins className="w-4 h-4" />
          </div>
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Fees (7d)</span>
        </div>
        <span className="text-sm font-semibold text-foreground">{totalFees.toFixed(1)} ETH</span>
      </div>
      <div className="flex items-end gap-1.5 h-24">
        {MOCK_DAILY_FEES.map((d) => (
          <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full relative">
              <div
                className="w-full bg-amber-500/20 rounded-t-sm hover:bg-amber-500/40 transition-colors"
                style={{ height: `${(d.eth / maxFee) * 80}px` }}
                title={`${d.eth} ETH`}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">{d.day}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelinesCard() {
  const maxMins = Math.max(...MOCK_PIPELINE_USAGE.map(p => p.mins));

  return (
    <div className="p-5 rounded-2xl bg-card border border-border">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1.5 rounded-lg bg-violet-500/15 text-violet-400">
          <Activity className="w-4 h-4" />
        </div>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Top Pipelines (Daily)</span>
      </div>
      <div className="space-y-2.5">
        {MOCK_PIPELINE_USAGE.map((p) => (
          <div key={p.name} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-28 truncate" title={p.name}>{p.name}</span>
            <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${(p.mins / maxMins) * 100}%`,
                  backgroundColor: p.color,
                  opacity: 0.7,
                }}
              />
            </div>
            <span className="text-xs font-mono text-foreground w-14 text-right">{formatNumber(p.mins)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GPUCapacityCard() {
  const { totalGPUs, availableCapacity } = MOCK_GPU_CAPACITY;
  const usedPct = 100 - availableCapacity;
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (usedPct / 100) * circumference;

  return (
    <div className="p-5 rounded-2xl bg-card border border-border">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1.5 rounded-lg bg-cyan-500/15 text-cyan-400">
          <Cpu className="w-4 h-4" />
        </div>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">GPU Capacity</span>
      </div>
      <div className="flex items-center gap-5">
        {/* Circular gauge */}
        <div className="relative w-24 h-24 flex-shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r={radius} fill="none" stroke="currentColor" className="text-muted" strokeWidth="8" />
            <circle
              cx="50" cy="50" r={radius} fill="none"
              stroke="currentColor"
              className="text-cyan-400"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              style={{ transition: 'stroke-dashoffset 1s ease-out' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold text-foreground">{availableCapacity}%</span>
            <span className="text-[9px] text-muted-foreground">Available</span>
          </div>
        </div>
        <div className="space-y-2">
          <div>
            <span className="text-2xl font-bold text-foreground">{totalGPUs}</span>
            <span className="text-sm text-muted-foreground ml-1">GPUs</span>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" />
              <span>Used: {usedPct}% ({Math.round(totalGPUs * usedPct / 100)})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-muted inline-block" />
              <span>Free: {availableCapacity}% ({Math.round(totalGPUs * availableCapacity / 100)})</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Row 3: Live Job Feed & Pipeline Pricing
// ============================================================================

function JobFeedCard() {
  const [jobs, setJobs] = useState(MOCK_JOB_FEED);

  // Simulate live feed with new jobs appearing
  useEffect(() => {
    const pipelines = ['Text-to-Image', 'Image-to-Video', 'Video-to-Video', 'Upscale', 'Audio-to-Text', 'LLM'];
    const interval = setInterval(() => {
      const newJob = {
        id: `job_${Math.random().toString(36).slice(2, 8)}`,
        startedAt: new Date().toISOString(),
        pipeline: pipelines[Math.floor(Math.random() * pipelines.length)],
        status: 'running' as const,
      };
      setJobs(prev => {
        // Mark the oldest running jobs as completed
        const updated = prev.map(j => j.status === 'running' ? { ...j, status: 'completed' as const } : j);
        return [newJob, ...updated].slice(0, 8);
      });
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const statusStyles: Record<string, string> = {
    running: 'bg-emerald-500/15 text-emerald-400',
    completed: 'bg-blue-500/10 text-blue-400',
    failed: 'bg-red-500/15 text-red-400',
  };

  return (
    <div className="p-5 rounded-2xl bg-card border border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400">
            <Zap className="w-4 h-4" />
          </div>
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Live Job Feed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-emerald-400 font-medium">LIVE</span>
        </div>
      </div>
      <div className="overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-border">
              <th className="text-left pb-2 font-medium">Job ID</th>
              <th className="text-left pb-2 font-medium">Time</th>
              <th className="text-left pb-2 font-medium">Pipeline</th>
              <th className="text-right pb-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job, i) => (
              <tr
                key={job.id}
                className={`border-b border-border/50 last:border-0 transition-colors ${i === 0 ? 'animate-pulse-once' : ''}`}
              >
                <td className="py-2 font-mono text-foreground">{job.id}</td>
                <td className="py-2 text-muted-foreground">{formatTime(job.startedAt)}</td>
                <td className="py-2 text-foreground">{job.pipeline}</td>
                <td className="py-2 text-right">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusStyles[job.status]}`}>
                    {job.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PricingCard() {
  return (
    <div className="p-5 rounded-2xl bg-card border border-border">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1.5 rounded-lg bg-pink-500/15 text-pink-400">
          <Coins className="w-4 h-4" />
        </div>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pipeline Unit Cost</span>
      </div>
      <div className="overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-border">
              <th className="text-left pb-2 font-medium">Pipeline</th>
              <th className="text-left pb-2 font-medium">Unit</th>
              <th className="text-right pb-2 font-medium">Price</th>
              <th className="text-right pb-2 font-medium">Output / $1</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_PIPELINE_PRICING.map((p) => (
              <tr key={p.pipeline} className="border-b border-border/50 last:border-0">
                <td className="py-2 text-foreground font-medium">{p.pipeline}</td>
                <td className="py-2 text-muted-foreground">per {p.unit}</td>
                <td className="py-2 text-right font-mono text-foreground">${p.price}</td>
                <td className="py-2 text-right text-emerald-400 font-medium">{p.outputPerDollar}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Main Dashboard
// ============================================================================

export default function DashboardPage() {
  useAuth();

  return (
    <div className="space-y-6 max-w-[1440px] mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">
            Network Overview
          </h1>
          <p className="text-sm text-muted-foreground">
            Livepeer network health, performance, and cost at a glance
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-medium text-emerald-400">Network Online</span>
        </div>
      </div>

      {/* Row 1: Key Performance Indicators */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}
      >
        <KPICard
          icon={CheckCircle2}
          iconColor="bg-emerald-500/15 text-emerald-400"
          label="Success Rate (1h)"
          value={`${MOCK_STATS.successRate.value}%`}
          delta={MOCK_STATS.successRate.delta}
          deltaUnit="% vs prev hr"
        />
        <KPICard
          icon={Server}
          iconColor="bg-blue-500/15 text-blue-400"
          label="Orchestrators Online"
          value={MOCK_STATS.orchestratorsOnline.value}
          delta={MOCK_STATS.orchestratorsOnline.delta}
          deltaUnit=""
        />
        <KPICard
          icon={Clock}
          iconColor="bg-violet-500/15 text-violet-400"
          label="Daily Usage"
          value={formatNumber(MOCK_STATS.dailyUsageMins.value)}
          delta={MOCK_STATS.dailyUsageMins.delta}
          deltaUnit=" mins"
          suffix="mins"
        />
        <KPICard
          icon={Radio}
          iconColor="bg-amber-500/15 text-amber-400"
          label="Daily Streams"
          value={MOCK_STATS.dailyStreamCount.value.toLocaleString()}
          delta={MOCK_STATS.dailyStreamCount.delta}
          deltaUnit=""
        />
      </div>

      {/* Row 2: Protocol, Fees, Pipelines, GPU */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
      >
        <ProtocolCard />
        <FeesCard />
        <PipelinesCard />
        <GPUCapacityCard />
      </div>

      {/* Row 3: Live Feed & Pricing */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))' }}
      >
        <JobFeedCard />
        <PricingCard />
      </div>
    </div>
  );
}
