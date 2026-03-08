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
    return <p className="text-muted-foreground/70 text-sm">No audit entries</p>;
  }

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b-2 border-border">
          <th className="px-3 py-2 text-[0.8rem] text-left font-semibold text-foreground border-b border-border/40">Action</th>
          <th className="px-3 py-2 text-[0.8rem] text-left font-semibold text-foreground border-b border-border/40">Resource</th>
          <th className="px-3 py-2 text-[0.8rem] text-left font-semibold text-foreground border-b border-border/40">Status</th>
          <th className="px-3 py-2 text-[0.8rem] text-left font-semibold text-foreground border-b border-border/40">User</th>
          <th className="px-3 py-2 text-[0.8rem] text-left font-semibold text-foreground border-b border-border/40">Time</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id}>
            <td className="px-3 py-2 text-[0.8rem] text-muted-foreground border-b border-border/40">{e.action}</td>
            <td className="px-3 py-2 text-[0.8rem] text-muted-foreground border-b border-border/40">{e.resource}</td>
            <td className="px-3 py-2 text-[0.8rem] border-b border-border/40">
              <span className={`font-medium ${e.status === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                {e.status}
              </span>
            </td>
            <td className="px-3 py-2 text-[0.8rem] text-muted-foreground font-mono border-b border-border/40">{e.userId.slice(0, 8)}</td>
            <td className="px-3 py-2 text-[0.8rem] text-muted-foreground/70 border-b border-border/40">{new Date(e.createdAt).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
