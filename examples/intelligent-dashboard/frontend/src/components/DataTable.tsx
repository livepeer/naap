import React, { useState } from 'react';
import type { OrchestratorStats } from '../types';

interface DataTableProps {
  data: OrchestratorStats[];
  columns?: string[];
  title?: string;
}

const COLUMN_LABELS: Record<string, string> = {
  orchestrator: 'Orchestrator',
  score: 'Score',
  latency_score: 'Latency Score',
  success_rate: 'Success Rate',
  total_rounds: 'Rounds',
  avg_time: 'Avg Time (ms)',
  errors_count: 'Errors',
};

function formatCell(key: string, value: unknown): string {
  if (value == null) return '-';
  if (key === 'orchestrator' && typeof value === 'string') {
    return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
  }
  if (key === 'success_rate' && typeof value === 'number') {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (typeof value === 'number') {
    return value >= 1 ? value.toFixed(2) : value.toFixed(4);
  }
  return String(value);
}

export const DataTable: React.FC<DataTableProps> = ({ data, columns, title }) => {
  const cols = columns || ['orchestrator', 'score', 'success_rate', 'avg_time', 'total_rounds'];
  const [sortKey, setSortKey] = useState<string>(cols[1] || 'score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = [...data].sort((a, b) => {
    const aVal = (a as unknown as Record<string, unknown>)[sortKey];
    const bVal = (b as unknown as Record<string, unknown>)[sortKey];
    const aNum = typeof aVal === 'number' ? aVal : 0;
    const bNum = typeof bVal === 'number' ? bVal : 0;
    return sortDir === 'desc' ? bNum - aNum : aNum - bNum;
  });

  const handleSort = (key: string) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  if (data.length === 0) return <div className="text-gray-500 text-xs text-center py-4">No data</div>;

  return (
    <div className="overflow-x-auto">
      {title && <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</h4>}
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/10">
            {cols.map((col) => (
              <th
                key={col}
                onClick={() => handleSort(col)}
                className="px-3 py-2 text-left text-gray-400 font-medium cursor-pointer hover:text-gray-200 select-none"
              >
                {COLUMN_LABELS[col] || col}
                {sortKey === col && <span className="ml-1">{sortDir === 'desc' ? '↓' : '↑'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} className="border-b border-white/5 hover:bg-white/5">
              {cols.map((col) => (
                <td key={col} className="px-3 py-2 text-gray-300 font-mono">
                  {formatCell(col, (row as unknown as Record<string, unknown>)[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
