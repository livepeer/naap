import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket, Plus, Server, Cpu, RefreshCw, Filter, AlertTriangle, CheckCircle } from 'lucide-react';
import { useDeployments } from '../hooks/useDeployments';
import { HealthIndicator } from '../components/HealthIndicator';
import { VersionBadge } from '../components/VersionBadge';

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#9ca3af',
  DEPLOYING: '#3b82f6',
  VALIDATING: '#8b5cf6',
  ONLINE: '#22c55e',
  UPDATING: '#3b82f6',
  FAILED: '#ef4444',
  DESTROYED: '#6b7280',
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
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Rocket size={28} />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0, color: 'var(--dm-text-primary)' }}>Deployments</h1>
          {deployments.length > 0 && (
            <span style={{ fontSize: '0.8rem', color: 'var(--dm-text-tertiary)', marginLeft: '0.25rem' }}>
              ({filtered.length}{statusFilter !== 'ALL' ? ` of ${deployments.length}` : ''})
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={refresh}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--dm-bg-tertiary)',
              color: 'var(--dm-text-secondary)',
              border: '1px solid var(--dm-border)',
              borderRadius: '0.375rem',
              cursor: 'pointer',
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            onClick={() => navigate('/new')}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--dm-accent-blue)',
              color: '#fff',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.875rem',
            }}
          >
            <Plus size={16} /> New Deployment
          </button>
        </div>
      </div>

      {deployments.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
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
                style={{
                  padding: '0.3rem 0.75rem',
                  borderRadius: '1rem',
                  fontSize: '0.78rem',
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  border: isActive ? '1.5px solid var(--dm-accent-blue)' : '1px solid var(--dm-border)',
                  background: isActive ? 'var(--dm-accent-blue)' : 'var(--dm-bg-secondary)',
                  color: isActive ? '#fff' : 'var(--dm-text-secondary)',
                  transition: 'all 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
              >
                {f.value !== 'ALL' && f.value !== 'ACTIVE' && f.value !== 'DEPLOYING' && (
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: STATUS_COLORS[f.value] || '#9ca3af',
                    display: 'inline-block',
                  }} />
                )}
                {f.label}
                <span style={{
                  fontSize: '0.7rem',
                  opacity: 0.75,
                  marginLeft: '0.1rem',
                }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {loading && <p style={{ color: 'var(--dm-text-secondary)' }}>Loading deployments...</p>}
      {error && <p style={{ color: '#ef4444' }}>Error: {error}</p>}

      {!loading && deployments.length === 0 && (
        <div style={{
          padding: '4rem',
          border: '1px dashed var(--dm-border-input)',
          borderRadius: '0.75rem',
          textAlign: 'center',
          color: 'var(--dm-text-tertiary)',
        }}>
          <Rocket size={48} style={{ marginBottom: '1rem', opacity: 0.3 }} />
          <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>No deployments yet</p>
          <p style={{ fontSize: '0.875rem' }}>Choose a template and deploy to a GPU provider to get started.</p>
        </div>
      )}

      {!loading && deployments.length > 0 && filtered.length === 0 && (
        <div style={{
          padding: '3rem',
          border: '1px dashed var(--dm-border-input)',
          borderRadius: '0.75rem',
          textAlign: 'center',
          color: 'var(--dm-text-tertiary)',
        }}>
          <Filter size={32} style={{ marginBottom: '0.75rem', opacity: 0.3 }} />
          <p style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>No {statusFilter.toLowerCase()} deployments</p>
          <p style={{ fontSize: '0.8rem' }}>
            <button onClick={() => setStatusFilter('ALL')} style={{
              background: 'none', border: 'none', color: 'var(--dm-accent-blue)',
              cursor: 'pointer', textDecoration: 'underline', fontSize: '0.8rem',
            }}>Show all deployments</button>
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filtered.map((d) => (
            <div
              key={d.id}
              onClick={() => navigate(`/${d.id}`)}
              style={{
                padding: '1.25rem',
                border: '1px solid var(--dm-border)',
                borderRadius: '0.75rem',
                background: 'var(--dm-bg-primary)',
                cursor: 'pointer',
                transition: 'box-shadow 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)')}
              onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <HealthIndicator status={d.healthStatus} size={14} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--dm-text-primary)' }}>{d.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.25rem' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--dm-text-secondary)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Server size={12} /> {d.providerSlug}
                      </span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--dm-text-secondary)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Cpu size={12} /> {d.gpuModel} ({d.gpuVramGb}GB)
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <VersionBadge
                    currentVersion={d.artifactVersion}
                    latestVersion={d.latestAvailableVersion}
                    hasUpdate={d.hasUpdate}
                  />
                  <span style={{
                    padding: '0.2rem 0.6rem',
                    borderRadius: '1rem',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: '#fff',
                    background: STATUS_COLORS[d.status] || '#9ca3af',
                  }}>
                    {d.status}
                  </span>
                  {d.status === 'FAILED' && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.65rem', color: '#dc2626' }}>
                      <AlertTriangle size={11} /> Action required
                    </span>
                  )}
                  {d.status === 'DESTROYED' && (
                    (d as any).providerConfig?.cleanupPending
                      ? <AlertTriangle size={12} color="#d97706" title="Remote cleanup incomplete" />
                      : <CheckCircle size={12} color="#16a34a" title="Cleanly removed" />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
