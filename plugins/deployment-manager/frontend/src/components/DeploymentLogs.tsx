import React, { useState, useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';

interface DeploymentLogsProps {
  deploymentId: string;
  autoScroll?: boolean;
}

const API_BASE = '/api/v1/deployment-manager';

export const DeploymentLogs: React.FC<DeploymentLogsProps> = ({ deploymentId, autoScroll = true }) => {
  const [logs, setLogs] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;

    const fetchLogs = async () => {
      try {
        const res = await fetch(`${API_BASE}/deployments/${deploymentId}/history`);
        const data = await res.json();
        if (data.success && active) {
          setLogs(data.data.map((entry: any) =>
            `[${new Date(entry.createdAt).toLocaleTimeString()}] ${entry.toStatus}: ${entry.reason || ''}`
          ));
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
  }, [logs, autoScroll]);

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
          maxHeight: '300px',
          overflowY: 'auto',
          lineHeight: 1.8,
        }}
      >
        {logs.length === 0 ? (
          <span style={{ color: '#6b7280' }}>Waiting for logs...</span>
        ) : (
          logs.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
    </div>
  );
};
