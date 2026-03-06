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
  toStatus: string;
  reason?: string;
  metadata?: { steps?: DestroyStep[]; allClean?: boolean };
}

interface DeploymentLogsProps {
  deploymentId: string;
  autoScroll?: boolean;
}

const API_BASE = '/api/v1/deployment-manager';

const stepIcon = (status: string) => {
  if (status === 'ok') return { symbol: '✓', color: '#4ade80' };
  if (status === 'failed') return { symbol: '✗', color: '#f87171' };
  return { symbol: '–', color: '#6b7280' };
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

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Terminal size={16} />
        <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Deployment Logs</span>
      </div>
      <div
        ref={containerRef}
        style={{
          background: '#111827',
          color: '#e5e7eb',
          fontFamily: 'ui-monospace, monospace',
          fontSize: '0.75rem',
          padding: '1rem',
          borderRadius: '0.5rem',
          maxHeight: '400px',
          overflowY: 'auto',
          lineHeight: 1.8,
        }}
      >
        {entries.length === 0 ? (
          <span style={{ color: '#6b7280' }}>Waiting for logs...</span>
        ) : (
          entries.map((entry, i) => (
            <div key={i}>
              <div>
                [{new Date(entry.createdAt).toLocaleTimeString()}] {entry.toStatus}: {entry.reason || ''}
              </div>
              {entry.metadata?.steps && (
                <div style={{ paddingLeft: '1.5rem' }}>
                  {entry.metadata.steps.map((step: DestroyStep, j: number) => {
                    const icon = stepIcon(step.status);
                    return (
                      <div key={j} style={{ color: icon.color }}>
                        {icon.symbol} {step.resource}
                        {step.resourceId ? ` ${step.resourceId.substring(0, 16)}` : ''}
                        {' — '}{step.action}
                        {' — '}{step.detail || step.error || ''}
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
