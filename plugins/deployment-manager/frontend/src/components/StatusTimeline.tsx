import React, { useState, useEffect } from 'react';

const API_BASE = '/api/v1/deployment-manager';

interface StatusEntry {
  id: string;
  fromStatus?: string;
  toStatus: string;
  reason?: string;
  initiatedBy?: string;
  createdAt: string;
}

interface StatusTimelineProps {
  deploymentId: string;
}

export const StatusTimeline: React.FC<StatusTimelineProps> = ({ deploymentId }) => {
  const [entries, setEntries] = useState<StatusEntry[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/deployments/${deploymentId}/history`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setEntries(d.data); })
      .catch(() => {});
  }, [deploymentId]);

  if (entries.length === 0) {
    return <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>No status history</p>;
  }

  return (
    <div style={{ position: 'relative', paddingLeft: '1.5rem' }}>
      <div style={{
        position: 'absolute',
        left: '0.35rem',
        top: 0,
        bottom: 0,
        width: '2px',
        background: '#e5e7eb',
      }} />
      {entries.map((entry) => (
        <div key={entry.id} style={{ position: 'relative', paddingBottom: '1rem' }}>
          <div style={{
            position: 'absolute',
            left: '-1.15rem',
            top: '0.25rem',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#3b82f6',
          }} />
          <div style={{ fontSize: '0.875rem' }}>
            <span style={{ fontWeight: 600 }}>{entry.toStatus}</span>
            {entry.fromStatus && (
              <span style={{ color: '#9ca3af' }}> from {entry.fromStatus}</span>
            )}
          </div>
          {entry.reason && (
            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{entry.reason}</div>
          )}
          <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>
            {new Date(entry.createdAt).toLocaleString()}
            {entry.initiatedBy && ` by ${entry.initiatedBy}`}
          </div>
        </div>
      ))}
    </div>
  );
};
