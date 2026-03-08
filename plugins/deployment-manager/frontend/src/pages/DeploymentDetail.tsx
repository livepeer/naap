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
  const { healthStatus, healthDetails } = useHealthPolling(id, 30000);
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
      <div className="px-6 py-5">
        <p className="text-muted-foreground text-sm">{loading ? 'Loading...' : 'Deployment not found'}</p>
      </div>
    );
  }

  const d = deployment;
  const cleanupPending = d.providerConfig?.cleanupPending === true;

  const tabStyle = (tab: TabId): string =>
    activeTab === tab
      ? 'px-4 py-2 bg-transparent border-none border-b-2 border-foreground text-foreground font-medium text-sm cursor-pointer'
      : 'px-4 py-2 bg-transparent border-none border-b-2 border-transparent text-muted-foreground text-sm cursor-pointer hover:text-foreground transition-colors';

  return (
    <div className="px-6 py-5 max-w-[1000px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/')}
          className="bg-transparent border-none text-muted-foreground cursor-pointer flex items-center gap-1 text-sm p-0 mb-4 hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} /> Back to Deployments
        </button>
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-3">
              <HealthIndicator status={healthStatus || d.healthStatus} size={12} />
              <h1 className="text-xl font-semibold m-0 text-foreground tracking-tight">{d.name}</h1>
            </div>
            <div className="flex gap-4 mt-2 text-muted-foreground text-xs">
              <span className="flex items-center gap-1">
                <Server size={12} /> {d.providerSlug}
              </span>
              <span className="flex items-center gap-1">
                <Cpu size={12} /> {d.gpuModel} ({d.gpuVramGb}GB) x{d.gpuCount}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={refresh}
              className="h-8 w-8 flex items-center justify-center bg-secondary border border-border rounded-md cursor-pointer hover:bg-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw size={14} className="text-muted-foreground" />
            </button>
            {d.hasUpdate && d.status === 'ONLINE' && (
              <button
                onClick={() => { setNewVersion(d.latestAvailableVersion || ''); setShowUpdateDialog(true); }}
                className="h-8 px-3 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800 rounded-md cursor-pointer flex items-center gap-1.5 text-xs font-medium"
              >
                <ArrowUpCircle size={14} /> Update
              </button>
            )}
            {!['DESTROYED', 'DESTROYING'].includes(d.status) && (
              <button
                onClick={handleDestroy}
                disabled={destroying}
                className={`h-8 w-8 flex items-center justify-center bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-md ${destroying ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                title="Destroy"
              >
                <Trash2 size={14} className="text-red-500" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* FAILED diagnostic banner */}
      {d.status === 'FAILED' && (
        <div className="p-4 mb-6 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-start gap-3 mb-3">
            <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-red-600 dark:text-red-400 text-sm">
                Deployment Failed
              </div>
              <div className="text-xs text-red-700/70 dark:text-red-300/70 mt-0.5">
                This deployment encountered an error. Choose an action below to recover.
              </div>
            </div>
          </div>
          <div className="flex gap-2 ml-7">
            <button
              onClick={handleRetry}
              className="h-8 px-3 bg-card text-foreground border border-border rounded-md cursor-pointer flex items-center gap-1.5 text-xs font-medium"
            >
              <RefreshCw size={12} /> Retry Deploy
            </button>
            <button
              onClick={handleForceDestroy}
              disabled={destroying}
              className={`h-8 px-3 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-300 dark:border-red-800 rounded-md flex items-center gap-1.5 text-xs font-medium ${destroying ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            >
              <Trash2 size={12} /> Force Destroy
            </button>
          </div>
        </div>
      )}

      {/* DESTROYED cleanup status banner */}
      {d.status === 'DESTROYED' && (
        <div className={`px-4 py-3 mb-6 rounded-lg flex items-center justify-between ${
          cleanupPending
            ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800'
            : 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800'
        }`}>
          <div className="flex items-center gap-2">
            {cleanupPending ? (
              <>
                <XCircle size={14} className="text-amber-500" />
                <span className="text-xs text-amber-700 dark:text-amber-300">
                  Remote cleanup incomplete — some resources may still exist
                </span>
              </>
            ) : (
              <>
                <CheckCircle size={14} className="text-emerald-500" />
                <span data-testid="cleanup-badge" className="text-xs text-emerald-700 dark:text-emerald-300">
                  Cleanly removed from remote provider
                </span>
              </>
            )}
          </div>
          {cleanupPending && (
            <button
              onClick={handleRetryCleanup}
              disabled={retryingCleanup}
              className={`h-7 px-3 bg-amber-500 text-white border-none rounded-md flex items-center gap-1 text-xs font-medium ${retryingCleanup ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            >
              <RotateCcw size={11} /> {retryingCleanup ? 'Retrying...' : 'Retry Cleanup'}
            </button>
          )}
        </div>
      )}

      {/* Update dialog */}
      {showUpdateDialog && (
        <div className="p-4 bg-card border border-border rounded-lg mb-6">
          <h4 className="m-0 mb-4 text-sm font-medium text-foreground">Update Deployment</h4>
          <div className="mb-4">
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">New Version</label>
            <input type="text" value={newVersion} onChange={(e) => setNewVersion(e.target.value)} placeholder={d.artifactVersion} className="w-full h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background" />
          </div>
          <div className="mb-4">
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Docker Image (optional override)</label>
            <input type="text" value={newDockerImage} onChange={(e) => setNewDockerImage(e.target.value)} placeholder={d.dockerImage} className="w-full h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleUpdate} className="h-8 px-4 bg-foreground text-background border-none rounded-md cursor-pointer text-xs font-medium">Apply Update</button>
            <button onClick={() => setShowUpdateDialog(false)} className="h-8 px-4 bg-secondary text-secondary-foreground border border-border rounded-md cursor-pointer text-xs">Cancel</button>
          </div>
        </div>
      )}

      {/* Info cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="p-4 bg-secondary rounded-md">
          <div className="text-xs text-muted-foreground mb-1">Artifact</div>
          <div className="font-medium text-sm text-foreground">{d.artifactType}</div>
          <div className="mt-1.5">
            <VersionBadge currentVersion={d.artifactVersion} latestVersion={d.latestAvailableVersion} hasUpdate={d.hasUpdate} />
          </div>
        </div>
        <div className="p-4 bg-secondary rounded-md">
          <div className="text-xs text-muted-foreground mb-1">Status</div>
          <div className="font-medium text-sm text-foreground">{d.status}</div>
          <div className="mt-1.5">
            <HealthIndicator status={healthStatus || d.healthStatus} showLabel />
          </div>
        </div>
        <div className="p-4 bg-secondary rounded-md">
          <div className="text-xs text-muted-foreground mb-1">Endpoint</div>
          <div className="font-mono text-xs break-all text-foreground">
            {d.endpointUrl || 'N/A'}
          </div>
          {d.sshHost && (
            <div className="text-xs text-muted-foreground mt-1">
              SSH: {d.sshHost}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border mb-6 overflow-x-auto">
        <button className={tabStyle('overview')} onClick={() => setActiveTab('overview')}>Overview</button>
        <button className={tabStyle('usage')} onClick={() => setActiveTab('usage')}>Usage</button>
        <button className={tabStyle('request')} onClick={() => setActiveTab('request')}>Request</button>
        {d.templateId === 'livepeer-inference' && (
          <button className={tabStyle('pipeline')} onClick={() => setActiveTab('pipeline')}>Pipeline</button>
        )}
        <button className={tabStyle('timeline')} onClick={() => setActiveTab('timeline')}>Timeline</button>
        <button className={tabStyle('logs')} onClick={() => setActiveTab('logs')}>Logs</button>
        <button className={tabStyle('health')} onClick={() => setActiveTab('health')}>Health</button>
        <button className={tabStyle('audit')} onClick={() => setActiveTab('audit')}>Audit Log</button>
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
          <HealthIndicator status={healthStatus || d.healthStatus} size={16} showLabel />
          <p className="text-xs text-muted-foreground mt-2">
            Last checked: {d.lastHealthCheck ? new Date(d.lastHealthCheck).toLocaleString() : 'Never'}
          </p>
          {healthDetails && (
            <div className="mt-4 p-4 bg-secondary rounded-lg">
              <h4 className="m-0 mb-3 text-sm font-medium text-foreground">
                Provider Health Details
              </h4>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
                {healthDetails.endpointStatus && (
                  <div>
                    <div className="text-xs text-muted-foreground">Endpoint Status</div>
                    <div className="text-sm font-medium text-foreground">{healthDetails.endpointStatus}</div>
                  </div>
                )}
                {healthDetails.workers && (
                  <>
                    <div>
                      <div className="text-xs text-muted-foreground">Workers Running</div>
                      <div className="text-sm font-medium text-foreground">
                        {healthDetails.workers.running} / {healthDetails.workers.total}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Workers Idle</div>
                      <div className="text-sm font-medium text-foreground">{healthDetails.workers.idle}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Min / Max Workers</div>
                      <div className="text-sm font-medium text-foreground">
                        {healthDetails.workers.min} / {healthDetails.workers.max}
                      </div>
                    </div>
                  </>
                )}
                {healthDetails.jobs && (
                  <>
                    <div>
                      <div className="text-xs text-muted-foreground">Jobs Completed</div>
                      <div className="text-sm font-medium text-foreground">{healthDetails.jobs.completed}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Jobs In Queue</div>
                      <div className="text-sm font-medium text-foreground">{healthDetails.jobs.inQueue}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Jobs In Progress</div>
                      <div className="text-sm font-medium text-foreground">{healthDetails.jobs.inProgress}</div>
                    </div>
                  </>
                )}
              </div>
              {healthDetails.note && (
                <div className="mt-3 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md text-xs text-amber-700 dark:text-amber-300">
                  {healthDetails.note}
                </div>
              )}
              {healthDetails.isServerless && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Serverless endpoint — workers scale to zero when idle and spin up on demand
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {activeTab === 'audit' && <AuditTable deploymentId={id} />}
    </div>
  );
};
