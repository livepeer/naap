import React from 'react';
import type { CapabilityQueryRecord, CapabilityConnection } from '../lib/types';
import { ChevronRight, Clock, Loader2, Filter, SortAsc } from 'lucide-react';
import { CategoryBadge } from './CategoryBadge';

interface QueryCardProps {
  query: CapabilityQueryRecord;
  results: CapabilityConnection | null;
  resultsLoading: boolean;
  onClick: (id: string) => void;
}

export const QueryCard: React.FC<QueryCardProps> = ({ query, results, resultsLoading, onClick }) => {
  const filterSummary: string[] = [];
  if (query.category) filterSummary.push(`Category: ${query.category}`);
  if (query.search) filterSummary.push(`Search: "${query.search}"`);
  if (query.minGpuCount) filterSummary.push(`GPU ≥ ${query.minGpuCount}`);
  if (query.maxPriceUsd) filterSummary.push(`Price ≤ $${query.maxPriceUsd}`);
  if (query.minCapacity) filterSummary.push(`Cap ≥ ${query.minCapacity}`);

  return (
    <button
      type="button"
      className="glass-card p-5 cursor-pointer group hover:border-accent-emerald/30 transition-all text-left w-full"
      onClick={() => onClick(query.id)}
      data-testid={`query-card-${query.slug}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-text-primary truncate group-hover:text-accent-emerald transition-colors">
              {query.name}
            </h3>
            {query.category && <CategoryBadge category={query.category as never} />}
          </div>
          <p className="text-[11px] text-text-muted font-mono truncate mt-0.5">
            {query.slug}
          </p>
        </div>
        <ChevronRight size={16} className="text-text-disabled group-hover:text-accent-emerald shrink-0 mt-1 transition-colors" />
      </div>

      {filterSummary.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {filterSummary.map((f) => (
            <span key={f} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-bg-tertiary text-text-muted">
              <Filter size={8} />
              {f}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px] text-text-muted mb-3">
        {query.sortBy && (
          <>
            <span className="flex items-center gap-1">
              <SortAsc size={10} />
              Sort: {query.sortBy} ({query.sortOrder || 'asc'})
            </span>
            <span className="text-text-disabled">|</span>
          </>
        )}
        <span>Limit: {query.limit}</span>
        <span className="text-text-disabled">|</span>
        {resultsLoading ? (
          <span className="flex items-center gap-1">
            <Loader2 size={10} className="animate-spin" /> Loading...
          </span>
        ) : results ? (
          <span className="text-accent-emerald font-medium">
            {results.total} result{results.total !== 1 ? 's' : ''}
          </span>
        ) : (
          <span className="text-text-disabled">No results</span>
        )}
      </div>

      <div className="flex items-center text-[10px] text-text-muted">
        <span className="flex items-center gap-1">
          <Clock size={10} />
          Updated {new Date(query.updatedAt).toLocaleDateString()}
        </span>
      </div>

      <div className="border-t border-[var(--border-color)] pt-3 mt-3">
        <div className="text-[10px] text-text-muted font-mono truncate">
          GET /api/v1/capability-explorer/queries/{query.id}/results
        </div>
      </div>
    </button>
  );
};
