import React, { useState, useEffect, useCallback } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';

interface UsageBucket {
  timestamp: number;
  completed: number;
  failed: number;
  retried: number;
}

interface UsageStats {
  buckets: UsageBucket[];
  totalRequests: number;
  totalCompleted: number;
  totalFailed: number;
  totalRetried: number;
  avgResponseTimeMs: number;
}

interface UsageTabProps {
  deploymentId: string;
}

const API_BASE = '/api/v1/deployment-manager';

export const UsageTab: React.FC<UsageTabProps> = ({ deploymentId }) => {
  const [range, setRange] = useState<'hour' | 'day'>('hour');
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUsage = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/deployments/${deploymentId}/usage?range=${range}`);
      const data = await res.json();
      if (data.success) setStats(data.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [deploymentId, range]);

  useEffect(() => {
    setLoading(true);
    fetchUsage();
    const timer = setInterval(fetchUsage, 30000);
    return () => clearInterval(timer);
  }, [fetchUsage]);

  const maxBucketTotal = stats
    ? Math.max(1, ...stats.buckets.map(b => b.completed + b.failed + b.retried))
    : 1;

  const successRate = stats && stats.totalRequests > 0
    ? Math.round((stats.totalCompleted / stats.totalRequests) * 100)
    : 0;

  return (
    <div>
      {/* Header with range toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <BarChart3 size={16} />
          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Request Usage</span>
        </div>
        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          <button onClick={fetchUsage} style={{ padding: '0.25rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--dm-text-secondary)' }} title="Refresh">
            <RefreshCw size={14} />
          </button>
          {(['hour', 'day'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                padding: '0.25rem 0.6rem', borderRadius: '0.25rem', fontSize: '0.75rem',
                cursor: 'pointer',
                border: range === r ? '1px solid var(--dm-accent-blue)' : '1px solid var(--dm-border)',
                background: range === r ? 'var(--dm-accent-blue)' : 'var(--dm-bg-secondary)',
                color: range === r ? '#fff' : 'var(--dm-text-secondary)',
              }}
            >
              Past {r === 'hour' ? 'Hour' : 'Day'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary counters */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
        {[
          { label: 'Total Requests', value: stats?.totalRequests ?? 0, color: 'var(--dm-text-primary)' },
          { label: 'Completed', value: stats?.totalCompleted ?? 0, color: '#22c55e' },
          { label: 'Failed', value: stats?.totalFailed ?? 0, color: '#ef4444' },
          { label: 'Avg Response', value: `${stats?.avgResponseTimeMs ?? 0}ms`, color: 'var(--dm-text-primary)' },
        ].map((item) => (
          <div key={item.label} style={{
            padding: '0.75rem', background: 'var(--dm-bg-secondary)',
            borderRadius: '0.375rem', textAlign: 'center',
          }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--dm-text-tertiary)', marginBottom: '0.25rem' }}>{item.label}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* SVG Chart */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--dm-text-tertiary)' }}>Loading...</div>
      ) : !stats || stats.totalRequests === 0 ? (
        <div style={{
          textAlign: 'center', padding: '3rem', color: 'var(--dm-text-tertiary)',
          border: '1px dashed var(--dm-border)', borderRadius: '0.5rem',
        }}>
          <BarChart3 size={32} style={{ opacity: 0.3, marginBottom: '0.5rem' }} />
          <p style={{ margin: 0, fontSize: '0.875rem' }}>No requests recorded yet</p>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem' }}>Send a request from the Request tab to see usage data here</p>
        </div>
      ) : (
        <div data-testid="usage-chart" style={{ background: 'var(--dm-bg-secondary)', borderRadius: '0.5rem', padding: '1rem' }}>
          <svg width="100%" viewBox={`0 0 ${stats.buckets.length * 20 + 40} 160`} style={{ overflow: 'visible' }}>
            {/* Y-axis labels */}
            <text x="0" y="15" fontSize="9" fill="#9ca3af">{maxBucketTotal}</text>
            <text x="0" y="80" fontSize="9" fill="#9ca3af">{Math.round(maxBucketTotal / 2)}</text>
            <text x="0" y="145" fontSize="9" fill="#9ca3af">0</text>

            {/* Bars */}
            {stats.buckets.map((bucket, i) => {
              const total = bucket.completed + bucket.failed + bucket.retried;
              if (total === 0) return null;
              const barX = 35 + i * 20;
              const barWidth = 14;
              const maxBarH = 120;

              const completedH = (bucket.completed / maxBucketTotal) * maxBarH;
              const retriedH = (bucket.retried / maxBucketTotal) * maxBarH;
              const failedH = (bucket.failed / maxBucketTotal) * maxBarH;

              let y = 140;
              return (
                <g key={i}>
                  {bucket.completed > 0 && (
                    <rect x={barX} y={y - completedH} width={barWidth} height={completedH} rx={2} fill="#22c55e" opacity={0.85}>
                      <title>Completed: {bucket.completed}</title>
                    </rect>
                  )}
                  {(() => { y -= completedH; return null; })()}
                  {bucket.retried > 0 && (
                    <rect x={barX} y={y - retriedH} width={barWidth} height={retriedH} rx={2} fill="#eab308" opacity={0.85}>
                      <title>Retried: {bucket.retried}</title>
                    </rect>
                  )}
                  {(() => { y -= retriedH; return null; })()}
                  {bucket.failed > 0 && (
                    <rect x={barX} y={y - failedH} width={barWidth} height={failedH} rx={2} fill="#ef4444" opacity={0.85}>
                      <title>Failed: {bucket.failed}</title>
                    </rect>
                  )}
                </g>
              );
            })}

            {/* Baseline */}
            <line x1="30" y1="140" x2={35 + stats.buckets.length * 20} y2="140" stroke="#374151" strokeWidth="1" />
          </svg>

          {/* Legend */}
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '0.5rem', fontSize: '0.7rem' }}>
            {[
              { color: '#22c55e', label: 'Completed' },
              { color: '#eab308', label: 'Retried' },
              { color: '#ef4444', label: 'Failed' },
            ].map((item) => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--dm-text-secondary)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: item.color, display: 'inline-block' }} />
                {item.label}
              </div>
            ))}
          </div>

          {successRate > 0 && (
            <div style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--dm-text-tertiary)' }}>
              Success rate: {successRate}%
            </div>
          )}
        </div>
      )}
    </div>
  );
};
