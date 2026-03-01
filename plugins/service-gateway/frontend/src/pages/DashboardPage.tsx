/**
 * DashboardPage — Usage monitoring dashboard with charts, tables, and health panel.
 * Uses lightweight chart components (no Recharts dependency — CSS-based for plugin build compatibility).
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useGatewayApi, useAsync } from '../hooks/useGatewayApi';
import { HealthDot } from '../components/HealthDot';

// ── Types ──

interface Summary {
  totalRequests: number;
  avgLatencyMs: number;
  errorCount: number;
  errorRate: number;
}

interface ConnectorUsage {
  connectorId: string;
  slug: string;
  displayName: string;
  requests: number;
  avgLatencyMs: number;
  errorRate: number;
}

interface TimeseriesPoint {
  timestamp: string;
  requests: number;
  errors: number;
  avgLatencyMs: number;
}

interface HealthStatus {
  connectorId: string;
  slug: string;
  displayName: string;
  status: string;
  latencyMs: number | null;
  lastCheckedAt: string | null;
}

interface HealthData {
  summary: { total: number; up: number; down: number; degraded: number };
  connectors: HealthStatus[];
}

// ── Time Range ──

const TIME_RANGES = [
  { label: '1h', ms: 3_600_000, interval: '1m' },
  { label: '6h', ms: 21_600_000, interval: '5m' },
  { label: '24h', ms: 86_400_000, interval: '15m' },
  { label: '7d', ms: 604_800_000, interval: '1h' },
  { label: '30d', ms: 2_592_000_000, interval: '6h' },
];

// ── Stat Card ──

const StatCard: React.FC<{ label: string; value: string; trend?: string; color?: string }> = ({
  label,
  value,
  trend,
  color = 'text-gray-200',
}) => (
  <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
    <div className="text-xs text-gray-400 mb-1">{label}</div>
    <div className={`text-2xl font-bold ${color}`}>{value}</div>
    {trend && <div className="text-xs text-gray-500 mt-1">{trend}</div>}
  </div>
);

// ── Mini Bar Chart (CSS-based) ──

const MiniChart: React.FC<{ points: TimeseriesPoint[]; field: 'requests' | 'avgLatencyMs' | 'errors' }> = ({
  points,
  field,
}) => {
  if (points.length === 0) return <div className="text-gray-500 text-xs py-4 text-center">No data</div>;
  const max = Math.max(1, ...points.map((p) => p[field]));
  const displayPoints = points.slice(-60); // last 60 data points

  return (
    <div className="flex items-end gap-px h-24">
      {displayPoints.map((point, i) => {
        const height = (point[field] / max) * 100;
        const isError = field === 'errors' || field === 'avgLatencyMs';
        return (
          <div
            key={i}
            className={`flex-1 min-w-[2px] rounded-t ${
              isError && point[field] > 0
                ? 'bg-red-400/60'
                : 'bg-blue-400/60'
            }`}
            style={{ height: `${Math.max(1, height)}%` }}
            title={`${new Date(point.timestamp).toLocaleTimeString()}: ${point[field]}`}
          />
        );
      })}
    </div>
  );
};

// ── Main Dashboard ──

export const DashboardPage: React.FC = () => {
  const api = useGatewayApi();
  const [timeRange, setTimeRange] = useState(TIME_RANGES[2]); // 24h default
  const [autoRefresh, setAutoRefresh] = useState(false);

  const { data: summaryRes, execute: loadSummary } = useAsync<{ success: boolean; data: Summary }>();
  const { data: byConnectorRes, execute: loadByConnector } = useAsync<{ success: boolean; data: ConnectorUsage[] }>();
  const { data: timeseriesRes, execute: loadTimeseries } = useAsync<{ success: boolean; data: { points: TimeseriesPoint[] } }>();
  const { data: healthRes, execute: loadHealth } = useAsync<{ success: boolean; data: HealthData }>();

  const from = new Date(Date.now() - timeRange.ms).toISOString();

  const fetchAll = useCallback(() => {
    const params = `from=${from}`;
    loadSummary(() => api.get(`/usage/summary?${params}`));
    loadByConnector(() => api.get(`/usage/by-connector?${params}`));
    loadTimeseries(() => api.get(`/usage/timeseries?${params}&interval=${timeRange.interval}`));
    loadHealth(() => api.get('/health'));
  }, [from, timeRange.interval, loadSummary, loadByConnector, loadTimeseries, loadHealth, api]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchAll, 30_000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchAll]);

  const summary = summaryRes?.data;
  const connectors = byConnectorRes?.data || [];
  const timeseries = timeseriesRes?.data?.points || [];
  const health = healthRes?.data;

  return (
    <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-100">Dashboard</h1>
          <div className="flex items-center gap-3">
            {/* Time Range Selector */}
            <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
              {TIME_RANGES.map((tr) => (
                <button
                  key={tr.label}
                  onClick={() => setTimeRange(tr)}
                  className={`px-3 py-1 text-xs font-medium rounded ${
                    timeRange.label === tr.label
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {tr.label}
                </button>
              ))}
            </div>

            {/* Auto-Refresh Toggle */}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
                autoRefresh
                  ? 'bg-green-600/20 text-green-400 border border-green-600/30'
                  : 'bg-gray-800 text-gray-400 border border-gray-700'
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
              {autoRefresh ? 'Live' : 'Auto-refresh off'}
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard
            label="Total Requests"
            value={summary?.totalRequests?.toLocaleString() || '0'}
          />
          <StatCard
            label="Avg Latency"
            value={`${summary?.avgLatencyMs || 0}ms`}
            color={summary && summary.avgLatencyMs > 1000 ? 'text-yellow-400' : 'text-gray-200'}
          />
          <StatCard
            label="Error Rate"
            value={`${summary?.errorRate || 0}%`}
            color={summary && summary.errorRate > 5 ? 'text-red-400' : 'text-gray-200'}
          />
          <StatCard
            label="Upstreams"
            value={health ? `${health.summary.up}/${health.summary.total}` : '—'}
            color={health && health.summary.down > 0 ? 'text-red-400' : 'text-green-400'}
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <h3 className="text-xs text-gray-400 mb-3">Requests</h3>
            <MiniChart points={timeseries} field="requests" />
          </div>
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <h3 className="text-xs text-gray-400 mb-3">Avg Latency (ms)</h3>
            <MiniChart points={timeseries} field="avgLatencyMs" />
          </div>
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <h3 className="text-xs text-gray-400 mb-3">Errors</h3>
            <MiniChart points={timeseries} field="errors" />
          </div>
        </div>

        {/* Tables Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Per-Connector Breakdown */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700">
              <h3 className="text-sm font-semibold text-gray-300">By Connector</h3>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="px-4 py-2 text-left text-gray-400">Connector</th>
                  <th className="px-4 py-2 text-right text-gray-400">Requests</th>
                  <th className="px-4 py-2 text-right text-gray-400">Latency</th>
                  <th className="px-4 py-2 text-right text-gray-400">Errors</th>
                </tr>
              </thead>
              <tbody>
                {connectors.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500">No traffic yet</td></tr>
                )}
                {connectors.map((c) => (
                  <tr key={c.connectorId} className="border-b border-gray-700/50">
                    <td className="px-4 py-2 text-gray-200">{c.displayName}</td>
                    <td className="px-4 py-2 text-right text-gray-300">{c.requests.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right text-gray-300">{c.avgLatencyMs}ms</td>
                    <td className="px-4 py-2 text-right">
                      <span className={c.errorRate > 5 ? 'text-red-400' : 'text-gray-300'}>{c.errorRate}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Health Panel */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700">
              <h3 className="text-sm font-semibold text-gray-300">Upstream Health</h3>
            </div>
            <div className="divide-y divide-gray-700/50">
              {(!health || health.connectors.length === 0) && (
                <div className="px-4 py-6 text-center text-gray-500 text-xs">No published connectors</div>
              )}
              {health?.connectors.map((c) => (
                <div key={c.connectorId} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <HealthDot status={c.status} />
                    <span className="text-sm text-gray-200">{c.displayName}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    {c.latencyMs !== null && <span>{c.latencyMs}ms</span>}
                    <span className="capitalize">{c.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
  );
};
