import React from 'react';
import { Rocket, Plus, Server, Cpu } from 'lucide-react';
import { useDeployments } from '../hooks/useDeployments';
import { HealthIndicator } from '../components/HealthIndicator';
import { VersionBadge } from '../components/VersionBadge';

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#9ca3af',
  PROVISIONING: '#3b82f6',
  DEPLOYING: '#3b82f6',
  VALIDATING: '#8b5cf6',
  ONLINE: '#22c55e',
  DEGRADED: '#f59e0b',
  OFFLINE: '#ef4444',
  UPDATING: '#3b82f6',
  FAILED: '#ef4444',
  DESTROYING: '#9ca3af',
  DESTROYED: '#6b7280',
};

export const DeploymentList: React.FC = () => {
  const { deployments, loading, error, refresh } = useDeployments();

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Rocket size={28} />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Deployments</h1>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={refresh}
            style={{
              padding: '0.5rem 1rem',
              background: '#f3f4f6',
              border: '1px solid #e5e7eb',
              borderRadius: '0.375rem',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            Refresh
          </button>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('naap:navigate', { detail: '/deployments/new' }))}
            style={{
              padding: '0.5rem 1rem',
              background: '#3b82f6',
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

      {loading && <p style={{ color: '#6b7280' }}>Loading deployments...</p>}
      {error && <p style={{ color: '#ef4444' }}>Error: {error}</p>}

      {!loading && deployments.length === 0 && (
        <div style={{
          padding: '4rem',
          border: '1px dashed #d1d5db',
          borderRadius: '0.75rem',
          textAlign: 'center',
          color: '#9ca3af',
        }}>
          <Rocket size={48} style={{ marginBottom: '1rem', opacity: 0.3 }} />
          <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>No deployments yet</p>
          <p style={{ fontSize: '0.875rem' }}>Deploy AI Runner or Scope to a GPU provider to get started.</p>
        </div>
      )}

      {deployments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {deployments.map((d) => (
            <div
              key={d.id}
              onClick={() => window.dispatchEvent(new CustomEvent('naap:navigate', { detail: `/deployments/${d.id}` }))}
              style={{
                padding: '1.25rem',
                border: '1px solid #e5e7eb',
                borderRadius: '0.75rem',
                background: '#fff',
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
                    <div style={{ fontWeight: 600, fontSize: '1rem' }}>{d.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.25rem' }}>
                      <span style={{ fontSize: '0.8rem', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Server size={12} /> {d.providerSlug}
                      </span>
                      <span style={{ fontSize: '0.8rem', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Cpu size={12} /> {d.gpuModel} ({d.gpuVramGb}GB)
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
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
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
