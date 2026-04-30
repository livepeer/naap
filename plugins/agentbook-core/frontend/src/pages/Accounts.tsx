import React, { useEffect, useState } from 'react';
import { List, Plus } from 'lucide-react';

interface Account {
  id: string;
  code: string;
  name: string;
  accountType: string;
  taxCategory: string | null;
  isActive: boolean;
}

const API_BASE = '/api/v1/agentbook-core';

const TYPE_COLORS: Record<string, string> = {
  asset: 'text-blue-500 bg-blue-500/10',
  liability: 'text-orange-500 bg-orange-500/10',
  equity: 'text-purple-500 bg-purple-500/10',
  revenue: 'text-green-500 bg-green-500/10',
  expense: 'text-red-500 bg-red-500/10',
};

export const AccountsPage: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    fetch(`${API_BASE}/accounts`)
      .then(r => r.json())
      .then(data => { if (data.success) setAccounts(data.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter === 'all' ? accounts : accounts.filter(a => a.accountType === filter);
  const types = ['all', 'asset', 'liability', 'equity', 'revenue', 'expense'];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <List className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Chart of Accounts</h1>
        </div>
      </div>

      {/* Type Filter */}
      <div className="flex gap-2 mb-6">
        {types.map(type => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={`px-3 py-1.5 rounded-full text-sm capitalize transition-colors ${
              filter === type ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {type} {type !== 'all' && `(${accounts.filter(a => a.accountType === type).length})`}
          </button>
        ))}
      </div>

      {loading && <p className="text-muted-foreground">Loading accounts...</p>}

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left p-3 font-medium">Code</th>
              <th className="text-left p-3 font-medium">Name</th>
              <th className="text-left p-3 font-medium">Type</th>
              <th className="text-left p-3 font-medium">Tax Category</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(account => (
              <tr key={account.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                <td className="p-3 font-mono">{account.code}</td>
                <td className="p-3 font-medium">{account.name}</td>
                <td className="p-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${TYPE_COLORS[account.accountType] || ''}`}>
                    {account.accountType}
                  </span>
                </td>
                <td className="p-3 text-muted-foreground text-xs">{account.taxCategory || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && !loading && (
          <div className="p-8 text-center text-muted-foreground">No accounts found.</div>
        )}
      </div>
    </div>
  );
};
