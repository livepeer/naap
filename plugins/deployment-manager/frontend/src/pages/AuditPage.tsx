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
    borderBottom: '1px solid #f3f4f6',
    verticalAlign: 'top',
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
        <FileText size={28} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Audit Log</h1>
        <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>({total} entries)</span>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', alignItems: 'center' }}>
        <Filter size={16} color="#9ca3af" />
        <select
          value={filters.action}
          onChange={(e) => { setFilters({ ...filters, action: e.target.value }); setPage(0); }}
          style={{ padding: '0.375rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.8rem' }}
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
          style={{ padding: '0.375rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.8rem', width: '200px' }}
        />
        <input
          type="text"
          placeholder="Filter by Deployment ID..."
          value={filters.deploymentId}
          onChange={(e) => { setFilters({ ...filters, deploymentId: e.target.value }); setPage(0); }}
          style={{ padding: '0.375rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.8rem', width: '250px' }}
        />
      </div>

      {loading ? (
        <p style={{ color: '#6b7280' }}>Loading...</p>
      ) : entries.length === 0 ? (
        <p style={{ color: '#9ca3af' }}>No audit entries found</p>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600 }}>Time</th>
                <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600 }}>Action</th>
                <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600 }}>Resource</th>
                <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600 }}>Status</th>
                <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600 }}>User</th>
                <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600 }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap', color: '#6b7280' }}>
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td style={cellStyle}>
                    <span style={{
                      padding: '0.125rem 0.4rem',
                      borderRadius: '0.25rem',
                      background: '#f3f4f6',
                      fontWeight: 500,
                      fontFamily: 'monospace',
                    }}>
                      {e.action}
                    </span>
                  </td>
                  <td style={cellStyle}>
                    {e.resource}
                    {e.resourceId && (
                      <span style={{ fontSize: '0.7rem', color: '#9ca3af', display: 'block', fontFamily: 'monospace' }}>
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
                  <td style={{ ...cellStyle, fontSize: '0.7rem', color: '#6b7280', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                  border: '1px solid #d1d5db',
                  borderRadius: '0.375rem',
                  background: '#fff',
                  cursor: page === 0 ? 'not-allowed' : 'pointer',
                  opacity: page === 0 ? 0.5 : 1,
                  fontSize: '0.8rem',
                }}
              >
                Previous
              </button>
              <span style={{ padding: '0.375rem', fontSize: '0.8rem', color: '#6b7280' }}>
                Page {page + 1} of {Math.ceil(total / limit)}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * limit >= total}
                style={{
                  padding: '0.375rem 0.75rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.375rem',
                  background: '#fff',
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
