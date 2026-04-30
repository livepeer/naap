import React, { useEffect, useState } from 'react';
import { Image, Upload } from 'lucide-react';

interface Expense {
  id: string;
  amountCents: number;
  description: string;
  date: string;
  receiptUrl: string | null;
}

const API_BASE = '/api/v1/agentbook-expense';

export const ReceiptsPage: React.FC = () => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/expenses?limit=100`)
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setExpenses(data.data.filter((e: Expense) => e.receiptUrl));
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Image className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Receipts</h1>
      </div>

      {/* Upload Zone */}
      <div className="border-2 border-dashed border-border rounded-xl p-8 mb-6 text-center hover:border-primary/50 transition-colors cursor-pointer">
        <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-muted-foreground">Drag and drop receipts here, or click to upload</p>
        <p className="text-xs text-muted-foreground mt-1">We'll extract amount, vendor, and date automatically</p>
      </div>

      {loading && <p className="text-muted-foreground">Loading receipts...</p>}

      {expenses.length === 0 && !loading && (
        <div className="text-center py-12 text-muted-foreground">
          <p>No receipts uploaded yet. Send a photo via Telegram or upload above!</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {expenses.map(expense => (
          <div key={expense.id} className="bg-card border border-border rounded-lg overflow-hidden hover:border-primary/30 transition-colors">
            <div className="aspect-[3/4] bg-muted">
              {expense.receiptUrl && <img src={expense.receiptUrl} alt="Receipt" className="w-full h-full object-cover" />}
            </div>
            <div className="p-3">
              <p className="font-mono font-bold">{fmt(expense.amountCents)}</p>
              <p className="text-xs text-muted-foreground truncate">{expense.description}</p>
              <p className="text-xs text-muted-foreground">{new Date(expense.date).toLocaleDateString()}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
