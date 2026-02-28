import React from 'react';
import { TrendingUp, Download, Users } from 'lucide-react';
import type { PluginStats } from '../lib/api';

interface StatsChartProps {
  stats: PluginStats | null;
  loading?: boolean;
}

export const StatsChart: React.FC<StatsChartProps> = ({ stats, loading }) => {
  if (loading) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current text-text-secondary"></div>
          <span className="text-text-secondary">Loading stats...</span>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="glass-card p-6 text-center text-text-secondary">
        No statistics available yet.
      </div>
    );
  }

  const maxDownload = Math.max(...stats.timeline.map(t => t.downloads), 1);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent-emerald/20 rounded-lg">
              <Download className="w-5 h-5 text-accent-emerald" />
            </div>
            <div>
              <div className="text-2xl font-bold text-text-primary">
                {(stats.totalDownloads ?? 0).toLocaleString()}
              </div>
              <div className="text-sm text-text-secondary">Total Downloads</div>
            </div>
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent-blue/20 rounded-lg">
              <Users className="w-5 h-5 text-accent-blue" />
            </div>
            <div>
              <div className="text-2xl font-bold text-text-primary">
                {(stats.totalInstalls ?? 0).toLocaleString()}
              </div>
              <div className="text-sm text-text-secondary">Active Installs</div>
            </div>
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent-purple/20 rounded-lg">
              <TrendingUp className="w-5 h-5 text-accent-purple" />
            </div>
            <div>
              <div className="text-2xl font-bold text-text-primary">
                {stats.versionsCount}
              </div>
              <div className="text-sm text-text-secondary">Versions</div>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline Chart */}
      {stats.timeline.length > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-lg font-medium text-text-primary mb-4">Downloads Over Time</h3>
          <div className="h-48 flex items-end gap-1">
            {stats.timeline.map((point, i) => (
              <div
                key={i}
                className="flex-1 bg-accent-emerald/30 hover:bg-accent-emerald/50 transition-colors rounded-t"
                style={{ height: `${(point.downloads / maxDownload) * 100}%`, minHeight: '4px' }}
                title={`${point.date}: ${point.downloads} downloads`}
              />
            ))}
          </div>
          <div className="flex justify-between mt-2 text-xs text-text-secondary">
            <span>{stats.timeline[0]?.date}</span>
            <span>{stats.timeline[stats.timeline.length - 1]?.date}</span>
          </div>
        </div>
      )}
    </div>
  );
};
