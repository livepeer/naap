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

  return (
    <div className="px-6 py-5 max-w-[1200px] mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <FileText size={20} className="text-foreground" />
        <h1 className="text-xl font-semibold text-foreground m-0 tracking-tight">Audit Log</h1>
        <span className="text-xs text-muted-foreground">({total} entries)</span>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5 items-center flex-wrap">
        <Filter size={14} className="text-muted-foreground" />
        <select
          value={filters.action}
          onChange={(e) => { setFilters({ ...filters, action: e.target.value }); setPage(0); }}
          className="h-8 px-3 border border-border rounded-md text-xs text-foreground bg-background"
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
          className="h-8 px-3 border border-border rounded-md text-xs text-foreground bg-background w-44"
        />
        <input
          type="text"
          placeholder="Filter by Deployment ID..."
          value={filters.deploymentId}
          onChange={(e) => { setFilters({ ...filters, deploymentId: e.target.value }); setPage(0); }}
          className="h-8 px-3 border border-border rounded-md text-xs text-foreground bg-background w-52"
        />
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">No audit entries found</p>
      ) : (
        <>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-secondary">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Time</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Action</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Resource</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Status</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">User</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-border hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground align-top whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs align-top">
                      <span className="px-1.5 py-0.5 rounded bg-secondary text-xs font-mono font-medium text-foreground">
                        {e.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground align-top">
                      {e.resource}
                      {e.resourceId && (
                        <span className="text-xs text-muted-foreground block font-mono opacity-60">
                          {e.resourceId.slice(0, 8)}...
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs align-top">
                      <span className={e.status === 'success' ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-red-500 dark:text-red-400 font-medium'}>
                        {e.status}
                      </span>
                      {e.errorMsg && (
                        <span className="block text-xs text-red-500 dark:text-red-400 mt-0.5 opacity-80">
                          {e.errorMsg}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground align-top font-mono">{e.userId.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground align-top max-w-[200px] truncate">
                      {e.details ? JSON.stringify(e.details).slice(0, 80) : '\u2014'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > limit && (
            <div className="flex justify-center gap-2 mt-5">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="h-8 px-3 border border-border rounded-md bg-secondary text-sm text-muted-foreground cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="h-8 px-3 flex items-center text-xs text-muted-foreground">
                Page {page + 1} of {Math.ceil(total / limit)}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * limit >= total}
                className="h-8 px-3 border border-border rounded-md bg-secondary text-sm text-muted-foreground cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
