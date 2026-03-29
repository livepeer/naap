import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Receipt, Search, Filter } from 'lucide-react';

interface Expense {
  id: string;
  amountCents: number;
  description: string;
  date: string;
  categoryId: string | null;
  vendorId: string | null;
  receiptUrl: string | null;
  confidence: number | null;
  isPersonal: boolean;
}

const API_BASE = '/api/v1/agentbook-expense';

export const ExpenseListPage: React.FC = () => {
  const navigate = useNavigate();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'business' | 'personal'>('all');

  useEffect(() => {
    const params = filter === 'all' ? '' : `?isPersonal=${filter === 'personal'}`;
    fetch(`${API_BASE}/expenses${params}`)
      .then(r => r.json())
      .then(data => { if (data.success) setExpenses(data.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filter]);

  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const total = expenses.reduce((s, e) => s + e.amountCents, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Receipt className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Expenses</h1>
        </div>
        <button onClick={() => navigate('/new')} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
          + Record Expense
        </button>
      </div>

      {/* Filter + Summary */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {(['all', 'business', 'personal'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-sm capitalize transition-colors ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
              {f}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted-foreground">Total: <strong className="text-foreground">{fmt(total)}</strong> ({expenses.length} expenses)</span>
      </div>

      {loading && <p className="text-muted-foreground">Loading expenses...</p>}

      {expenses.length === 0 && !loading && (
        <div className="text-center py-16 text-muted-foreground">
          <Receipt className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg mb-2">No expenses recorded yet</p>
          <p className="text-sm">Send a receipt photo via Telegram, or click "Record Expense" above.</p>
        </div>
      )}

      <div className="space-y-2">
        {expenses.map(expense => (
          <div key={expense.id} className="bg-card border border-border rounded-lg p-4 flex items-center justify-between hover:border-primary/30 transition-colors">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                {expense.receiptUrl ? (
                  <img src={expense.receiptUrl} alt="" className="w-10 h-10 rounded-lg object-cover" />
                ) : (
                  <Receipt className="w-5 h-5 text-muted-foreground" />
                )}
              </div>
              <div>
                <p className="font-medium">{expense.description}</p>
                <p className="text-sm text-muted-foreground">{fmtDate(expense.date)}{expense.isPersonal && ' · Personal'}</p>
              </div>
            </div>
            <div className="text-right">
              <p className={`font-bold font-mono ${expense.isPersonal ? 'text-muted-foreground' : 'text-foreground'}`}>{fmt(expense.amountCents)}</p>
              {expense.confidence !== null && expense.confidence < 0.8 && (
                <p className="text-xs text-amber-500">Low confidence</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
