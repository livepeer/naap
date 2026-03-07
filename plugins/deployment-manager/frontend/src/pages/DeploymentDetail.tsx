import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Trash2, ArrowUpCircle, Server, Cpu, AlertTriangle, CheckCircle, XCircle, RotateCcw } from 'lucide-react';
import { useDeployment } from '../hooks/useDeployments';
import { useHealthPolling } from '../hooks/useHealthPolling';
import { HealthIndicator } from '../components/HealthIndicator';
import { VersionBadge } from '../components/VersionBadge';
import { StatusTimeline } from '../components/StatusTimeline';
import { AuditTable } from '../components/AuditTable';
import { DeploymentLogs } from '../components/DeploymentLogs';
import { OverviewTab } from '../components/OverviewTab';
import { UsageTab } from '../components/UsageTab';
import { RequestTab } from '../components/RequestTab';
import { InferencePlayground } from '../components/InferencePlayground';

const API_BASE = '/api/v1/deployment-manager';

type TabId = 'overview' | 'usage' | 'request' | 'pipeline' | 'timeline' | 'logs' | 'health' | 'audit';

interface DeploymentDetailProps {
  deploymentId?: string;
}

export const DeploymentDetail: React.FC<DeploymentDetailProps> = ({ deploymentId: propId }) => {
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id: string }>();
  const id = propId || routeId || '';
  const { deployment, loading, refresh } = useDeployment(id);
  const { healthStatus } = useHealthPolling(id, 30000);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [newVersion, setNewVersion] = useState('');
  const [newDockerImage, setNewDockerImage] = useState('');
  const [destroying, setDestroying] = useState(false);
  const [retryingCleanup, setRetryingCleanup] = useState(false);

  const handleDestroy = async () => {
    if (!confirm('Destroy this deployment? This will delete all remote resources.')) return;
    setDestroying(true);
    try {
      const res = await fetch(`${API_BASE}/deployments/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setActiveTab('logs');
        refresh();
      }
    } catch { /* ignore */ }
    setDestroying(false);
  };

  const handleForceDestroy = async () => {
    if (!confirm('Force destroy this deployment? This will attempt to clean up all remote resources and mark it as destroyed.')) return;
    setDestroying(true);
    try {
      const res = await fetch(`${API_BASE}/deployments/${id}/force-destroy`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setActiveTab('logs');
        refresh();
      }
    } catch { /* ignore */ }
    setDestroying(false);
  };

  const handleRetryCleanup = async () => {
    setRetryingCleanup(true);
    try {
      const res = await fetch(`${API_BASE}/deployments/${id}/retry-cleanup`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setActiveTab('logs');
        refresh();
      }
    } catch { /* ignore */ }
    setRetryingCleanup(false);
  };

  const handleUpdate = async () => {
    if (!newVersion && !newDockerImage) return;
    try {
      const body: Record<string, string> = {};
      if (newVersion) body.artifactVersion = newVersion;
      if (newDockerImage) body.dockerImage = newDockerImage;

      const res = await fetch(`${API_BASE}/deployments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setShowUpdateDialog(false);
        setNewVersion('');
        setNewDockerImage('');
        refresh();
      }
    } catch { /* ignore */ }
  };

  const handleRetry = async () => {
    try {
      const res = await fetch(`${API_BASE}/deployments/${id}/retry`, { method: 'POST' });
      const data = await res.json();
      if (data.success) refresh();
    } catch { /* ignore */ }
  };

  if (loading || !deployment) {
    return (
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--dm-text-secondary)' }}>{loading ? 'Loading...' : 'Deployment not found'}</p>
      </div>
    );
  }

  const d = deployment;
  const cleanupPending = d.providerConfig?.cleanupPending === true;

  const tabStyle = (tab: TabId): React.CSSProperties => ({
    padding: '0.5rem 1rem',
    background: 'none',
    border: 'none',
    borderBottomWidth: '2px',
    borderBottomStyle: 'solid',
    borderBottomColor: activeTab === tab ? 'var(--dm-accent-blue)' : 'transparent',
    color: activeTab === tab ? 'var(--dm-accent-blue-text)' : 'var(--dm-text-secondary)',
    fontWeight: activeTab === tab ? 600 : 400,
    cursor: 'pointer',
    fontSize: '0.875rem',
  });

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem 0.75rem',
    border: '1px solid var(--dm-border-input)',
    borderRadius: '0.375rem',
    fontSize: '0.875rem',
    marginTop: '0.25rem',
    color: 'var(--dm-text-primary)',
    backgroundColor: 'var(--dm-bg-input)',
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none', border: 'none', color: 'var(--dm-text-secondary)',
            cursor: 'pointer', display: 'flex', alignItems: 'center',
            gap: '0.25rem', fontSize: '0.875rem', padding: 0, marginBottom: '1rem',
          }}
        >
          <ArrowLeft size={14} /> Back to Deployments
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <HealthIndicator status={healthStatus || d.healthStatus} size={16} />
              <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0, color: 'var(--dm-text-primary)' }}>{d.name}</h1>
            </div>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', color: 'var(--dm-text-secondary)', fontSize: '0.875rem' }}>
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
              style={{ padding: '0.4rem', background: 'var(--dm-bg-tertiary)', border: '1px solid var(--dm-border)', borderRadius: '0.375rem', cursor: 'pointer' }}
              title="Refresh"
            >
              <RefreshCw size={16} color="#374151" />
            </button>
            {d.hasUpdate && d.status === 'ONLINE' && (
              <button
                onClick={() => { setNewVersion(d.latestAvailableVersion || ''); setShowUpdateDialog(true); }}
                style={{
                  padding: '0.4rem 0.75rem', background: '#fef3c7', color: '#92400e',
                  border: '1px solid #fbbf24', borderRadius: '0.375rem', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem',
                }}
              >
                <ArrowUpCircle size={14} /> Update
              </button>
            )}
            {['ONLINE', 'DEPLOYING', 'VALIDATING'].includes(d.status) && (
              <button
                onClick={handleDestroy}
                disabled={destroying}
                style={{
                  padding: '0.4rem', background: '#fef2f2',
                  border: '1px solid #fca5a5', borderRadius: '0.375rem',
                  cursor: destroying ? 'not-allowed' : 'pointer', opacity: destroying ? 0.6 : 1,
                }}
                title="Destroy"
              >
                <Trash2 size={16} color="#dc2626" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* FAILED diagnostic banner */}
      {d.status === 'FAILED' && (
        <div style={{
          padding: '1rem', marginBottom: '1.5rem',
          background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '0.5rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <AlertTriangle size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
            <div>
              <div style={{ fontWeight: 600, color: '#dc2626', fontSize: '0.9rem', marginBottom: '0.25rem' }}>
                Deployment Failed
              </div>
              <div style={{ fontSize: '0.8rem', color: '#991b1b' }}>
                This deployment encountered an error. Choose an action below to recover.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <button
              onClick={handleRetry}
              style={{
                padding: '0.4rem 0.75rem', background: '#dbeafe', color: '#1d4ed8',
                border: '1px solid #93c5fd', borderRadius: '0.375rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem',
              }}
            >
              <RefreshCw size={14} /> Retry Deploy
            </button>
            <button
              onClick={handleForceDestroy}
              disabled={destroying}
              style={{
                padding: '0.4rem 0.75rem', background: '#fef2f2', color: '#dc2626',
                border: '1px solid #fca5a5', borderRadius: '0.375rem',
                cursor: destroying ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem',
              }}
            >
              <Trash2 size={14} /> Force Destroy
            </button>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#6b7280', lineHeight: 1.6 }}>
            <strong>Retry Deploy</strong> will attempt the deployment again from scratch.{' '}
            <strong>Force Destroy</strong> will clean up all remote resources and mark this as destroyed.
          </div>
        </div>
      )}

      {/* DESTROYED cleanup status banner */}
      {d.status === 'DESTROYED' && (
        <div style={{
          padding: '0.75rem 1rem', marginBottom: '1.5rem', borderRadius: '0.5rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: cleanupPending ? '#fffbeb' : '#f0fdf4',
          border: cleanupPending ? '1px solid #fbbf24' : '1px solid #86efac',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {cleanupPending ? (
              <>
                <XCircle size={16} color="#d97706" />
                <span style={{ fontSize: '0.8rem', color: '#92400e' }}>
                  Remote cleanup incomplete — some resources may still exist on the provider
                </span>
              </>
            ) : (
              <>
                <CheckCircle size={16} color="#16a34a" />
                <span data-testid="cleanup-badge" style={{ fontSize: '0.8rem', color: '#166534' }}>
                  Cleanly removed from remote provider
                </span>
              </>
            )}
          </div>
          {cleanupPending && (
            <button
              onClick={handleRetryCleanup}
              disabled={retryingCleanup}
              style={{
                padding: '0.3rem 0.6rem', background: '#fbbf24', color: '#78350f',
                border: 'none', borderRadius: '0.25rem', cursor: retryingCleanup ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', fontWeight: 500,
              }}
            >
              <RotateCcw size={12} /> {retryingCleanup ? 'Retrying...' : 'Retry Cleanup'}
            </button>
          )}
        </div>
      )}

      {/* Update dialog */}
      {showUpdateDialog && (
        <div style={{ padding: '1rem', background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: '0.5rem', marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: 'var(--dm-text-primary)' }}>Update Deployment</h4>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--dm-text-secondary)' }}>New Version</label>
            <input type="text" value={newVersion} onChange={(e) => setNewVersion(e.target.value)} placeholder={d.artifactVersion} style={inputStyle} />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--dm-text-secondary)' }}>Docker Image (optional override)</label>
            <input type="text" value={newDockerImage} onChange={(e) => setNewDockerImage(e.target.value)} placeholder={d.dockerImage} style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={handleUpdate} style={{ padding: '0.4rem 1rem', background: 'var(--dm-accent-blue)', color: '#fff', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontSize: '0.8rem' }}>Apply Update</button>
            <button onClick={() => setShowUpdateDialog(false)} style={{ padding: '0.4rem 1rem', background: 'var(--dm-bg-primary)', color: 'var(--dm-text-secondary)', border: '1px solid var(--dm-border-input)', borderRadius: '0.375rem', cursor: 'pointer', fontSize: '0.8rem' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Info cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <div style={{ padding: '1rem', background: 'var(--dm-bg-secondary)', borderRadius: '0.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--dm-text-tertiary)', marginBottom: '0.25rem' }}>Artifact</div>
          <div style={{ fontWeight: 600, color: 'var(--dm-text-primary)' }}>{d.artifactType}</div>
          <VersionBadge currentVersion={d.artifactVersion} latestVersion={d.latestAvailableVersion} hasUpdate={d.hasUpdate} />
        </div>
        <div style={{ padding: '1rem', background: 'var(--dm-bg-secondary)', borderRadius: '0.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--dm-text-tertiary)', marginBottom: '0.25rem' }}>Status</div>
          <div style={{ fontWeight: 600, color: 'var(--dm-text-primary)' }}>{d.status}</div>
          <HealthIndicator status={healthStatus || d.healthStatus} showLabel />
        </div>
        <div style={{ padding: '1rem', background: 'var(--dm-bg-secondary)', borderRadius: '0.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--dm-text-tertiary)', marginBottom: '0.25rem' }}>Endpoint</div>
          <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all', color: 'var(--dm-text-secondary)' }}>
            {d.endpointUrl || 'N/A'}
          </div>
          {d.sshHost && (
            <div style={{ fontSize: '0.75rem', color: 'var(--dm-text-secondary)', marginTop: '0.25rem' }}>
              SSH: {d.sshHost}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--dm-border)', marginBottom: '1.5rem', overflowX: 'auto' }}>
        <button style={tabStyle('overview')} onClick={() => setActiveTab('overview')}>Overview</button>
        <button style={tabStyle('usage')} onClick={() => setActiveTab('usage')}>Usage</button>
        <button style={tabStyle('request')} onClick={() => setActiveTab('request')}>Request</button>
        {d.templateId === 'livepeer-inference' && (
          <button style={tabStyle('pipeline')} onClick={() => setActiveTab('pipeline')}>Pipeline</button>
        )}
        <button style={tabStyle('timeline')} onClick={() => setActiveTab('timeline')}>Timeline</button>
        <button style={tabStyle('logs')} onClick={() => setActiveTab('logs')}>Logs</button>
        <button style={tabStyle('health')} onClick={() => setActiveTab('health')}>Health</button>
        <button style={tabStyle('audit')} onClick={() => setActiveTab('audit')}>Audit Log</button>
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && <OverviewTab deployment={d as any} />}
      {activeTab === 'usage' && <UsageTab deploymentId={id} />}
      {activeTab === 'request' && <RequestTab deploymentId={id} endpointUrl={d.endpointUrl} providerSlug={d.providerSlug} />}
      {activeTab === 'pipeline' && d.templateId === 'livepeer-inference' && (
        <InferencePlayground deploymentId={id} endpointUrl={d.endpointUrl} />
      )}
      {activeTab === 'timeline' && <StatusTimeline deploymentId={id} />}
      {activeTab === 'logs' && <DeploymentLogs deploymentId={id} />}
      {activeTab === 'health' && (
        <div>
          <HealthIndicator status={healthStatus || d.healthStatus} size={20} showLabel />
          <p style={{ fontSize: '0.8rem', color: 'var(--dm-text-tertiary)', marginTop: '0.5rem' }}>
            Last checked: {d.lastHealthCheck ? new Date(d.lastHealthCheck).toLocaleString() : 'Never'}
          </p>
        </div>
      )}
      {activeTab === 'audit' && <AuditTable deploymentId={id} />}
    </div>
  );
};
