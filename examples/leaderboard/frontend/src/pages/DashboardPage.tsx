/**
 * Leaderboard Dashboard Page
 *
 * Three-row layout matching the overview dashboard pattern:
 *   Row 1: KPI stat cards (pipelines, models, regions, top score)
 *   Row 2: Pipeline cards grid (click to drill into detail)
 *   Row 3: Best performers table (top 10 orchestrators)
 */

import React, { useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Trophy,
  Layers,
  Cpu,
  Globe,
  AlertCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useLeaderboardApi, useAsync } from '../hooks/useLeaderboardApi';
import { StatCard } from '../components/StatCard';
import { PipelineCard } from '../components/PipelineCard';
import { OrchestratorTable } from '../components/OrchestratorTable';
import { CardSkeleton, PipelineCardSkeleton, TableSkeleton } from '../components/Skeleton';
import type {
  Pipeline,
  PipelinesResponse,
  AggregatedStatsResponse,
  OrchestratorScore,
  PipelineSummary,
  KPIData,
} from '../types';

// ── Pure data helpers ────────────────────────────────────────────────────────

function buildPipelineSummaries(pipelines: Pipeline[]): PipelineSummary[] {
  return pipelines.map((p) => ({
    id: p.id,
    modelCount: p.models.length,
    regions: p.regions,
    models: p.models,
  }));
}

function extractKPIs(
  pipelines: Pipeline[],
  allScores: OrchestratorScore[],
): KPIData {
  const allRegions = new Set<string>();
  let totalModels = 0;
  for (const p of pipelines) {
    totalModels += p.models.length;
    for (const r of p.regions) allRegions.add(r);
  }
  const topScore =
    allScores.length > 0 ? Math.max(...allScores.map((s) => s.score)) : 0;

  return {
    totalPipelines: pipelines.length,
    totalModels,
    activeRegions: allRegions.size,
    topScore,
  };
}

function flattenStats(
  pipeline: string,
  model: string,
  stats: AggregatedStatsResponse,
): OrchestratorScore[] {
  const results: OrchestratorScore[] = [];
  for (const [address, regions] of Object.entries(stats)) {
    for (const [region, scores] of Object.entries(regions)) {
      results.push({
        address,
        region,
        successRate: scores.success_rate,
        roundTripScore: scores.round_trip_score,
        score: scores.score,
        pipeline,
        model,
      });
    }
  }
  return results;
}

// ── Component ────────────────────────────────────────────────────────────────

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const api = useLeaderboardApi();
  const pipelinesState = useAsync<PipelinesResponse>();
  const allScoresRef = useRef<OrchestratorScore[]>([]);
  const [allScores, setAllScores] = React.useState<OrchestratorScore[]>([]);
  const [statsLoading, setStatsLoading] = React.useState(false);
  const [statsError, setStatsError] = React.useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const pipelineData = await pipelinesState.execute(() =>
        api.fetchPipelines(),
      );

      setStatsLoading(true);
      setStatsError(null);

      const scores: OrchestratorScore[] = [];
      for (const p of pipelineData.pipelines) {
        for (const model of p.models) {
          try {
            const stats = await api.fetchStats(p.id, model);
            scores.push(...flattenStats(p.id, model, stats));
          } catch {
            // Some pipeline+model combos may have no data — skip silently
          }
        }
      }

      allScoresRef.current = scores;
      setAllScores(scores);
      setStatsLoading(false);
    } catch (err) {
      setStatsLoading(false);
      setStatsError(
        err instanceof Error ? err.message : 'Failed to load stats',
      );
    }
  }, [api, pipelinesState]);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pipelines = pipelinesState.data?.pipelines ?? [];
  const summaries = useMemo(() => buildPipelineSummaries(pipelines), [pipelines]);
  const kpi = useMemo(
    () => extractKPIs(pipelines, allScores),
    [pipelines, allScores],
  );
  const topPerformers = useMemo(
    () =>
      [...allScores]
        .sort((a, b) => b.score - a.score || a.address.localeCompare(b.address))
        .slice(0, 10),
    [allScores],
  );

  // ── Loading state ──

  if (pipelinesState.loading && !pipelinesState.data) {
    return (
      <div className="space-y-6 max-w-[1440px] mx-auto p-6">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
          <span className="text-sm text-muted-foreground">
            Loading leaderboard data...
          </span>
        </div>
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
        >
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}
        >
          <PipelineCardSkeleton />
          <PipelineCardSkeleton />
          <PipelineCardSkeleton />
          <PipelineCardSkeleton />
        </div>
        <TableSkeleton />
      </div>
    );
  }

  // ── Error state ──

  if (pipelinesState.error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <AlertCircle className="w-8 h-8 mb-3 opacity-50" />
        <p className="text-sm font-medium">Failed to load leaderboard</p>
        <p className="text-xs mt-1 opacity-70">{pipelinesState.error}</p>
        <button
          onClick={loadData}
          className="mt-4 px-4 py-2 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </div>
    );
  }

  // ── Empty state ──

  if (pipelines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Trophy className="w-8 h-8 mb-3 opacity-50" />
        <p className="text-sm font-medium">No pipelines found</p>
        <p className="text-xs mt-1 opacity-70">
          The Livepeer Leaderboard API returned no pipeline data.
        </p>
      </div>
    );
  }

  // ── Main render ──

  return (
    <div className="space-y-6 max-w-[1440px] mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-amber-500/15 text-amber-400">
            <Trophy className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              AI Leaderboard
            </h1>
            <p className="text-sm text-muted-foreground">
              Livepeer orchestrator performance across AI pipelines
            </p>
          </div>
        </div>
        <button
          onClick={loadData}
          disabled={pipelinesState.loading}
          className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted/50 transition-colors flex items-center gap-1.5 text-muted-foreground disabled:opacity-50"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${pipelinesState.loading ? 'animate-spin' : ''}`}
          />
          Refresh
        </button>
      </div>

      {/* Row 1: KPI Cards */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
      >
        <StatCard
          icon={Layers}
          iconColor="bg-violet-500/15 text-violet-400"
          label="Pipelines"
          value={kpi.totalPipelines}
        />
        <StatCard
          icon={Cpu}
          iconColor="bg-blue-500/15 text-blue-400"
          label="Models"
          value={kpi.totalModels}
        />
        <StatCard
          icon={Globe}
          iconColor="bg-emerald-500/15 text-emerald-400"
          label="Regions"
          value={kpi.activeRegions}
        />
        <StatCard
          icon={Trophy}
          iconColor="bg-amber-500/15 text-amber-400"
          label="Top Score"
          value={kpi.topScore > 0 ? `${Math.round(kpi.topScore * 100)}%` : '—'}
        />
      </div>

      {/* Row 2: Pipeline Cards */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wider">
          Pipelines
        </h2>
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          }}
        >
          {summaries.map((p) => (
            <PipelineCard
              key={p.id}
              pipeline={p}
              onClick={(id) => navigate(`/pipeline/${encodeURIComponent(id)}`)}
            />
          ))}
        </div>
      </div>

      {/* Row 3: Best Performers */}
      <div className="rounded-2xl bg-card border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            Top Performers
          </h2>
          {statsLoading && (
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          )}
          {statsError && (
            <span className="text-xs text-red-400">{statsError}</span>
          )}
        </div>
        {topPerformers.length > 0 ? (
          <OrchestratorTable data={topPerformers} showPipelineColumn />
        ) : statsLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Loading orchestrator scores...
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No orchestrator data available
          </div>
        )}
      </div>
    </div>
  );
};
