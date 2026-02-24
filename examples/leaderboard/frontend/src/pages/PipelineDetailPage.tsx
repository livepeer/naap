/**
 * Pipeline Detail Page
 *
 * Shows orchestrator leaderboard for a specific pipeline.
 * - Model selector tabs
 * - Sorted orchestrator table with score badges
 * - Expandable rows with raw per-run stats (lazy-loaded)
 */

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { useLeaderboardApi, useAsync } from '../hooks/useLeaderboardApi';
import { OrchestratorTable } from '../components/OrchestratorTable';
import { BarChart } from '../components/BarChart';
import { TableSkeleton } from '../components/Skeleton';
import type {
  PipelinesResponse,
  AggregatedStatsResponse,
  OrchestratorScore,
  RawStatEntry,
} from '../types';

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

export const PipelineDetailPage: React.FC = () => {
  const { pipelineId } = useParams<{ pipelineId: string }>();
  const navigate = useNavigate();
  const api = useLeaderboardApi();

  const pipelinesState = useAsync<PipelinesResponse>();
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [orchestrators, setOrchestrators] = useState<OrchestratorScore[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [rawStats, setRawStats] = useState<Record<string, RawStatEntry[]>>({});
  const modelCacheRef = useRef<Record<string, OrchestratorScore[]>>({});

  // Load pipeline list to get models for this pipeline
  useEffect(() => {
    pipelinesState.execute(() => api.fetchPipelines());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pipeline = useMemo(
    () =>
      pipelinesState.data?.pipelines.find(
        (p) => p.id === decodeURIComponent(pipelineId || ''),
      ),
    [pipelinesState.data, pipelineId],
  );

  const models = pipeline?.models ?? [];

  // Auto-select first model
  useEffect(() => {
    if (models.length > 0 && !selectedModel) {
      setSelectedModel(models[0]);
    }
  }, [models, selectedModel]);

  // Fetch stats when model changes
  const loadStats = useCallback(
    async (model: string) => {
      if (!pipelineId || !model) return;
      const decodedPipeline = decodeURIComponent(pipelineId);

      // Check cache
      const cacheKey = `${decodedPipeline}:${model}`;
      if (modelCacheRef.current[cacheKey]) {
        setOrchestrators(modelCacheRef.current[cacheKey]);
        return;
      }

      setStatsLoading(true);
      setStatsError(null);
      try {
        const stats = await api.fetchStats(decodedPipeline, model);
        const flat = flattenStats(decodedPipeline, model, stats);
        modelCacheRef.current[cacheKey] = flat;
        setOrchestrators(flat);
      } catch (err) {
        setStatsError(
          err instanceof Error ? err.message : 'Failed to load stats',
        );
        setOrchestrators([]);
      } finally {
        setStatsLoading(false);
      }
    },
    [api, pipelineId],
  );

  useEffect(() => {
    if (selectedModel) {
      loadStats(selectedModel);
    }
  }, [selectedModel, loadStats]);

  // Lazy-load raw stats on row expand
  const handleExpand = useCallback(
    async (address: string, pipelineStr: string, model: string) => {
      const key = `${address}:${pipelineStr}:${model}`;
      if (rawStats[key]) return;

      try {
        const data = await api.fetchRawStats(pipelineStr, model, address);
        const entries = Object.values(data).flat();
        setRawStats((prev) => ({ ...prev, [key]: entries }));
      } catch {
        // Non-critical — just no raw data shown
      }
    },
    [api, rawStats],
  );

  // Bar chart data for score distribution
  const barChartData = useMemo(() => {
    const sorted = [...orchestrators].sort((a, b) => b.score - a.score);
    return sorted.slice(0, 8).map((o) => ({
      label: `${o.address.slice(0, 6)}...${o.address.slice(-4)}`,
      value: o.score * 100,
    }));
  }, [orchestrators]);

  // ── Loading pipeline list ──

  if (pipelinesState.loading && !pipelinesState.data) {
    return (
      <div className="space-y-6 max-w-[1440px] mx-auto p-6">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
          <span className="text-sm text-muted-foreground">
            Loading pipeline data...
          </span>
        </div>
        <TableSkeleton rows={8} />
      </div>
    );
  }

  // ── Pipeline not found ──

  if (!pipeline) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <AlertCircle className="w-8 h-8 mb-3 opacity-50" />
        <p className="text-sm font-medium">
          Pipeline &quot;{pipelineId}&quot; not found
        </p>
        <button
          onClick={() => navigate('/')}
          className="mt-4 px-4 py-2 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1440px] mx-auto p-6">
      {/* Header with back nav */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{pipeline.id}</h1>
          <p className="text-sm text-muted-foreground">
            {pipeline.models.length} model
            {pipeline.models.length !== 1 ? 's' : ''} &middot;{' '}
            {pipeline.regions.join(', ')}
          </p>
        </div>
      </div>

      {/* Model selector tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-muted/30 w-fit">
        {models.map((model) => {
          const shortName = model.includes('/')
            ? model.split('/').pop()!
            : model;
          return (
            <button
              key={model}
              onClick={() => setSelectedModel(model)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                selectedModel === model
                  ? 'bg-card text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title={model}
            >
              {shortName}
            </button>
          );
        })}
      </div>

      {/* Score distribution chart */}
      {barChartData.length > 0 && (
        <div className="rounded-2xl bg-card border border-border p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4 uppercase tracking-wider">
            Score Distribution
          </h2>
          <BarChart items={barChartData} maxValue={100} />
        </div>
      )}

      {/* Orchestrator leaderboard */}
      <div className="rounded-2xl bg-card border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            Orchestrator Leaderboard
          </h2>
          <div className="flex items-center gap-2">
            {statsLoading && (
              <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
            )}
            {statsError && (
              <span className="text-xs text-red-400">{statsError}</span>
            )}
            <button
              onClick={() => {
                delete modelCacheRef.current[
                  `${decodeURIComponent(pipelineId || '')}:${selectedModel}`
                ];
                loadStats(selectedModel);
              }}
              disabled={statsLoading}
              className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${statsLoading ? 'animate-spin' : ''}`}
              />
            </button>
          </div>
        </div>
        {statsLoading && orchestrators.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
            Loading orchestrator data...
          </div>
        ) : (
          <OrchestratorTable
            data={orchestrators}
            onExpand={handleExpand}
            rawStats={rawStats}
          />
        )}
      </div>
    </div>
  );
};
