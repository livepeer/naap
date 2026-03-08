import React, { useState, useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';

interface DestroyStep {
  resource: string;
  resourceId?: string;
  action: string;
  status: 'ok' | 'failed' | 'skipped';
  detail?: string;
  error?: string;
}

interface LogEntry {
  createdAt: string;
  fromStatus?: string;
  toStatus: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

interface DeploymentLogsProps {
  deploymentId: string;
  autoScroll?: boolean;
}

const API_BASE = '/api/v1/deployment-manager';

const stepIcon = (status: string) => {
  if (status === 'ok') return { symbol: '\u2713', color: '#4ade80' };
  if (status === 'failed') return { symbol: '\u2717', color: '#f87171' };
  return { symbol: '\u2013', color: '#6b7280' };
};

const statusColor = (status: string) => {
  if (status === 'ONLINE') return '#4ade80';
  if (status === 'FAILED') return '#f87171';
  if (status === 'DESTROYED') return '#6b7280';
  if (['DEPLOYING', 'PROVISIONING', 'VALIDATING', 'DESTROYING'].includes(status)) return '#facc15';
  return '#e5e7eb';
};

const ProviderMetaLine: React.FC<{ meta: Record<string, unknown> }> = ({ meta }) => {
  const parts: string[] = [];

  if (meta.providerReportedStatus) parts.push(`status=${meta.providerReportedStatus}`);
  if (meta.dockerImage) parts.push(`image=${meta.dockerImage}`);
  if (meta.gpuModel) parts.push(`gpu=${meta.gpuModel}${meta.gpuCount ? `\u00d7${meta.gpuCount}` : ''}`);

  const workers = meta.workers as Record<string, number> | undefined;
  const running = meta.workersRunning ?? workers?.running;
  const total = meta.workersTotal ?? workers?.total;
  if (running != null && total != null) parts.push(`workers=${running}/${total}`);

  if (meta.providerDeploymentId) parts.push(`endpoint=${meta.providerDeploymentId}`);
  if (meta.endpointUrl) parts.push(`url=${meta.endpointUrl}`);

  const error = meta.error as string | undefined;
  if (error) parts.push(`error="${error}"`);

  if (parts.length === 0) return null;

  return (
    <div className="text-gray-400 pl-6">
      {'  \u2514 '}{parts.join(' | ')}
    </div>
  );
};

export const DeploymentLogs: React.FC<DeploymentLogsProps> = ({ deploymentId, autoScroll = true }) => {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;

    const fetchLogs = async () => {
      try {
        const res = await fetch(`${API_BASE}/deployments/${deploymentId}/history`);
        const data = await res.json();
        if (data.success && active) {
          setEntries(data.data);
        }
      } catch {
        // ignore
      }
    };

    fetchLogs();
    const timer = setInterval(fetchLogs, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [deploymentId]);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  const steps = (meta: Record<string, unknown>) => meta.steps as DestroyStep[] | undefined;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Terminal size={16} />
        <span className="font-semibold text-sm">Deployment Logs</span>
      </div>
      <div
        ref={containerRef}
        className="bg-gray-900 text-gray-200 font-mono text-xs p-4 rounded-lg max-h-[400px] overflow-y-auto leading-[1.8]"
      >
        {entries.length === 0 ? (
          <span className="text-gray-500">Waiting for logs...</span>
        ) : (
          entries.map((entry, i) => (
            <div key={i}>
              <div>
                <span className="text-gray-500">[{new Date(entry.createdAt).toLocaleTimeString()}]</span>
                {' '}
                <span className="font-semibold" style={{ color: statusColor(entry.toStatus) }}>{entry.toStatus}</span>
                {entry.fromStatus && entry.fromStatus !== entry.toStatus && (
                  <span className="text-gray-500">{' \u2190 '}{entry.fromStatus}</span>
                )}
                {entry.reason && <span>{': '}{entry.reason}</span>}
              </div>
              {entry.metadata && !steps(entry.metadata) && (
                <ProviderMetaLine meta={entry.metadata} />
              )}
              {entry.metadata && steps(entry.metadata) && (
                <div className="pl-6">
                  {steps(entry.metadata)!.map((step, j) => {
                    const icon = stepIcon(step.status);
                    return (
                      <div key={j} style={{ color: icon.color }}>
                        {icon.symbol} {step.resource}
                        {step.resourceId ? ` ${step.resourceId.substring(0, 16)}` : ''}
                        {' \u2014 '}{step.action}
                        {' \u2014 '}{step.detail || step.error || ''}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
