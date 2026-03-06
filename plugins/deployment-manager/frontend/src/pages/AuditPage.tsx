import React, { useState, useEffect } from 'react';
import { FileText, Filter } from 'lucide-react';

const API_BASE = '/api/v1/deployment-manager';

interface AuditEntry {
  id: string;
  deploymentId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  userId: string;
  ipAddress?: string;
  status: string;
  errorMsg?: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export const AuditPage: React.FC = () => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ action: '', userId: '', deploymentId: '' });
  const [page, setPage] = useState(0);
  const limit = 25;

  const fetchAudit = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.action) params.set('action', filters.action);
      if (filters.userId) params.set('userId', filters.userId);
      if (filters.deploymentId) params.set('deploymentId', filters.deploymentId);
      params.set('limit', String(limit));
      params.set('offset', String(page * limit));

      const res = await fetch(`${API_BASE}/audit?${params}`);
      const data = await res.json();
      if (data.success) {
        setEntries(data.data);
        setTotal(data.total);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAudit(); }, [filters, page]);

  const cellStyle: React.CSSProperties = {
    padding: '0.625rem 0.75rem',
    fontSize: '0.8rem',
    borderBottom: '1px solid var(--dm-bg-tertiary)',
    verticalAlign: 'top',
    color: 'var(--dm-text-secondary)',
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
        <FileText size={28} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0, color: 'var(--dm-text-primary)' }}>Audit Log</h1>
        <span style={{ fontSize: '0.8rem', color: 'var(--dm-text-tertiary)' }}>({total} entries)</span>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', alignItems: 'center' }}>
        <Filter size={16} color="#9ca3af" />
        <select
          value={filters.action}
          onChange={(e) => { setFilters({ ...filters, action: e.target.value }); setPage(0); }}
          style={{ padding: '0.375rem 0.75rem', border: '1px solid var(--dm-border-input)', borderRadius: '0.375rem', fontSize: '0.8rem', color: 'var(--dm-text-primary)', backgroundColor: 'var(--dm-bg-input)' }}
        >
          <option value="">All Actions</option>
          {['CREATE', 'DEPLOY', 'UPDATE', 'DESTROY', 'CONFIG_CHANGE', 'HEALTH_CHECK'].map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Filter by User ID..."
          value={filters.userId}
          onChange={(e) => { setFilters({ ...filters, userId: e.target.value }); setPage(0); }}
          style={{ padding: '0.375rem 0.75rem', border: '1px solid var(--dm-border-input)', borderRadius: '0.375rem', fontSize: '0.8rem', width: '200px', color: 'var(--dm-text-primary)', backgroundColor: 'var(--dm-bg-input)' }}
        />
        <input
          type="text"
          placeholder="Filter by Deployment ID..."
          value={filters.deploymentId}
          onChange={(e) => { setFilters({ ...filters, deploymentId: e.target.value }); setPage(0); }}
          style={{ padding: '0.375rem 0.75rem', border: '1px solid var(--dm-border-input)', borderRadius: '0.375rem', fontSize: '0.8rem', width: '250px', color: 'var(--dm-text-primary)', backgroundColor: 'var(--dm-bg-input)' }}
        />
      </div>

      {loading ? (
        <p style={{ color: 'var(--dm-text-secondary)' }}>Loading...</p>
      ) : entries.length === 0 ? (
        <p style={{ color: 'var(--dm-text-tertiary)' }}>No audit entries found</p>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--dm-border)' }}>
                <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600, color: 'var(--dm-text-primary)' }}>Time</th>
                <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600, color: 'var(--dm-text-primary)' }}>Action</th>
                <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600, color: 'var(--dm-text-primary)' }}>Resource</th>
                <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600, color: 'var(--dm-text-primary)' }}>Status</th>
                <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600, color: 'var(--dm-text-primary)' }}>User</th>
                <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600, color: 'var(--dm-text-primary)' }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap', color: 'var(--dm-text-secondary)' }}>
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td style={cellStyle}>
                    <span style={{
                      padding: '0.125rem 0.4rem',
                      borderRadius: '0.25rem',
                      background: 'var(--dm-bg-tertiary)',
                      color: 'var(--dm-text-secondary)',
                      fontWeight: 500,
                      fontFamily: 'monospace',
                    }}>
                      {e.action}
                    </span>
                  </td>
                  <td style={cellStyle}>
                    {e.resource}
                    {e.resourceId && (
                      <span style={{ fontSize: '0.7rem', color: 'var(--dm-text-tertiary)', display: 'block', fontFamily: 'monospace' }}>
                        {e.resourceId.slice(0, 8)}...
                      </span>
                    )}
                  </td>
                  <td style={cellStyle}>
                    <span style={{ color: e.status === 'success' ? '#16a34a' : '#dc2626', fontWeight: 500 }}>
                      {e.status}
                    </span>
                    {e.errorMsg && (
                      <span style={{ display: 'block', fontSize: '0.7rem', color: '#dc2626', marginTop: '0.125rem' }}>
                        {e.errorMsg}
                      </span>
                    )}
                  </td>
                  <td style={{ ...cellStyle, fontFamily: 'monospace' }}>{e.userId.slice(0, 8)}</td>
                  <td style={{ ...cellStyle, fontSize: '0.7rem', color: 'var(--dm-text-secondary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {e.details ? JSON.stringify(e.details).slice(0, 80) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {total > limit && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1.5rem' }}>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                style={{
                  padding: '0.375rem 0.75rem',
                  border: '1px solid var(--dm-border-input)',
                  borderRadius: '0.375rem',
                  background: 'var(--dm-bg-primary)',
                  color: 'var(--dm-text-secondary)',
                  cursor: page === 0 ? 'not-allowed' : 'pointer',
                  opacity: page === 0 ? 0.5 : 1,
                  fontSize: '0.8rem',
                }}
              >
                Previous
              </button>
              <span style={{ padding: '0.375rem', fontSize: '0.8rem', color: 'var(--dm-text-secondary)' }}>
                Page {page + 1} of {Math.ceil(total / limit)}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * limit >= total}
                style={{
                  padding: '0.375rem 0.75rem',
                  border: '1px solid var(--dm-border-input)',
                  borderRadius: '0.375rem',
                  background: 'var(--dm-bg-primary)',
                  color: 'var(--dm-text-secondary)',
                  cursor: (page + 1) * limit >= total ? 'not-allowed' : 'pointer',
                  opacity: (page + 1) * limit >= total ? 0.5 : 1,
                  fontSize: '0.8rem',
                }}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
