import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Mail,
  DollarSign,
  Clock,
  Loader2,
  RefreshCw,
  UserPlus,
} from 'lucide-react';

interface Client {
  id: string;
  name: string;
  email: string;
  total_billed: number;
  total_paid: number;
  outstanding_balance: number;
  avg_days_to_pay: number;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export const ClientsPage: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/agentbook-invoice/clients');
      if (!res.ok) throw new Error('Failed to fetch clients');
      const data = await res.json();
      setClients(Array.isArray(data) ? data : data.clients ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Clients
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Manage your billing contacts
          </p>
        </div>
        <button
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-colors"
          style={{ backgroundColor: 'var(--accent-emerald, #10b981)' }}
        >
          <UserPlus className="w-4 h-4" />
          Add Client
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent-emerald)' }} />
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-red-500 mb-3">{error}</p>
          <button
            onClick={fetchClients}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      ) : clients.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>
          <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No clients yet</p>
          <p className="text-sm mt-1">Add your first client to start invoicing.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {clients.map((client) => {
            const isPaidUp = client.outstanding_balance <= 0;
            const accentBorder = isPaidUp ? 'border-l-green-500' : 'border-l-amber-500';
            return (
              <div
                key={client.id}
                className={`rounded-xl p-4 border border-border bg-card border-l-4 ${accentBorder} transition-shadow hover:shadow-md`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-base truncate text-foreground">
                      {client.name}
                    </h3>
                    <p className="text-sm flex items-center gap-1 mt-0.5 text-muted-foreground">
                      <Mail className="w-3 h-3" />
                      {client.email}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      isPaidUp ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {isPaidUp ? 'Paid Up' : 'Outstanding'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Total Billed</p>
                    <p className="text-sm font-semibold flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
                      <DollarSign className="w-3 h-3" />
                      {formatCurrency(client.total_billed)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Total Paid</p>
                    <p className="text-sm font-semibold text-green-600 flex items-center gap-1">
                      <DollarSign className="w-3 h-3" />
                      {formatCurrency(client.total_paid)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Outstanding</p>
                    <p className={`text-sm font-semibold flex items-center gap-1 ${
                      client.outstanding_balance > 0 ? 'text-amber-600' : 'text-green-600'
                    }`}>
                      <DollarSign className="w-3 h-3" />
                      {formatCurrency(client.outstanding_balance)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Avg Days to Pay</p>
                    <p className="text-sm font-semibold flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
                      <Clock className="w-3 h-3" />
                      {client.avg_days_to_pay} days
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ClientsPage;
