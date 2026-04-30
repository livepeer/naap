import React, { useState } from 'react';
import { Calculator, ArrowRight, DollarSign } from 'lucide-react';

const TAX_API = '/api/v1/agentbook-tax';

interface WhatIfResult {
  scenario: string;
  currentTaxCents: number;
  projectedTaxCents: number;
  savingsCents: number;
  explanation: string;
}

export const WhatIfPage: React.FC = () => {
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [loading, setLoading] = useState(false);

  const fmt = (cents: number) => `$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  const handleCalculate = async () => {
    if (!amount) return;
    setLoading(true);
    try {
      const amountCents = Math.round(parseFloat(amount) * 100);
      const changeAmount = type === 'expense' ? amountCents : -amountCents;
      const res = await fetch(`${TAX_API}/cashflow/scenario`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeAmountCents: changeAmount }),
      });
      const data = await res.json();
      if (data.success) setResult(data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="px-4 py-5 sm:p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Calculator className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">What If...?</h1>
      </div>

      <p className="text-muted-foreground mb-6">
        See how adding expenses or income would affect your tax liability.
      </p>

      <div className="bg-card border border-border rounded-xl p-5 mb-6">
        <div className="flex gap-3 mb-4">
          <button
            onClick={() => setType('expense')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${type === 'expense' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
          >
            Add Expense
          </button>
          <button
            onClick={() => setType('income')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${type === 'income' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
          >
            Add Income
          </button>
        </div>

        <div className="relative mb-4">
          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="Enter amount"
            className="w-full pl-9 pr-4 py-3 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary/50 text-lg"
          />
        </div>

        <button
          onClick={handleCalculate}
          disabled={!amount || loading}
          className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? 'Calculating...' : 'Calculate Tax Impact'}
        </button>
      </div>

      {result && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-medium mb-4">{result.scenario}</h3>

          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="text-center flex-1">
              <p className="text-xs text-muted-foreground">Current Tax</p>
              <p className="text-xl font-bold">{fmt(result.currentTaxCents)}</p>
            </div>
            <ArrowRight className="w-5 h-5 text-muted-foreground shrink-0" />
            <div className="text-center flex-1">
              <p className="text-xs text-muted-foreground">Projected Tax</p>
              <p className="text-xl font-bold">{fmt(result.projectedTaxCents)}</p>
            </div>
          </div>

          <div className={`p-4 rounded-lg text-center ${result.savingsCents > 0 ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500'}`}>
            <p className="text-2xl font-bold">{result.savingsCents > 0 ? '-' : '+'}{fmt(result.savingsCents)}</p>
            <p className="text-sm mt-1">{result.explanation}</p>
          </div>
        </div>
      )}
    </div>
  );
};
