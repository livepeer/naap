import React, { useState, useEffect, useCallback } from 'react';
import { Settings, RefreshCw, Clock, Database, Layers, FileText, GripVertical, ChevronDown, ChevronRight } from 'lucide-react';
import { useAuthService } from '@naap/plugin-sdk';
import { useDatasetConfig } from '../hooks/useDatasetConfig';
import {
  fetchSources,
  updateSources,
  fetchAudits,
  type LeaderboardSourceDTO,
  type RefreshAuditDTO,
} from '../lib/api';

const INTERVAL_OPTIONS = [
  { value: 1, label: '1 hour' },
  { value: 4, label: '4 hours' },
  { value: 8, label: '8 hours' },
  { value: 12, label: '12 hours' },
] as const;

const SOURCE_LABELS: Record<string, { label: string; description: string }> = {
  'livepeer-subgraph': { label: 'On-Chain Registry', description: 'Ground-truth membership from Livepeer subgraph' },
  'clickhouse-query': { label: 'ClickHouse Metrics', description: 'Performance metrics (latency, GPU, pricing)' },
  'naap-discover': { label: 'NaaP Discovery', description: 'Live capabilities, scores, and liveness' },
  'naap-pricing': { label: 'NaaP Pricing', description: 'Per-pipeline pricing data' },
};

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'Never';
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatRefreshedBy(by: string | null): string {
  if (!by) return '—';
  if (by === 'cron') return 'Scheduled (cron)';
  if (by.startsWith('admin:')) return 'Admin (manual)';
  return by;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

type AdminTab = 'config' | 'sources' | 'audits';

// ---------------------------------------------------------------------------
// Data Sources Panel
// ---------------------------------------------------------------------------

const DataSourcesPanel: React.FC = () => {
  const [sources, setSources] = useState<LeaderboardSourceDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchSources();
      setSources(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sources');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (kind: string) => {
    const updated = sources.map((s) =>
      s.kind === kind ? { ...s, enabled: !s.enabled } : s,
    );
    setSources(updated);
    setSaving(true);
    try {
      const saved = await updateSources(
        updated.map((s) => ({ kind: s.kind, enabled: s.enabled, priority: s.priority })),
      );
      setSources(saved);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDragStart = (idx: number) => setDragIdx(idx);

  const handleDragOver = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === targetIdx) return;
    const reordered = [...sources];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(targetIdx, 0, moved);
    const reprioritized = reordered.map((s, i) => ({ ...s, priority: i + 1 }));
    setSources(reprioritized);
    setDragIdx(targetIdx);
  };

  const handleDragEnd = async () => {
    setDragIdx(null);
    setSaving(true);
    try {
      const saved = await updateSources(
        sources.map((s) => ({ kind: s.kind, enabled: s.enabled, priority: s.priority })),
      );
      setSources(saved);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save order');
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading sources…</p>;
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-xs" style={{ color: 'var(--accent-rose)' }}>{error}</p>
      )}
      <p className="text-xs" style={{ color: 'var(--text-supporting)' }}>
        Drag to reorder priority (top = highest). Tier-1 source owns orchestrator membership.
        {saving && <span className="ml-2 italic">Saving…</span>}
      </p>
      <div className="space-y-1">
        {sources.map((src, idx) => {
          const meta = SOURCE_LABELS[src.kind] ?? { label: src.kind, description: '' };
          return (
            <div
              key={src.kind}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className="flex items-center gap-3 px-3 py-2 rounded-lg transition-colors"
              style={{
                background: dragIdx === idx ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                opacity: src.enabled ? 1 : 0.5,
                cursor: 'grab',
              }}
            >
              <GripVertical size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <span
                className="text-xs font-bold w-5 text-center"
                style={{ color: 'var(--text-supporting)' }}
              >
                {src.priority}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {meta.label}
                </p>
                <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                  {meta.description}
                </p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleToggle(src.kind); }}
                className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0"
                style={{
                  background: src.enabled ? 'var(--accent-emerald)' : 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <span
                  className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
                  style={{ transform: src.enabled ? 'translateX(16px)' : 'translateX(2px)' }}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Audit Log Panel
// ---------------------------------------------------------------------------

const AuditRow: React.FC<{ audit: RefreshAuditDTO }> = ({ audit }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-lg text-xs"
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span style={{ color: 'var(--text-secondary)' }}>
          {formatRelativeTime(audit.refreshedAt)}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          by {formatRefreshedBy(audit.refreshedBy)}
        </span>
        <span className="ml-auto flex items-center gap-3" style={{ color: 'var(--text-supporting)' }}>
          <span>{audit.totalOrchestrators} orchs</span>
          <span>{audit.totalCapabilities} caps</span>
          <span>{formatDuration(audit.durationMs)}</span>
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
          {/* Per-Source stats */}
          <div className="pt-2">
            <p className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
              Sources
            </p>
            <div className="grid grid-cols-2 gap-1">
              {Object.entries(audit.perSource).map(([kind, stats]) => (
                <div key={kind} className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: stats.ok ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}
                  />
                  <span style={{ color: 'var(--text-primary)' }}>
                    {SOURCE_LABELS[kind]?.label ?? kind}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {stats.fetched} rows, {formatDuration(stats.durationMs)}
                  </span>
                  {stats.errorMessage && (
                    <span style={{ color: 'var(--accent-rose)' }} className="truncate max-w-[200px]">
                      {stats.errorMessage}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Conflicts */}
          {audit.conflicts.length > 0 && (
            <div>
              <p className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                Conflicts ({audit.conflicts.length})
              </p>
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {audit.conflicts.slice(0, 50).map((c, i) => (
                  <p key={i} style={{ color: 'var(--text-muted)' }}>
                    {c.orchKey} / {c.field}: won by {c.winner}
                  </p>
                ))}
                {audit.conflicts.length > 50 && (
                  <p style={{ color: 'var(--text-muted)' }}>
                    …and {audit.conflicts.length - 50} more
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Dropped */}
          {audit.dropped.length > 0 && (
            <div>
              <p className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                Dropped ({audit.dropped.length})
              </p>
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {audit.dropped.slice(0, 20).map((d, i) => (
                  <p key={i} style={{ color: 'var(--text-muted)' }}>
                    {d.orchKey} from {d.source}: {d.reason}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {audit.warnings.length > 0 && (
            <div>
              <p className="font-medium mb-1" style={{ color: 'var(--accent-amber)' }}>
                Warnings
              </p>
              {audit.warnings.map((w, i) => (
                <p key={i} style={{ color: 'var(--text-muted)' }}>{w}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const AuditLogPanel: React.FC = () => {
  const [audits, setAudits] = useState<RefreshAuditDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async (cursor?: string) => {
    setLoading(true);
    try {
      const result = await fetchAudits(10, cursor);
      if (cursor) {
        setAudits((prev) => [...prev, ...result.items]);
      } else {
        setAudits(result.items);
      }
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audits');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && audits.length === 0) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading audit log…</p>;
  }

  if (error && audits.length === 0) {
    return <p className="text-xs" style={{ color: 'var(--accent-rose)' }}>{error}</p>;
  }

  if (audits.length === 0) {
    return <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No refresh audits yet.</p>;
  }

  return (
    <div className="space-y-2">
      {audits.map((a) => (
        <AuditRow key={a.id} audit={a} />
      ))}
      {hasMore && (
        <button
          onClick={() => nextCursor && load(nextCursor)}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg"
          style={{
            color: 'var(--text-secondary)',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
          }}
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main AdminSettings
// ---------------------------------------------------------------------------

export const AdminSettings: React.FC = () => {
  const auth = useAuthService();
  const isAdmin = auth.hasRole('system:admin');

  const {
    config,
    isLoading,
    error,
    updateInterval,
    refreshNow,
    isRefreshing,
    lastRefreshResult,
  } = useDatasetConfig();

  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('config');
  const [updateError, setUpdateError] = useState<string | null>(null);

  if (!isAdmin) return null;

  const tabs: { id: AdminTab; label: string; icon: React.ReactNode }[] = [
    { id: 'config', label: 'Config', icon: <Clock size={12} /> },
    { id: 'sources', label: 'Data Sources', icon: <Layers size={12} /> },
    { id: 'audits', label: 'Refresh Audit', icon: <FileText size={12} /> },
  ];

  return (
    <div className="mb-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
        style={{
          color: 'var(--text-supporting)',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
        }}
      >
        <Settings size={14} />
        Dataset Settings
        <span
          className="ml-1 transition-transform"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          ▾
        </span>
      </button>

      {isOpen && (
        <div
          className="mt-3 rounded-xl"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
          }}
        >
          {/* Tab bar */}
          <div
            className="flex border-b px-2"
            style={{ borderColor: 'var(--border-color)' }}
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors"
                style={{
                  color: activeTab === tab.id ? 'var(--accent-emerald)' : 'var(--text-muted)',
                  borderBottom: activeTab === tab.id ? '2px solid var(--accent-emerald)' : '2px solid transparent',
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-4">
            {/* Config tab */}
            {activeTab === 'config' && (
              <>
                {isLoading ? (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading config…</p>
                ) : error && !config ? (
                  <p className="text-sm" style={{ color: 'var(--accent-rose)' }}>{error}</p>
                ) : config ? (
                  <div className="space-y-4">
                    {/* Refresh Interval */}
                    <div>
                      <label
                        className="block text-xs font-medium mb-2"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <Clock size={12} className="inline mr-1" />
                        Refresh Interval
                      </label>
                      <div className="flex gap-2 flex-wrap">
                        {INTERVAL_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={async () => {
                              setUpdateError(null);
                              try {
                                await updateInterval(opt.value);
                              } catch (e) {
                                setUpdateError(e instanceof Error ? e.message : 'Update failed');
                              }
                            }}
                            className="px-3 py-1.5 text-xs font-medium rounded-full border transition-all cursor-pointer"
                            style={
                              config.refreshIntervalHours === opt.value
                                ? {
                                    background: 'rgba(30, 153, 96, 0.15)',
                                    color: 'var(--accent-emerald)',
                                    borderColor: 'rgba(30, 153, 96, 0.3)',
                                  }
                                : {
                                    background: 'var(--bg-tertiary)',
                                    color: 'var(--text-secondary)',
                                    borderColor: 'var(--border-color)',
                                  }
                            }
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      {updateError && (
                        <p className="text-xs mt-1" style={{ color: 'var(--accent-rose)' }}>
                          {updateError}
                        </p>
                      )}
                    </div>

                    {/* Last Refresh Info */}
                    <div
                      className="flex items-center gap-4 flex-wrap text-xs"
                      style={{ color: 'var(--text-supporting)' }}
                    >
                      <span className="flex items-center gap-1">
                        <Database size={12} />
                        Last refresh: {formatRelativeTime(config.lastRefreshedAt)}
                      </span>
                      <span>By: {formatRefreshedBy(config.lastRefreshedBy)}</span>
                      {lastRefreshResult && (
                        <span style={{ color: 'var(--accent-emerald)' }}>
                          {lastRefreshResult.capabilities} capabilities, {lastRefreshResult.orchestrators} orchestrators
                        </span>
                      )}
                    </div>

                    {/* Refresh Now */}
                    <button
                      onClick={async () => {
                        setUpdateError(null);
                        try {
                          await refreshNow();
                        } catch (e) {
                          setUpdateError(e instanceof Error ? e.message : 'Refresh failed');
                        }
                      }}
                      disabled={isRefreshing}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                      style={{
                        background: 'var(--accent-emerald)',
                        color: '#fff',
                      }}
                    >
                      <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
                      {isRefreshing ? 'Refreshing…' : 'Refresh Now'}
                    </button>
                  </div>
                ) : null}
              </>
            )}

            {/* Sources tab */}
            {activeTab === 'sources' && <DataSourcesPanel />}

            {/* Audits tab */}
            {activeTab === 'audits' && <AuditLogPanel />}
          </div>
        </div>
      )}
    </div>
  );
};
