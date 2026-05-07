import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Repeat,
  Pause,
  Play,
  Trash2,
  Pencil,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';

type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual';
type Status = 'active' | 'paused' | 'completed';

interface TemplateLine {
  description?: string;
  quantity?: number;
  rateCents: number;
}

interface RecurringInvoice {
  id: string;
  clientId: string;
  clientName?: string;
  frequency: Frequency;
  nextDue: string;
  endDate?: string | null;
  status: Status;
  templateLines: TemplateLine[];
  totalCents: number;
  daysToPay: number;
  autoSend: boolean;
  generatedCount: number;
  lastGenerated?: string | null;
  currency: string;
}

interface ClientOption {
  id: string;
  name: string;
}

const FREQUENCIES: Frequency[] = ['weekly', 'biweekly', 'monthly', 'quarterly', 'annual'];

const STATUS_CONFIG: Record<Status, { label: string; bg: string; text: string }> = {
  active: { label: 'Active', bg: 'bg-green-100', text: 'text-green-700' },
  paused: { label: 'Paused', bg: 'bg-amber-100', text: 'text-amber-700' },
  completed: { label: 'Completed', bg: 'bg-gray-100', text: 'text-gray-600' },
};

function formatCurrency(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface ScheduleFormState {
  clientId: string;
  frequency: Frequency;
  nextDue: string; // YYYY-MM-DD
  description: string;
  amountDollars: string;
  daysToPay: number;
  autoSend: boolean;
}

const EMPTY_FORM: ScheduleFormState = {
  clientId: '',
  frequency: 'monthly',
  nextDue: new Date().toISOString().slice(0, 10),
  description: '',
  amountDollars: '',
  daysToPay: 30,
  autoSend: false,
};

export const RecurringInvoicesPage: React.FC = () => {
  const [items, setItems] = useState<RecurringInvoice[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ScheduleFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [recRes, clientRes] = await Promise.all([
        fetch('/api/v1/agentbook-invoice/recurring-invoices'),
        fetch('/api/v1/agentbook-invoice/clients'),
      ]);
      if (!recRes.ok) throw new Error('Failed to load recurring invoices');
      const recJson = await recRes.json();
      const list: RecurringInvoice[] = recJson.data ?? recJson.items ?? [];

      let clientList: ClientOption[] = [];
      if (clientRes.ok) {
        const cj = await clientRes.json();
        const arr = Array.isArray(cj) ? cj : cj.clients ?? cj.data ?? [];
        clientList = arr.map((c: any) => ({ id: c.id, name: c.name ?? c.client_name ?? '' }));
      }
      setClients(clientList);

      // Hydrate clientName by joining client list when the API doesn't include it.
      const nameById = new Map(clientList.map((c) => [c.id, c.name]));
      setItems(
        list.map((r) => ({
          ...r,
          clientName: r.clientName ?? nameById.get(r.clientId) ?? '—',
        })),
      );
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, clientId: clients[0]?.id ?? '' });
    setEditingId(null);
    setShowCreate(true);
  };

  const openEdit = (r: RecurringInvoice) => {
    const firstLine = r.templateLines?.[0];
    const amount = firstLine ? firstLine.rateCents / 100 : r.totalCents / 100;
    setForm({
      clientId: r.clientId,
      frequency: r.frequency,
      nextDue: r.nextDue.slice(0, 10),
      description: firstLine?.description ?? '',
      amountDollars: amount.toFixed(2),
      daysToPay: r.daysToPay,
      autoSend: r.autoSend,
    });
    setEditingId(r.id);
    setShowCreate(true);
  };

  const closeModal = () => {
    setShowCreate(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const rateCents = Math.round(parseFloat(form.amountDollars || '0') * 100);
      if (!rateCents || rateCents <= 0) {
        alert('Please enter a positive amount');
        setSubmitting(false);
        return;
      }
      const templateLines = [
        { description: form.description || 'Recurring invoice', quantity: 1, rateCents },
      ];
      if (editingId) {
        const res = await fetch(`/api/v1/agentbook-invoice/recurring-invoices/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            frequency: form.frequency,
            templateLines,
            daysToPay: form.daysToPay,
            autoSend: form.autoSend,
            nextDue: form.nextDue,
          }),
        });
        if (!res.ok) throw new Error('Update failed');
      } else {
        if (!form.clientId) {
          alert('Please select a client');
          setSubmitting(false);
          return;
        }
        const res = await fetch('/api/v1/agentbook-invoice/recurring-invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: form.clientId,
            frequency: form.frequency,
            nextDue: form.nextDue,
            templateLines,
            daysToPay: form.daysToPay,
            autoSend: form.autoSend,
          }),
        });
        if (!res.ok) throw new Error('Create failed');
      }
      closeModal();
      await fetchAll();
    } catch (err: any) {
      alert(err?.message ?? 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  const togglePause = async (r: RecurringInvoice) => {
    const newStatus: Status = r.status === 'active' ? 'paused' : 'active';
    try {
      const res = await fetch(`/api/v1/agentbook-invoice/recurring-invoices/${r.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Update failed');
      await fetchAll();
    } catch (err: any) {
      alert(err?.message ?? 'Update failed');
    }
  };

  const deleteSchedule = async (r: RecurringInvoice) => {
    if (!confirm(`Delete recurring schedule for ${r.clientName}?`)) return;
    try {
      const res = await fetch(`/api/v1/agentbook-invoice/recurring-invoices/${r.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Delete failed');
      await fetchAll();
    } catch (err: any) {
      alert(err?.message ?? 'Delete failed');
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Recurring Invoices
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Schedule invoices to be issued automatically.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-colors"
          style={{ backgroundColor: 'var(--accent-emerald, #10b981)' }}
        >
          <Plus className="w-4 h-4" />
          New Schedule
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
            onClick={fetchAll}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>
          <Repeat className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No recurring schedules</p>
          <p className="text-sm mt-1">Create one to bill a client on a regular cadence.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Frequency</th>
                <th className="px-4 py-3">Next Due</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Generated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const cfg = STATUS_CONFIG[r.status];
                return (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium">{r.clientName}</td>
                    <td className="px-4 py-3 capitalize">{r.frequency}</td>
                    <td className="px-4 py-3">{formatDate(r.nextDue)}</td>
                    <td className="px-4 py-3 font-semibold">{formatCurrency(r.totalCents, r.currency)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">{r.generatedCount}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {r.status !== 'completed' && (
                          <button
                            onClick={() => togglePause(r)}
                            title={r.status === 'active' ? 'Pause' : 'Unpause'}
                            className="p-1.5 rounded-md hover:bg-muted"
                          >
                            {r.status === 'active' ? (
                              <Pause className="w-4 h-4" />
                            ) : (
                              <Play className="w-4 h-4" />
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(r)}
                          title="Edit"
                          className="p-1.5 rounded-md hover:bg-muted"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deleteSchedule(r)}
                          title="Delete"
                          className="p-1.5 rounded-md hover:bg-red-50 text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 relative">
            <button
              onClick={closeModal}
              className="absolute top-3 right-3 p-1 rounded-md hover:bg-gray-100"
            >
              <X className="w-4 h-4" />
            </button>
            <h2 className="text-lg font-bold mb-4">
              {editingId ? 'Edit Schedule' : 'New Recurring Schedule'}
            </h2>

            <div className="space-y-4">
              {!editingId && (
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide block mb-1">Client</label>
                  <select
                    value={form.clientId}
                    onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  >
                    <option value="">Select a client…</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs font-medium uppercase tracking-wide block mb-1">Frequency</label>
                <select
                  value={form.frequency}
                  onChange={(e) => setForm({ ...form, frequency: e.target.value as Frequency })}
                  className="w-full rounded-md border px-3 py-2 text-sm capitalize"
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium uppercase tracking-wide block mb-1">Next Due</label>
                <input
                  type="date"
                  value={form.nextDue}
                  onChange={(e) => setForm({ ...form, nextDue: e.target.value })}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-medium uppercase tracking-wide block mb-1">Description</label>
                <input
                  type="text"
                  placeholder="e.g. Monthly retainer"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-medium uppercase tracking-wide block mb-1">Amount (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="5000"
                  value={form.amountDollars}
                  onChange={(e) => setForm({ ...form, amountDollars: e.target.value })}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide block mb-1">Days to Pay</label>
                  <input
                    type="number"
                    min="1"
                    value={form.daysToPay}
                    onChange={(e) => setForm({ ...form, daysToPay: parseInt(e.target.value, 10) || 30 })}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.autoSend}
                      onChange={(e) => setForm({ ...form, autoSend: e.target.checked })}
                    />
                    Auto-send
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={closeModal}
                className="px-4 py-2 rounded-md text-sm font-medium border hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="px-4 py-2 rounded-md text-sm font-medium text-white"
                style={{ backgroundColor: 'var(--accent-emerald, #10b981)' }}
              >
                {submitting ? 'Saving…' : editingId ? 'Save changes' : 'Create schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RecurringInvoicesPage;
