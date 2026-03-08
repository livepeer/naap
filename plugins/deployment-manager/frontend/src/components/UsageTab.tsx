import React, { useState, useEffect, useCallback } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';

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

export const UsageTab: React.FC<UsageTabProps> = ({ deploymentId }) => {
  const [range, setRange] = useState<'hour' | 'day'>('hour');
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUsage = useCallback(async () => {
    try {
      const res = await apiFetch(`/deployments/${deploymentId}/usage?range=${range}`);
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
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 size={14} className="text-muted-foreground" />
          <span className="font-medium text-sm text-foreground">Request Usage</span>
        </div>
        <div className="flex gap-1 items-center">
          <button onClick={fetchUsage} className="h-7 w-7 flex items-center justify-center bg-transparent border-none cursor-pointer text-muted-foreground hover:text-foreground" title="Refresh">
            <RefreshCw size={13} />
          </button>
          {(['hour', 'day'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`h-7 px-2.5 rounded-md text-xs cursor-pointer transition-all ${
                range === r
                  ? 'bg-foreground text-background font-medium'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              Past {r === 'hour' ? 'Hour' : 'Day'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total Requests', value: stats?.totalRequests ?? 0, color: undefined },
          { label: 'Completed', value: stats?.totalCompleted ?? 0, color: '#22c55e' },
          { label: 'Failed', value: stats?.totalFailed ?? 0, color: '#ef4444' },
          { label: 'Avg Response', value: `${stats?.avgResponseTimeMs ?? 0}ms`, color: undefined },
        ].map((item) => (
          <div key={item.label} className="p-3 bg-secondary rounded-md text-center">
            <div className="text-xs text-muted-foreground mb-1">{item.label}</div>
            <div className={`text-lg font-semibold ${item.color ? '' : 'text-foreground'}`} style={item.color ? { color: item.color } : undefined}>
              {item.value}
            </div>
          </div>
        ))}
      </div>

      {/* SVG Chart */}
      {loading ? (
        <div className="text-center p-8 text-muted-foreground text-sm">Loading...</div>
      ) : !stats || stats.totalRequests === 0 ? (
        <div className="text-center p-12 text-muted-foreground border border-dashed border-border rounded-lg">
          <BarChart3 size={28} className="opacity-20 mb-2 mx-auto" />
          <p className="m-0 text-sm">No requests recorded yet</p>
          <p className="mt-1 mb-0 text-xs">Send a request from the Request tab to see usage data here</p>
        </div>
      ) : (
        <div data-testid="usage-chart" className="bg-secondary rounded-lg p-4">
          <svg width="100%" viewBox={`0 0 ${stats.buckets.length * 20 + 40} 160`} className="overflow-visible">
            {/* Y-axis labels */}
            <text x="0" y="15" fontSize="9" fill="#a1a1aa">{maxBucketTotal}</text>
            <text x="0" y="80" fontSize="9" fill="#a1a1aa">{Math.round(maxBucketTotal / 2)}</text>
            <text x="0" y="145" fontSize="9" fill="#a1a1aa">0</text>

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
            <line x1="30" y1="140" x2={35 + stats.buckets.length * 20} y2="140" stroke="#71717a" strokeWidth="1" />
          </svg>

          {/* Legend */}
          <div className="flex gap-4 justify-center mt-2 text-xs">
            {[
              { color: '#22c55e', label: 'Completed' },
              { color: '#eab308', label: 'Retried' },
              { color: '#ef4444', label: 'Failed' },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-1 text-muted-foreground">
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: item.color }} />
                {item.label}
              </div>
            ))}
          </div>

          {successRate > 0 && (
            <div className="text-center mt-2 text-xs text-muted-foreground">
              Success rate: {successRate}%
            </div>
          )}
        </div>
      )}
    </div>
  );
};
