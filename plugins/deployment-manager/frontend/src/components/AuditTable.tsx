import React, { useState, useEffect } from 'react';

const API_BASE = '/api/v1/deployment-manager';

interface AuditEntry {
  id: string;
  deploymentId?: string;
  action: string;
  resource: string;
  userId: string;
  status: string;
  errorMsg?: string;
  createdAt: string;
}

interface AuditTableProps {
  deploymentId?: string;
  limit?: number;
}

export const AuditTable: React.FC<AuditTableProps> = ({ deploymentId, limit = 20 }) => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (deploymentId) params.set('deploymentId', deploymentId);
    params.set('limit', String(limit));

    fetch(`${API_BASE}/audit?${params}`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setEntries(d.data); })
      .catch(() => {});
  }, [deploymentId, limit]);

  if (entries.length === 0) {
    return <p style={{ color: 'var(--dm-text-tertiary)', fontSize: '0.875rem' }}>No audit entries</p>;
  }

  const cellStyle: React.CSSProperties = {
    padding: '0.5rem 0.75rem',
    fontSize: '0.8rem',
    borderBottom: '1px solid var(--dm-bg-tertiary)',
    color: 'var(--dm-text-secondary)',
  };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '2px solid var(--dm-border)' }}>
          <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600, color: 'var(--dm-text-primary)' }}>Action</th>
          <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600, color: 'var(--dm-text-primary)' }}>Resource</th>
          <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600, color: 'var(--dm-text-primary)' }}>Status</th>
          <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600, color: 'var(--dm-text-primary)' }}>User</th>
          <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600, color: 'var(--dm-text-primary)' }}>Time</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id}>
            <td style={cellStyle}>{e.action}</td>
            <td style={cellStyle}>{e.resource}</td>
            <td style={cellStyle}>
              <span style={{
                color: e.status === 'success' ? '#16a34a' : '#dc2626',
                fontWeight: 500,
              }}>
                {e.status}
              </span>
            </td>
            <td style={{ ...cellStyle, fontFamily: 'monospace' }}>{e.userId.slice(0, 8)}</td>
            <td style={{ ...cellStyle, color: 'var(--dm-text-tertiary)' }}>{new Date(e.createdAt).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
