import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Map, Layers, Activity, Users, Loader2, Database, AlertCircle,
  ChevronRight, Clock, Power, PowerOff,
} from 'lucide-react';
import { usePlans } from '../hooks/usePlans';
import { EndpointGuide } from '../components/EndpointGuide';

const isLocalhost = typeof window !== 'undefined' && window.location.hostname === 'localhost';

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
          <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-xl">
            <Map size={22} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-100 tracking-tight">
                Discovery Plans
              </h1>
              {!loading && (
                <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-gray-700/50 text-gray-400">
                  {stats.totalPlans} plan{stats.totalPlans !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-400 mt-0.5">
              Pre-configured orchestrator selection for signer webhooks
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isLocalhost && (
            <button
              onClick={seed}
              disabled={seeding}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 text-xs font-medium rounded-lg border border-amber-500/30 transition-colors disabled:opacity-50"
            >
              {seeding ? <Loader2 size={12} className="animate-spin" /> : <Database size={12} />}
              {seeding ? 'Seeding...' : 'Seed Demo Data'}
            </button>
          )}
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium rounded-lg border border-gray-700 transition-colors"
          >
            <Activity size={12} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 panel p-4 border-red-500/30 bg-red-500/5">
          <AlertCircle size={18} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Summary Stats */}
      {!loading && plans.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="stat-card">
            <div className="flex items-center gap-2 text-gray-500 mb-2">
              <Layers size={16} />
              <span className="text-[11px] font-medium uppercase tracking-wider">Plans</span>
            </div>
            <div className="text-xl font-bold text-indigo-400">{stats.totalPlans}</div>
          </div>
          <div className="stat-card">
            <div className="flex items-center gap-2 text-gray-500 mb-2">
              <Activity size={16} />
              <span className="text-[11px] font-medium uppercase tracking-wider">Capabilities</span>
            </div>
            <div className="text-xl font-bold text-blue-400">{stats.totalCapabilities}</div>
          </div>
          <div className="stat-card">
            <div className="flex items-center gap-2 text-gray-500 mb-2">
              <Users size={16} />
              <span className="text-[11px] font-medium uppercase tracking-wider">Orchestrators</span>
            </div>
            <div className="text-xl font-bold text-emerald-400">{stats.totalOrchestrators}</div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="panel p-5 animate-pulse">
              <div className="h-5 bg-gray-700/50 rounded w-48 mb-3" />
              <div className="h-3 bg-gray-700/40 rounded w-32 mb-4" />
              <div className="flex gap-2 mb-3">
                <div className="h-6 bg-gray-700/40 rounded-full w-24" />
                <div className="h-6 bg-gray-700/40 rounded-full w-20" />
              </div>
              <div className="h-3 bg-gray-700/30 rounded w-full" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && plans.length === 0 && !error && (
        <div className="text-center py-20">
          <div className="w-20 h-20 mx-auto mb-5 bg-gray-800/80 border border-gray-700/60 rounded-2xl flex items-center justify-center text-gray-500">
            <Map size={36} />
          </div>
          <h2 className="text-lg font-semibold text-gray-200 mb-2">No Discovery Plans Yet</h2>
          <p className="text-sm text-gray-400 max-w-md mx-auto mb-4">
            Discovery plans let you pre-configure orchestrator selection criteria and expose them as webhook endpoints for your signer.
          </p>
          {isLocalhost && (
            <button
              onClick={seed}
              disabled={seeding}
              className="px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 text-sm font-medium rounded-lg border border-amber-500/30 transition-colors disabled:opacity-50"
            >
              {seeding ? 'Seeding...' : 'Seed Demo Data to Get Started'}
            </button>
          )}
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
                    <h3 className="text-base font-semibold text-gray-100 truncate group-hover:text-blue-400 transition-colors">
                      {plan.name}
                    </h3>
                    {plan.enabled ? (
                      <Power size={12} className="text-emerald-400 shrink-0" />
                    ) : (
                      <PowerOff size={12} className="text-gray-600 shrink-0" />
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 font-mono truncate mt-0.5">
                    {plan.billingPlanId}
                  </p>
                </div>
                <ChevronRight size={16} className="text-gray-600 group-hover:text-blue-400 shrink-0 mt-1 transition-colors" />
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
              <div className="flex items-center gap-3 text-[11px] text-gray-400 mb-3">
                <span>Top {plan.topN}</span>
                <span className="text-gray-700">|</span>
                {plan.slaMinScore != null && (
                  <>
                    <span>SLA &ge; {plan.slaMinScore}</span>
                    <span className="text-gray-700">|</span>
                  </>
                )}
                {plan.sortBy && (
                  <>
                    <span>Sort: {plan.sortBy}</span>
                    <span className="text-gray-700">|</span>
                  </>
                )}
                {resultsLoading ? (
                  <span className="flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin" /> Loading...
                  </span>
                ) : results ? (
                  <span className="text-emerald-400 font-medium">
                    {results.meta.totalOrchestrators} orchestrator{results.meta.totalOrchestrators !== 1 ? 's' : ''}
                  </span>
                ) : null}
              </div>

              {/* Owner & Timestamp */}
              <div className="flex items-center gap-3 text-[10px] text-gray-500 mb-3">
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
              <div className="border-t border-gray-700/40 pt-3">
                <EndpointGuide planId={plan.id} compact />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
