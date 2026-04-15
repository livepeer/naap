import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Database, Loader2, AlertCircle, Activity, Layers } from 'lucide-react';
import { useQueries } from '../hooks/useQueries';
import { QueryCard } from '../components/QueryCard';

export const DiscoveryPage: React.FC = () => {
  const { queries, loading, error, seeding, seed, refresh } = useQueries();
  const navigate = useNavigate();

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-accent-emerald/10 text-accent-emerald rounded-xl">
            <Search size={22} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-text-primary tracking-tight">
                Discovery Queries
              </h1>
              {!loading && (
                <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-bg-tertiary text-text-muted">
                  {queries.length} quer{queries.length !== 1 ? 'ies' : 'y'}
                </span>
              )}
            </div>
            <p className="text-sm text-text-muted mt-0.5">
              Saved capability filters with stable API endpoints
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={seed}
            disabled={seeding}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-amber/20 hover:bg-accent-amber/30 text-accent-amber text-xs font-medium rounded-lg border border-accent-amber/30 transition-colors disabled:opacity-50"
            data-testid="seed-queries-btn"
          >
            {seeding ? <Loader2 size={12} className="animate-spin" /> : <Database size={12} />}
            {seeding ? 'Seeding...' : 'Seed Demo Data'}
          </button>
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary hover:bg-bg-tertiary text-text-secondary text-xs font-medium rounded-lg border border-[var(--border-color)] transition-colors"
          >
            <Activity size={12} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 glass-card p-4" style={{ borderColor: 'rgba(220, 38, 38, 0.3)', background: 'rgba(220, 38, 38, 0.05)' }}>
          <AlertCircle size={18} className="text-accent-rose shrink-0" />
          <p className="text-sm text-accent-rose">{error}</p>
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="discovery-loading">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass-card p-5 animate-pulse">
              <div className="h-5 bg-bg-tertiary rounded w-48 mb-3" />
              <div className="h-3 bg-bg-tertiary/80 rounded w-32 mb-4" />
              <div className="flex gap-2 mb-3">
                <div className="h-6 bg-bg-tertiary/80 rounded-full w-24" />
                <div className="h-6 bg-bg-tertiary/80 rounded-full w-20" />
              </div>
              <div className="h-3 bg-bg-tertiary/60 rounded w-full" />
            </div>
          ))}
        </div>
      )}

      {!loading && queries.length === 0 && !error && (
        <div className="text-center py-20" data-testid="discovery-empty">
          <div className="w-20 h-20 mx-auto mb-5 bg-bg-tertiary/50 border border-[var(--border-color)] rounded-2xl flex items-center justify-center text-text-muted">
            <Layers size={36} />
          </div>
          <h2 className="text-lg font-semibold text-text-primary mb-2">No Discovery Queries Yet</h2>
          <p className="text-sm text-text-secondary max-w-md mx-auto mb-4">
            Discovery queries let you save capability filters and access results via a stable API endpoint without passing parameters each time.
          </p>
          <button
            onClick={seed}
            disabled={seeding}
            className="px-4 py-2 bg-accent-amber/20 hover:bg-accent-amber/30 text-accent-amber text-sm font-medium rounded-lg border border-accent-amber/30 transition-colors disabled:opacity-50"
          >
            {seeding ? 'Seeding...' : 'Seed Demo Data to Get Started'}
          </button>
        </div>
      )}

      {!loading && queries.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="discovery-grid">
          {queries.map(({ query, results, resultsLoading }) => (
            <QueryCard
              key={query.id}
              query={query}
              results={results}
              resultsLoading={resultsLoading}
              onClick={(id) => navigate(`/queries/${id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
