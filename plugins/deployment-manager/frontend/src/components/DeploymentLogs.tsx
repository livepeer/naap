import React, { useState, useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';

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
  const lines: string[][] = [];
  const line1: string[] = [];
  const line2: string[] = [];

  if (meta.providerReportedStatus) line1.push(`status=${meta.providerReportedStatus}`);
  if (meta.providerStatus) line1.push(`provider=${meta.providerStatus}`);
  if (meta.dockerImage) line1.push(`image=${meta.dockerImage}`);
  if (meta.gpuModel) line1.push(`gpu=${meta.gpuModel}${meta.gpuCount ? `\u00d7${meta.gpuCount}` : ''}`);
  if (meta.providerSlug) line1.push(`provider=${meta.providerSlug}`);
  if (meta.providerMode) line1.push(`mode=${meta.providerMode}`);

  const workers = meta.workers as Record<string, number> | undefined;
  const running = meta.workersRunning ?? workers?.running;
  const total = meta.workersTotal ?? workers?.total;
  if (running != null && total != null) line1.push(`workers=${running}/${total}`);

  if (meta.providerDeploymentId) line2.push(`endpoint=${meta.providerDeploymentId}`);
  if (meta.endpointUrl) line2.push(`url=${meta.endpointUrl}`);
  if (meta.healthStatus) line2.push(`health=${meta.healthStatus}`);
  if (meta.responseTimeMs) line2.push(`latency=${meta.responseTimeMs}ms`);

  const error = meta.error as string | undefined;
  if (error) line2.push(`error="${error}"`);

  if (line1.length > 0) lines.push(line1);
  if (line2.length > 0) lines.push(line2);

  // Show deploy steps from provider metadata
  const metaSteps = meta.steps as Array<{ step: string; status: string; templateId?: string; endpointId?: string }> | undefined;
  const healthDetails = meta.healthDetails as Record<string, unknown> | undefined;
  const details = meta.details as Record<string, unknown> | undefined;

  if (lines.length === 0 && !metaSteps && !healthDetails && !details) return null;

  return (
    <div className="text-gray-400 pl-6">
      {lines.map((parts, i) => (
        <div key={i}>{'  \u2514 '}{parts.join(' | ')}</div>
      ))}
      {metaSteps && metaSteps.map((s, i) => (
        <div key={`step-${i}`} style={{ color: s.status === 'created' || s.status === 'ok' ? '#4ade80' : '#facc15' }}>
          {'  \u2514 '}{s.step}: {s.status}{s.templateId ? ` (${s.templateId})` : ''}{s.endpointId ? ` (${s.endpointId})` : ''}
        </div>
      ))}
      {healthDetails && (
        <div>{'  \u2514 '}health: {JSON.stringify(healthDetails)}</div>
      )}
      {details && !metaSteps && (
        <div>{'  \u2514 '}details: {typeof details === 'object' ? JSON.stringify(details) : String(details)}</div>
      )}
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
        const res = await apiFetch(`/deployments/${deploymentId}/history`);
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
          entries.map((entry, i) => {
            const isNoOp = entry.fromStatus === entry.toStatus;
            return (
            <div key={i}>
              <div className={isNoOp ? 'opacity-70' : ''}>
                <span className="text-gray-500">[{new Date(entry.createdAt).toLocaleTimeString()}]</span>
                {' '}
                <span className={isNoOp ? '' : 'font-semibold'} style={{ color: statusColor(entry.toStatus) }}>{entry.toStatus}</span>
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
          );})
        )}
      </div>
    </div>
  );
};
