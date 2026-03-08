import React, { useState, useEffect } from 'react';

const API_BASE = '/api/v1/deployment-manager';

interface StatusEntry {
  id: string;
  fromStatus?: string;
  toStatus: string;
  reason?: string;
  initiatedBy?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

interface StatusTimelineProps {
  deploymentId: string;
}

const dotColor = (status: string) => {
  if (status === 'ONLINE') return '#22c55e';
  if (status === 'FAILED') return '#ef4444';
  if (status === 'DESTROYED') return '#71717a';
  if (status === 'DEPLOYING' || status === 'PROVISIONING' || status === 'VALIDATING') return '#f59e0b';
  return '#3b82f6';
};

const ProviderDetails: React.FC<{ meta: Record<string, unknown> }> = ({ meta }) => {
  const details: string[] = [];

  if (meta.providerReportedStatus) details.push(`Provider: ${meta.providerReportedStatus}`);
  if (meta.dockerImage) details.push(`Image: ${meta.dockerImage}`);
  if (meta.gpuModel) details.push(`GPU: ${meta.gpuModel}${meta.gpuCount ? ` x${meta.gpuCount}` : ''}`);
  if (meta.providerDeploymentId) details.push(`Endpoint: ${meta.providerDeploymentId}`);

  const workers = meta.workers as Record<string, number> | undefined;
  const workersRunning = meta.workersRunning ?? workers?.running;
  const workersTotal = meta.workersTotal ?? workers?.total;
  if (workersRunning != null && workersTotal != null) {
    details.push(`Workers: ${workersRunning}/${workersTotal} running`);
  }

  if (meta.endpointUrl) details.push(`URL: ${meta.endpointUrl}`);

  const error = meta.error as string | undefined;
  if (error) details.push(`Error: ${error}`);

  if (details.length === 0) return null;

  return (
    <div className="text-xs text-muted-foreground mt-1 pl-3 border-l-2 border-border">
      {details.map((d, i) => <div key={i}>{d}</div>)}
    </div>
  );
};

export const StatusTimeline: React.FC<StatusTimelineProps> = ({ deploymentId }) => {
  const [entries, setEntries] = useState<StatusEntry[]>([]);

  useEffect(() => {
    let active = true;
    const fetchHistory = () => {
      fetch(`${API_BASE}/deployments/${deploymentId}/history`)
        .then((r) => r.json())
        .then((d) => { if (d.success && active) setEntries(d.data); })
        .catch(() => {});
    };
    fetchHistory();
    const timer = setInterval(fetchHistory, 8000);
    return () => { active = false; clearInterval(timer); };
  }, [deploymentId]);

  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">No status history</p>;
  }

  return (
    <div className="relative pl-6">
      <div className="absolute left-[0.35rem] top-0 bottom-0 w-0.5 bg-border" />
      {entries.map((entry) => (
        <div key={entry.id} className="relative pb-4">
          <div
            className="absolute -left-[1.15rem] top-1 w-2 h-2 rounded-full"
            style={{ background: dotColor(entry.toStatus) }}
          />
          <div className="text-sm text-foreground">
            <span className="font-medium text-foreground">{entry.toStatus}</span>
            {entry.fromStatus && entry.fromStatus !== entry.toStatus && (
              <span className="text-muted-foreground"> from {entry.fromStatus}</span>
            )}
          </div>
          {entry.reason && (
            <div className="text-xs text-muted-foreground mt-0.5">{entry.reason}</div>
          )}
          {entry.metadata && <ProviderDetails meta={entry.metadata} />}
          <div className="text-xs text-muted-foreground mt-0.5">
            {new Date(entry.createdAt).toLocaleString()}
            {entry.initiatedBy && entry.initiatedBy !== 'system' && ` by ${entry.initiatedBy}`}
          </div>
        </div>
      ))}
    </div>
  );
};
