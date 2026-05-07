import React, { useEffect, useState } from 'react';
import { Target, Plus, X, Trash2, Pencil } from 'lucide-react';

const API = '/api/v1/agentbook-expense';

interface BudgetRow {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  amountCents: number;
  period: string;
  alertPercent: number;
  spentCents: number;
  percent: number;
}

interface Category {
  id: string;
  name: string;
  code: string;
}

const fmt$ = (cents: number) =>
  '$' + (cents / 100).toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });

function barColor(percent: number): string {
  if (percent >= 100) return 'bg-red-500';
  if (percent >= 80) return 'bg-yellow-500';
  return 'bg-green-500';
}

function periodLabel(period: string): string {
  if (period === 'annual') return 'per year';
  if (period === 'quarterly') return 'per quarter';
  return 'per month';
}

export const BudgetsPage: React.FC = () => {
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [period, setPeriod] = useState<'monthly' | 'quarterly' | 'annual'>('monthly');

  const load = async () => {
    try {
      const [budgetsRes, catRes] = await Promise.all([
        fetch(`${API}/budgets/status`).then((r) => r.json()),
        fetch(`/api/v1/agentbook-core/accounts?type=expense`).then((r) => r.json()).catch(() => ({ data: [] })),
      ]);
      if (budgetsRes.success && budgetsRes.data) {
        setBudgets(budgetsRes.data.budgets || []);
      }
      if (catRes?.data) setCategories(catRes.data);
    } catch (err) {
      console.warn('[budgets] load failed:', err);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setAmount('');
    setCategoryId('');
    setCategoryName('');
    setPeriod('monthly');
    setEditingId(null);
    setFormError(null);
  };

  const openNew = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (b: BudgetRow) => {
    setEditingId(b.id);
    setAmount(((b.amountCents || 0) / 100).toString());
    setCategoryId(b.categoryId || '');
    setCategoryName(b.categoryName || '');
    setPeriod(
      b.period === 'quarterly' || b.period === 'annual' ? b.period : 'monthly',
    );
    setShowForm(true);
    setFormError(null);
  };

  const submit = async () => {
    setSubmitting(true);
    setFormError(null);
    try {
      const v = parseFloat(amount);
      if (!isFinite(v) || v <= 0) {
        setFormError('Amount has to be a positive number.');
        setSubmitting(false);
        return;
      }
      if (!categoryId && !categoryName.trim()) {
        setFormError('Pick a category or give it a name.');
        setSubmitting(false);
        return;
      }
      const amountCents = Math.round(v * 100);
      let resolvedName = categoryName.trim();
      if (!resolvedName && categoryId) {
        const c = categories.find((x) => x.id === categoryId);
        if (c) resolvedName = c.name;
      }

      let res: Response;
      if (editingId) {
        res = await fetch(`${API}/budgets/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amountCents, categoryName: resolvedName }),
        });
      } else {
        res = await fetch(`${API}/budgets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amountCents,
            categoryId: categoryId || undefined,
            categoryName: resolvedName,
            period,
          }),
        });
      }
      const j = await res.json();
      if (!res.ok || !j.success) {
        setFormError(j.error || 'Failed to save budget.');
        setSubmitting(false);
        return;
      }
      resetForm();
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this budget? Past spending stays on the books.')) return;
    try {
      const res = await fetch(`${API}/budgets/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || 'Delete failed.');
        return;
      }
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="px-4 py-5 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Target className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Budgets</h1>
        </div>
        <button
          onClick={openNew}
          className="px-3 py-2 text-sm rounded-lg bg-primary text-primary-foreground inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New Budget
        </button>
      </div>

      {showForm && (
        <div className="bg-card border border-border rounded-xl p-4 mb-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">{editingId ? 'Edit budget' : 'New budget'}</h2>
            <button
              onClick={() => { setShowForm(false); resetForm(); }}
              className="p-1 rounded hover:bg-muted/50"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Limit (USD)</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="200"
                className="w-full p-2 border border-border rounded-lg bg-background"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Period</label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as 'monthly' | 'quarterly' | 'annual')}
                disabled={!!editingId}
                className="w-full p-2 border border-border rounded-lg bg-background disabled:opacity-50"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Category (optional)</label>
              <select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  if (e.target.value) {
                    const c = categories.find((x) => x.id === e.target.value);
                    if (c) setCategoryName(c.name);
                  }
                }}
                disabled={!!editingId}
                className="w-full p-2 border border-border rounded-lg bg-background disabled:opacity-50"
              >
                <option value="">— None / Total —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Display name</label>
              <input
                type="text"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="Meals"
                className="w-full p-2 border border-border rounded-lg bg-background"
              />
            </div>
          </div>
          {formError && <p className="text-sm text-red-500">{formError}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowForm(false); resetForm(); }}
              className="px-3 py-2 text-sm rounded-lg border border-border"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={submitting}
              className="px-3 py-2 text-sm rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
            >
              {submitting ? 'Saving…' : editingId ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {budgets.length === 0 ? (
        <div className="text-sm text-muted-foreground bg-card border border-border rounded-xl p-6 text-center">
          No budgets yet. Tap <b>+ New Budget</b> or tell the bot:
          <br />
          <code className="text-xs">max $200 on meals each month</code>
        </div>
      ) : (
        <div className="space-y-3">
          {budgets.map((b) => (
            <div
              key={b.id}
              className="bg-card border border-border rounded-xl p-4"
              data-testid={`budget-row-${b.id}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-medium">{b.categoryName || 'Total'}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmt$(b.spentCents)} / {fmt$(b.amountCents)} {periodLabel(b.period)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openEdit(b)}
                    className="p-2 rounded hover:bg-muted/50"
                    title="Edit"
                    aria-label="Edit budget"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => remove(b.id)}
                    className="p-2 rounded hover:bg-muted/50 text-red-500"
                    title="Delete"
                    aria-label="Delete budget"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${barColor(b.percent)} transition-all`}
                  style={{ width: `${Math.min(100, b.percent)}%` }}
                  data-testid={`budget-bar-${b.id}`}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {b.percent}% used
                {b.percent >= 100 && <span className="ml-2 text-red-500 font-medium">⚠ over budget</span>}
                {b.percent >= 80 && b.percent < 100 && <span className="ml-2 text-yellow-600 font-medium">🟡 nearing cap</span>}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
