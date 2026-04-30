import React, { useState } from 'react';
import { Upload, DollarSign, Tag, Calendar as CalendarIcon } from 'lucide-react';

const API_BASE = '/api/v1/agentbook-expense';

export const NewExpensePage: React.FC = () => {
  const [amount, setAmount] = useState('');
  const [vendor, setVendor] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [isPersonal, setIsPersonal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountCents: Math.round(parseFloat(amount) * 100),
          vendor: vendor || undefined,
          description: description || vendor || 'Expense',
          date,
          isPersonal,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess(true);
        setAmount(''); setVendor(''); setDescription('');
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Record Expense</h1>

      {success && (
        <div className="bg-green-500/10 text-green-500 p-4 rounded-lg mb-6">Expense recorded successfully!</div>
      )}

      {/* Receipt Upload Zone */}
      <div className="border-2 border-dashed border-border rounded-xl p-8 mb-6 text-center hover:border-primary/50 transition-colors cursor-pointer">
        <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-muted-foreground">Drag and drop a receipt, or click to upload</p>
        <p className="text-xs text-muted-foreground mt-1">JPG, PNG, PDF — we'll extract the details automatically</p>
      </div>

      <div className="text-center text-muted-foreground text-sm mb-6">— or enter manually —</div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Amount *</label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input type="number" step="0.01" min="0.01" required value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary" placeholder="0.00" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Vendor</label>
          <input type="text" value={vendor} onChange={e => setVendor(e.target.value)}
            className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary/50" placeholder="e.g., Starbucks, Amazon" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <input type="text" value={description} onChange={e => setDescription(e.target.value)}
            className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary/50" placeholder="What was this for?" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary/50" />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={isPersonal} onChange={e => setIsPersonal(e.target.checked)} className="rounded" />
          <span className="text-sm">This is a personal expense</span>
        </label>

        <button type="submit" disabled={submitting || !amount}
          className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
          {submitting ? 'Recording...' : 'Record Expense'}
        </button>
      </form>
    </div>
  );
};
