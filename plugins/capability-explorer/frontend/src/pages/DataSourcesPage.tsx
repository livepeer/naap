import React, { useState, useEffect, useCallback } from 'react';
import {
  Database,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
  Loader2,
  AlertCircle,
  Zap,
} from 'lucide-react';
import type { DataSourceInfo, ExplorerConfig, SnapshotRecord } from '../lib/types';
import { fetchSources, fetchConfig, updateConfig, fetchSnapshots, triggerRefresh } from '../lib/api';

const SOURCE_TYPE_LABELS: Record<string, string> = {
  core: 'Core',
  enrichment: 'Enrichment',
};

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  success: { icon: <CheckCircle2 size={14} />, color: 'text-accent-emerald', label: 'Success' },
  cached: { icon: <Clock size={14} />, color: 'text-accent-amber', label: 'Cached' },
  partial: { icon: <AlertCircle size={14} />, color: 'text-accent-amber', label: 'Partial' },
  error: { icon: <XCircle size={14} />, color: 'text-accent-rose', label: 'Error' },
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export const DataSourcesPage: React.FC = () => {
  const [sources, setSources] = useState<DataSourceInfo[]>([]);
  const [config, setConfig] = useState<ExplorerConfig | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [srcRes, cfgRes, snapRes] = await Promise.all([
        fetchSources(),
        fetchConfig(),
        fetchSnapshots(30),
      ]);
      setSources(srcRes.sources);
      setConfig(cfgRes);
      setSnapshots(snapRes.snapshots);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sources');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleSource = useCallback(async (sourceId: string, currentlyEnabled: boolean) => {
    if (!config) return;
    setToggling(sourceId);
    try {
      const updated = await updateConfig({
        enabledSources: { ...config.enabledSources, [sourceId]: !currentlyEnabled },
      });
      setConfig(updated);
      setSources((prev) =>
        prev.map((s) => (s.id === sourceId ? { ...s, enabled: !currentlyEnabled } : s)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle source');
    } finally {
      setToggling(null);
    }
  }, [config]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await triggerRefresh();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const defaultIntervals: Record<string, number> = {
    clickhouse: 4,
    'onchain-registry': 12,
    huggingface: 4,
  };

  const getInterval = (sourceId: string): number => {
    return config?.refreshIntervals?.[sourceId] ?? defaultIntervals[sourceId] ?? 4;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass-card p-5 animate-pulse">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-bg-tertiary" />
              <div>
                <div className="h-4 bg-bg-tertiary rounded w-48 mb-2" />
                <div className="h-3 bg-bg-tertiary/80 rounded w-32" />
              </div>
            </div>
            <div className="h-3 bg-bg-tertiary/60 rounded w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-text-secondary">
            Data connectors feeding capabilities into the explorer. Toggle sources on/off or trigger a manual refresh.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-emerald/20 hover:bg-accent-emerald/30 text-accent-emerald text-xs font-medium rounded-lg border border-accent-emerald/30 transition-colors disabled:opacity-50"
        >
          {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {refreshing ? 'Refreshing...' : 'Refresh Now'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 glass-card p-4" style={{ borderColor: 'rgba(220, 38, 38, 0.3)', background: 'rgba(220, 38, 38, 0.05)' }}>
          <AlertCircle size={18} className="text-accent-rose shrink-0" />
          <p className="text-sm text-accent-rose">{error}</p>
        </div>
      )}

      {/* Config summary */}
      {config && (
        <div className="glass-card p-4">
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-text-muted" />
              <span className="text-text-secondary">Global interval:</span>
              <span className="font-medium text-text-primary">{config.refreshIntervalHours}h</span>
            </div>
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-text-muted" />
              <span className="text-text-secondary">Last refresh:</span>
              <span className="font-medium text-text-primary">{timeAgo(config.lastRefreshAt)}</span>
            </div>
            {config.lastRefreshStatus && (
              <div className="flex items-center gap-1.5">
                {STATUS_CONFIG[config.lastRefreshStatus]?.icon ?? <Activity size={14} />}
                <span className={`font-medium ${STATUS_CONFIG[config.lastRefreshStatus]?.color ?? 'text-text-muted'}`}>
                  {STATUS_CONFIG[config.lastRefreshStatus]?.label ?? config.lastRefreshStatus}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Source cards */}
      <div className="space-y-3">
        {sources.map((source) => {
          const interval = getInterval(source.id);
          const status = STATUS_CONFIG[source.lastSnapshotStatus ?? ''];
          const isToggling = toggling === source.id;

          return (
            <div
              key={source.id}
              className={`glass-card p-5 transition-all ${!source.enabled ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className={`p-2.5 rounded-xl ${
                    source.type === 'core'
                      ? 'bg-accent-emerald/10 text-accent-emerald'
                      : 'bg-accent-amber/10 text-accent-amber'
                  }`}>
                    {source.type === 'core' ? <Database size={20} /> : <Zap size={20} />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-text-primary">{source.name}</h3>
                      <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${
                        source.type === 'core'
                          ? 'bg-accent-emerald/10 text-accent-emerald'
                          : 'bg-accent-amber/10 text-accent-amber'
                      }`}>
                        {SOURCE_TYPE_LABELS[source.type]}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted mt-0.5">
                      <code className="px-1 py-0.5 bg-bg-tertiary rounded text-[10px]">{source.id}</code>
                    </p>

                    <div className="flex items-center gap-4 mt-3 text-xs text-text-secondary">
                      <div className="flex items-center gap-1.5">
                        <Clock size={12} className="text-text-muted" />
                        Interval: {interval}h
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Activity size={12} className="text-text-muted" />
                        Last run: {timeAgo(source.lastSnapshotAt)}
                      </div>
                      {status && (
                        <div className={`flex items-center gap-1 ${status.color}`}>
                          {status.icon}
                          {status.label}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => toggleSource(source.id, source.enabled)}
                  disabled={isToggling}
                  className="shrink-0 p-1 transition-colors"
                  title={source.enabled ? 'Disable source' : 'Enable source'}
                >
                  {isToggling ? (
                    <Loader2 size={24} className="animate-spin text-text-muted" />
                  ) : source.enabled ? (
                    <ToggleRight size={28} className="text-accent-emerald" />
                  ) : (
                    <ToggleLeft size={28} className="text-text-disabled" />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent snapshots */}
      {snapshots.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-text-primary mb-3">Recent Refresh History</h2>
          <div className="glass-card overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-color)]">
                  <th className="text-left px-4 py-2.5 text-text-muted font-medium">Source</th>
                  <th className="text-left px-4 py-2.5 text-text-muted font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 text-text-muted font-medium">Duration</th>
                  <th className="text-left px-4 py-2.5 text-text-muted font-medium">When</th>
                  <th className="text-left px-4 py-2.5 text-text-muted font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.slice(0, 15).map((snap) => {
                  const st = STATUS_CONFIG[snap.status];
                  return (
                    <tr key={snap.id} className="border-b border-[var(--border-color)] last:border-0">
                      <td className="px-4 py-2 text-text-primary font-medium">
                        <code className="text-[10px]">{snap.sourceId}</code>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`flex items-center gap-1 ${st?.color ?? 'text-text-muted'}`}>
                          {st?.icon}
                          {st?.label ?? snap.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-text-secondary">
                        {snap.durationMs < 1000
                          ? `${snap.durationMs}ms`
                          : `${(snap.durationMs / 1000).toFixed(1)}s`}
                      </td>
                      <td className="px-4 py-2 text-text-secondary">{timeAgo(snap.createdAt)}</td>
                      <td className="px-4 py-2 text-accent-rose max-w-[200px] truncate">
                        {snap.errorMessage || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
