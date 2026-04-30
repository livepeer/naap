import React, { useEffect, useState } from 'react';
import { Store, TrendingUp } from 'lucide-react';

interface Vendor {
  id: string;
  name: string;
  normalizedName: string;
  defaultCategoryId: string | null;
  transactionCount: number;
  lastSeen: string;
}

const API_BASE = '/api/v1/agentbook-expense';

export const VendorsPage: React.FC = () => {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/vendors`)
      .then(r => r.json())
      .then(data => { if (data.success) setVendors(data.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Store className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Vendors</h1>
      </div>

      {loading && <p className="text-muted-foreground">Loading vendors...</p>}

      {vendors.length === 0 && !loading && (
        <div className="text-center py-12 text-muted-foreground">
          <p>No vendors yet. They appear automatically as you record expenses.</p>
        </div>
      )}

      <div className="space-y-2">
        {vendors.map(vendor => (
          <div key={vendor.id} className="bg-card border border-border rounded-lg p-4 flex items-center justify-between">
            <div>
              <p className="font-medium">{vendor.name}</p>
              <p className="text-xs text-muted-foreground">Last seen: {new Date(vendor.lastSeen).toLocaleDateString()}</p>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TrendingUp className="w-4 h-4" />
              <span>{vendor.transactionCount} transactions</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
