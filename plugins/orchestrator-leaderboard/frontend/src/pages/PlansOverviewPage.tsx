import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Map, Layers, Activity, Users, Loader2, Database, AlertCircle,
  ChevronRight, Clock, Power, PowerOff,
} from 'lucide-react';
import { usePlans } from '../hooks/usePlans';
import { EndpointGuide } from '../components/EndpointGuide';

export const PlansOverviewPage: React.FC = () => {
  const { plans, loading, error, seeding, seed, refresh } = usePlans();
  const navigate = useNavigate();

  const stats = useMemo(() => {
    const totalPlans = plans.length;
    const allCaps = new Set<string>();
    let totalOrchestrators = 0;
    for (const { plan, results } of plans) {
      for (const c of plan.capabilities) allCaps.add(c);
      if (results) totalOrchestrators += results.meta.totalOrchestrators;
    }
    return { totalPlans, totalCapabilities: allCaps.size, totalOrchestrators };
  }, [plans]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-accent-blue/10 text-accent-blue rounded-xl">
            <Map size={22} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-text-primary tracking-tight">
                Discovery Plans
              </h1>
              {!loading && (
                <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-bg-tertiary text-text-muted">
                  {stats.totalPlans} plan{stats.totalPlans !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <p className="text-sm text-text-muted mt-0.5">
              Pre-configured orchestrator selection for signer webhooks
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={seed}
            disabled={seeding}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-amber/20 hover:bg-accent-amber/30 text-accent-amber text-xs font-medium rounded-lg border border-accent-amber/30 transition-colors disabled:opacity-50"
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

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 glass-card p-4" style={{ borderColor: 'rgba(220, 38, 38, 0.3)', background: 'rgba(220, 38, 38, 0.05)' }}>
          <AlertCircle size={18} className="text-accent-rose shrink-0" />
          <p className="text-sm text-accent-rose">{error}</p>
        </div>
      )}

      {/* Summary Stats */}
      {!loading && plans.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="stat-card">
            <div className="flex items-center gap-2 text-text-muted mb-2">
              <Layers size={16} />
              <span className="text-[11px] font-medium uppercase tracking-wider">Plans</span>
            </div>
            <div className="text-xl font-bold text-accent-blue">{stats.totalPlans}</div>
          </div>
          <div className="stat-card">
            <div className="flex items-center gap-2 text-text-muted mb-2">
              <Activity size={16} />
              <span className="text-[11px] font-medium uppercase tracking-wider">Capabilities</span>
            </div>
            <div className="text-xl font-bold text-accent-blue">{stats.totalCapabilities}</div>
          </div>
          <div className="stat-card">
            <div className="flex items-center gap-2 text-text-muted mb-2">
              <Users size={16} />
              <span className="text-[11px] font-medium uppercase tracking-wider">Orchestrators</span>
            </div>
            <div className="text-xl font-bold text-accent-emerald">{stats.totalOrchestrators}</div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

      {/* Empty state */}
      {!loading && plans.length === 0 && !error && (
        <div className="text-center py-20">
          <div className="w-20 h-20 mx-auto mb-5 bg-bg-tertiary/50 border border-[var(--border-color)] rounded-2xl flex items-center justify-center text-text-muted">
            <Map size={36} />
          </div>
          <h2 className="text-lg font-semibold text-text-primary mb-2">No Discovery Plans Yet</h2>
          <p className="text-sm text-text-secondary max-w-md mx-auto mb-4">
            Discovery plans let you pre-configure orchestrator selection criteria and expose them as webhook endpoints for your signer.
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

      {/* Plan Cards Grid */}
      {!loading && plans.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plans.map(({ plan, results, resultsLoading }) => (
            <div
              key={plan.id}
              className="plan-card group"
              onClick={() => navigate(`/plans/${plan.id}`)}
            >
              {/* Card Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-text-primary truncate group-hover:text-accent-blue transition-colors">
                      {plan.name}
                    </h3>
                    {plan.enabled ? (
                      <Power size={12} className="text-accent-emerald shrink-0" />
                    ) : (
                      <PowerOff size={12} className="text-text-disabled shrink-0" />
                    )}
                  </div>
                  <p className="text-[11px] text-text-muted font-mono truncate mt-0.5">
                    {plan.billingPlanId}
                  </p>
                </div>
                <ChevronRight size={16} className="text-text-disabled group-hover:text-accent-blue shrink-0 mt-1 transition-colors" />
              </div>

              {/* Capabilities */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {plan.capabilities.map((c) => (
                  <span key={c} className="pill-btn pill-btn-inactive text-[10px] px-2 py-0.5 cursor-default">
                    {c}
                  </span>
                ))}
              </div>

              {/* Metrics Row */}
              <div className="flex items-center gap-3 text-[11px] text-text-muted mb-3">
                <span>Top {plan.topN}</span>
                <span className="text-text-disabled">|</span>
                {plan.slaMinScore != null && (
                  <>
                    <span>SLA &ge; {plan.slaMinScore}</span>
                    <span className="text-text-disabled">|</span>
                  </>
                )}
                {plan.sortBy && (
                  <>
                    <span>Sort: {plan.sortBy}</span>
                    <span className="text-text-disabled">|</span>
                  </>
                )}
                {resultsLoading ? (
                  <span className="flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin" /> Loading...
                  </span>
                ) : results ? (
                  <span className="text-accent-emerald font-medium">
                    {results.meta.totalOrchestrators} orchestrator{results.meta.totalOrchestrators !== 1 ? 's' : ''}
                  </span>
                ) : null}
              </div>

              {/* Owner & Timestamp */}
              <div className="flex items-center gap-3 text-[10px] text-text-muted mb-3">
                {plan.ownerUserId && (
                  <span className="truncate max-w-[120px]" title={plan.ownerUserId}>
                    Owner: {plan.ownerUserId.slice(0, 8)}...
                  </span>
                )}
                {plan.teamId && (
                  <span className="truncate max-w-[120px]" title={plan.teamId}>
                    Team: {plan.teamId.slice(0, 8)}...
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1">
                  <Clock size={10} />
                  {new Date(plan.updatedAt).toLocaleDateString()}
                </span>
              </div>

              {/* Endpoint Guide */}
              <div className="border-t border-[var(--border-color)] pt-3">
                <EndpointGuide planId={plan.id} compact />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
