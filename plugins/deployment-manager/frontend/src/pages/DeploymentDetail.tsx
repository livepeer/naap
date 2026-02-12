import React, { useState } from 'react';
import { ArrowLeft, RefreshCw, Trash2, ArrowUpCircle, Server, Cpu } from 'lucide-react';
import { useDeployment } from '../hooks/useDeployments';
import { useHealthPolling } from '../hooks/useHealthPolling';
import { HealthIndicator } from '../components/HealthIndicator';
import { VersionBadge } from '../components/VersionBadge';
import { StatusTimeline } from '../components/StatusTimeline';
import { AuditTable } from '../components/AuditTable';

const API_BASE = '/api/v1/deployment-manager';

interface DeploymentDetailProps {
  deploymentId?: string;
}

export const DeploymentDetail: React.FC<DeploymentDetailProps> = ({ deploymentId: propId }) => {
  const id = propId || window.location.pathname.split('/').pop() || '';
  const { deployment, loading, refresh } = useDeployment(id);
  const { healthStatus } = useHealthPolling(id, 30000);
  const [activeTab, setActiveTab] = useState<'timeline' | 'health' | 'audit'>('timeline');

  const handleAction = async (action: string) => {
    try {
      const res = await fetch(`${API_BASE}/deployments/${id}/${action}`, { method: action === 'destroy' ? 'DELETE' : 'POST' });
      const data = await res.json();
      if (data.success) refresh();
    } catch {
      // ignore
    }
  };

  if (loading || !deployment) {
    return (
      <div style={{ padding: '2rem' }}>
        <p style={{ color: '#6b7280' }}>{loading ? 'Loading...' : 'Deployment not found'}</p>
      </div>
    );
  }

  const d = deployment;

  const tabStyle = (tab: string): React.CSSProperties => ({
    padding: '0.5rem 1rem',
    borderBottom: activeTab === tab ? '2px solid #3b82f6' : '2px solid transparent',
    background: 'none',
    border: 'none',
    borderBottomWidth: '2px',
    borderBottomStyle: 'solid',
    borderBottomColor: activeTab === tab ? '#3b82f6' : 'transparent',
    color: activeTab === tab ? '#1d4ed8' : '#6b7280',
    fontWeight: activeTab === tab ? 600 : 400,
    cursor: 'pointer',
    fontSize: '0.875rem',
  });

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('naap:navigate', { detail: '/deployments' }))}
          style={{
            background: 'none',
            border: 'none',
            color: '#6b7280',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
            fontSize: '0.875rem',
            padding: 0,
            marginBottom: '1rem',
          }}
        >
          <ArrowLeft size={14} /> Back to Deployments
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <HealthIndicator status={healthStatus || d.healthStatus} size={16} />
              <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>{d.name}</h1>
            </div>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', color: '#6b7280', fontSize: '0.875rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Server size={14} /> {d.providerSlug}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Cpu size={14} /> {d.gpuModel} ({d.gpuVramGb}GB) x{d.gpuCount}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={refresh}
              style={{ padding: '0.4rem', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '0.375rem', cursor: 'pointer' }}
              title="Refresh"
            >
              <RefreshCw size={16} />
            </button>
            {d.hasUpdate && (
              <button
                onClick={() => handleAction('update')}
                style={{
                  padding: '0.4rem 0.75rem',
                  background: '#fef3c7',
                  border: '1px solid #fbbf24',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  fontSize: '0.8rem',
                }}
              >
                <ArrowUpCircle size={14} /> Update
              </button>
            )}
            {['ONLINE', 'DEGRADED', 'OFFLINE', 'FAILED'].includes(d.status) && (
              <button
                onClick={() => { if (confirm('Destroy this deployment?')) handleAction(''); }}
                style={{
                  padding: '0.4rem',
                  background: '#fef2f2',
                  border: '1px solid #fca5a5',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                }}
                title="Destroy"
              >
                <Trash2 size={16} color="#dc2626" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Info cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <div style={{ padding: '1rem', background: '#f9fafb', borderRadius: '0.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' }}>Artifact</div>
          <div style={{ fontWeight: 600 }}>{d.artifactType}</div>
          <VersionBadge currentVersion={d.artifactVersion} latestVersion={d.latestAvailableVersion} hasUpdate={d.hasUpdate} />
        </div>
        <div style={{ padding: '1rem', background: '#f9fafb', borderRadius: '0.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' }}>Status</div>
          <div style={{ fontWeight: 600 }}>{d.status}</div>
          <HealthIndicator status={healthStatus || d.healthStatus} showLabel />
        </div>
        <div style={{ padding: '1rem', background: '#f9fafb', borderRadius: '0.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' }}>Endpoint</div>
          <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
            {d.endpointUrl || 'N/A'}
          </div>
          {d.sshHost && (
            <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
              SSH: {d.sshHost}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid #e5e7eb', marginBottom: '1.5rem' }}>
        <button style={tabStyle('timeline')} onClick={() => setActiveTab('timeline')}>Timeline</button>
        <button style={tabStyle('health')} onClick={() => setActiveTab('health')}>Health</button>
        <button style={tabStyle('audit')} onClick={() => setActiveTab('audit')}>Audit Log</button>
      </div>

      {/* Tab content */}
      {activeTab === 'timeline' && <StatusTimeline deploymentId={id} />}
      {activeTab === 'health' && (
        <div>
          <HealthIndicator status={healthStatus || d.healthStatus} size={20} showLabel />
          <p style={{ fontSize: '0.8rem', color: '#9ca3af', marginTop: '0.5rem' }}>
            Last checked: {d.lastHealthCheck ? new Date(d.lastHealthCheck).toLocaleString() : 'Never'}
          </p>
        </div>
      )}
      {activeTab === 'audit' && <AuditTable deploymentId={id} />}
    </div>
  );
};
