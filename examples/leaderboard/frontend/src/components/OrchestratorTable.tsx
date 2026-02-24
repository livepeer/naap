import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ScoreBadge } from './ScoreBadge';
import { RegionBadge } from './RegionBadge';
import type { OrchestratorScore, RawStatEntry } from '../types';

export interface OrchestratorTableProps {
  data: OrchestratorScore[];
  onExpand?: (address: string, pipeline: string, model: string) => void;
  rawStats?: Record<string, RawStatEntry[]>;
  showPipelineColumn?: boolean;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export const OrchestratorTable: React.FC<OrchestratorTableProps> = ({
  data,
  onExpand,
  rawStats,
  showPipelineColumn = false,
}) => {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const sorted = useMemo(
    () =>
      [...data].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.address.localeCompare(b.address);
      }),
    [data],
  );

  const toggleRow = (address: string, pipeline: string, model: string) => {
    const key = `${address}:${pipeline}:${model}`;
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        onExpand?.(address, pipeline, model);
      }
      return next;
    });
  };

  if (data.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground text-sm">
        No orchestrator data available
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-10">
              #
            </th>
            <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Orchestrator
            </th>
            {showPipelineColumn && (
              <>
                <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Pipeline
                </th>
                <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Model
                </th>
              </>
            )}
            <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Region
            </th>
            <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Success
            </th>
            <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              RTT Score
            </th>
            <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Score
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sorted.map((row, idx) => {
            const rowKey = `${row.address}:${row.pipeline}:${row.model}`;
            const isExpanded = expandedRows.has(rowKey);
            const entries = rawStats?.[rowKey];

            return (
              <React.Fragment key={rowKey}>
                <tr
                  className="hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() =>
                    toggleRow(row.address, row.pipeline, row.model)
                  }
                >
                  <td className="p-3 text-muted-foreground font-mono text-xs">
                    {idx + 1}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {onExpand && (
                        isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                        )
                      )}
                      <span
                        className="font-mono text-foreground"
                        title={row.address}
                      >
                        {truncateAddress(row.address)}
                      </span>
                    </div>
                  </td>
                  {showPipelineColumn && (
                    <>
                      <td className="p-3 text-muted-foreground">
                        {row.pipeline}
                      </td>
                      <td className="p-3 text-muted-foreground text-xs truncate max-w-[180px]">
                        {row.model}
                      </td>
                    </>
                  )}
                  <td className="p-3">
                    <RegionBadge region={row.region} />
                  </td>
                  <td className="p-3 text-right">
                    <ScoreBadge score={row.successRate} />
                  </td>
                  <td className="p-3 text-right">
                    <ScoreBadge score={row.roundTripScore} />
                  </td>
                  <td className="p-3 text-right">
                    <ScoreBadge score={row.score} />
                  </td>
                </tr>
                {isExpanded && entries && (
                  <tr>
                    <td
                      colSpan={showPipelineColumn ? 8 : 6}
                      className="p-0"
                    >
                      <div className="bg-muted/20 px-6 py-3 border-t border-border/50">
                        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                          Recent Runs ({entries.length})
                        </p>
                        <div className="space-y-1.5">
                          {entries.slice(0, 10).map((entry, i) => (
                            <div
                              key={`${entry.timestamp}-${i}`}
                              className="flex items-center gap-4 text-xs"
                            >
                              <span className="text-muted-foreground w-36">
                                {formatTimestamp(entry.timestamp)}
                              </span>
                              <span className="font-mono text-foreground w-20">
                                {entry.round_trip_time.toFixed(2)}s
                              </span>
                              <ScoreBadge score={entry.success_rate} />
                              {entry.model_is_warm && (
                                <span className="text-emerald-400 text-[10px]">
                                  WARM
                                </span>
                              )}
                              {entry.errors.length > 0 && (
                                <span className="text-red-400 truncate max-w-[200px]">
                                  {entry.errors.join(', ')}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
