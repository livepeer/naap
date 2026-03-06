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
    return <p style={{ color: 'var(--dm-text-tertiary)', fontSize: '0.875rem' }}>No status history</p>;
  }

  return (
    <div style={{ position: 'relative', paddingLeft: '1.5rem' }}>
      <div style={{
        position: 'absolute',
        left: '0.35rem',
        top: 0,
        bottom: 0,
        width: '2px',
        background: 'var(--dm-border)',
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
            background: 'var(--dm-accent-blue)',
          }} />
          <div style={{ fontSize: '0.875rem', color: 'var(--dm-text-primary)' }}>
            <span style={{ fontWeight: 600, color: 'var(--dm-text-primary)' }}>{entry.toStatus}</span>
            {entry.fromStatus && (
              <span style={{ color: 'var(--dm-text-tertiary)' }}> from {entry.fromStatus}</span>
            )}
          </div>
          {entry.reason && (
            <div style={{ fontSize: '0.75rem', color: 'var(--dm-text-secondary)' }}>{entry.reason}</div>
          )}
          <div style={{ fontSize: '0.7rem', color: 'var(--dm-text-tertiary)' }}>
            {new Date(entry.createdAt).toLocaleString()}
            {entry.initiatedBy && ` by ${entry.initiatedBy}`}
          </div>
        </div>
      ))}
    </div>
  );
};
