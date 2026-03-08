import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket, Plus, Server, Cpu, RefreshCw, Filter, AlertTriangle, CheckCircle } from 'lucide-react';
import { useDeployments } from '../hooks/useDeployments';
import { HealthIndicator } from '../components/HealthIndicator';
import { VersionBadge } from '../components/VersionBadge';

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-zinc-400',
  DEPLOYING: 'bg-blue-500',
  VALIDATING: 'bg-violet-500',
  ONLINE: 'bg-emerald-500',
  UPDATING: 'bg-blue-500',
  FAILED: 'bg-red-500',
  DESTROYED: 'bg-zinc-500',
};

const STATUS_FILTERS = [
  { value: 'ACTIVE', label: 'Active', statuses: ['ONLINE', 'DEPLOYING', 'VALIDATING', 'UPDATING', 'PENDING'] },
  { value: 'ALL', label: 'All' },
  { value: 'ONLINE', label: 'Online' },
  { value: 'DEPLOYING', label: 'Deploying', statuses: ['DEPLOYING', 'VALIDATING', 'PENDING'] },
  { value: 'FAILED', label: 'Failed' },
  { value: 'DESTROYED', label: 'Destroyed' },
];

export const DeploymentList: React.FC = () => {
  const navigate = useNavigate();
  const { deployments, loading, error, refresh } = useDeployments();
  const [statusFilter, setStatusFilter] = useState('ACTIVE');

  const filtered = useMemo(() => {
    if (statusFilter === 'ALL') return deployments;
    const filterDef = STATUS_FILTERS.find((f) => f.value === statusFilter);
    const matchStatuses = filterDef?.statuses || [statusFilter];
    return deployments.filter((d) => matchStatuses.includes(d.status));
  }, [deployments, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of deployments) {
      counts[d.status] = (counts[d.status] || 0) + 1;
    }
    return counts;
  }, [deployments]);

  return (
    <div className="font-sans px-6 py-5 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <Rocket size={20} className="text-foreground" />
          <h1 className="text-xl font-semibold text-foreground m-0 tracking-tight">
            Deployments
          </h1>
          {deployments.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {filtered.length}{statusFilter !== 'ALL' ? ` of ${deployments.length}` : ''}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            className="h-9 px-3 bg-secondary text-secondary-foreground border border-border rounded-md text-sm font-medium flex items-center gap-1.5 cursor-pointer hover:bg-muted transition-colors"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            onClick={() => navigate('/new')}
            className="h-9 px-4 bg-foreground text-background border-none rounded-md text-sm font-medium flex items-center gap-1.5 cursor-pointer hover:opacity-90 transition-opacity"
          >
            <Plus size={14} /> New Deployment
          </button>
        </div>
      </div>

      {/* Status filters */}
      {deployments.length > 0 && (
        <div className="flex gap-1.5 mb-5 flex-wrap">
          {STATUS_FILTERS.map((f) => {
            const isActive = statusFilter === f.value;
            const matchStatuses = f.statuses || (f.value === 'ALL' ? undefined : [f.value]);
            const count = matchStatuses
              ? matchStatuses.reduce((sum, s) => sum + (statusCounts[s] || 0), 0)
              : deployments.length;
            if (count === 0 && f.value !== 'ALL' && f.value !== 'ACTIVE') return null;
            return (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={`h-7 px-3 rounded-full text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-foreground text-background border-[1.5px] border-foreground'
                    : 'bg-transparent text-muted-foreground border border-border hover:bg-muted/60'
                }`}
              >
                {f.label}
                <span className="opacity-60 text-[11px]">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Loading / Error */}
      {loading && <p className="text-muted-foreground text-sm">Loading deployments...</p>}
      {error && <p className="text-red-500 text-sm">Error: {error}</p>}

      {/* Empty state */}
      {!loading && deployments.length === 0 && (
        <div className="py-20 border border-dashed border-border rounded-lg text-center">
          <Rocket size={36} className="text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-foreground font-medium text-sm mb-1">No deployments yet</p>
          <p className="text-muted-foreground text-xs">Choose a template and deploy to a GPU provider to get started.</p>
        </div>
      )}

      {/* Filter empty */}
      {!loading && deployments.length > 0 && filtered.length === 0 && (
        <div className="py-16 border border-dashed border-border rounded-lg text-center">
          <Filter size={24} className="text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-foreground text-sm mb-1">No {statusFilter.toLowerCase()} deployments</p>
          <button
            onClick={() => setStatusFilter('ALL')}
            className="bg-transparent border-none text-dm-blue cursor-pointer text-xs hover:underline"
          >Show all deployments</button>
        </div>
      )}

      {/* Deployment list */}
      {filtered.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
          {filtered.map((d) => (
            <div
              key={d.id}
              onClick={() => navigate(`/${d.id}`)}
              className="flex justify-between items-center px-4 py-3 bg-card cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <HealthIndicator status={d.healthStatus} size={8} />
                <div className="min-w-0">
                  <div className="font-medium text-sm text-foreground truncate">
                    {d.name}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                    <Server size={11} className="shrink-0" />
                    <span>{d.providerSlug}</span>
                    <span className="mx-1 opacity-40">&middot;</span>
                    <Cpu size={11} className="shrink-0" />
                    <span>{d.gpuModel} {d.gpuVramGb}GB</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <VersionBadge
                  currentVersion={d.artifactVersion}
                  latestVersion={d.latestAvailableVersion}
                  hasUpdate={d.hasUpdate}
                />
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-semibold text-white leading-none ${STATUS_COLORS[d.status] || 'bg-zinc-400'}`}
                >
                  {d.status}
                </span>
                {d.status === 'FAILED' && (
                  <span className="flex items-center gap-1 text-[11px] text-red-500 font-medium">
                    <AlertTriangle size={11} /> Action needed
                  </span>
                )}
                {d.status === 'DESTROYED' && (
                  (d as any).providerConfig?.cleanupPending
                    ? <span title="Remote cleanup incomplete"><AlertTriangle size={12} className="text-amber-500" /></span>
                    : <span title="Cleanly removed"><CheckCircle size={12} className="text-emerald-500" /></span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
