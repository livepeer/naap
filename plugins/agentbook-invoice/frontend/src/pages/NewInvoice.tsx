import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Send, Save, ArrowLeft, Loader2 } from 'lucide-react';

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  rate: number;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

const TERMS_OPTIONS = [
  { value: 'net-30', label: 'Net 30' },
  { value: 'net-15', label: 'Net 15' },
  { value: 'due-on-receipt', label: 'Due on Receipt' },
];

export const NewInvoicePage: React.FC = () => {
  const navigate = useNavigate();
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [description, setDescription] = useState('');
  const [terms, setTerms] = useState('net-30');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: uid(), description: '', quantity: 1, rate: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const addLineItem = () => {
    setLineItems((prev) => [...prev, { id: uid(), description: '', quantity: 1, rate: 0 }]);
  };

  const removeLineItem = (id: string) => {
    if (lineItems.length <= 1) return;
    setLineItems((prev) => prev.filter((li) => li.id !== id));
  };

  const updateLineItem = (id: string, field: keyof LineItem, value: string | number) => {
    setLineItems((prev) =>
      prev.map((li) => (li.id === id ? { ...li, [field]: value } : li))
    );
  };

  const total = lineItems.reduce((sum, li) => sum + li.quantity * li.rate, 0);

  const handleSubmit = async (status: 'draft' | 'sent') => {
    setSubmitting(true);
    try {
      await fetch('/api/v1/agentbook-invoice/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: clientName,
          client_email: clientEmail,
          description,
          terms,
          invoice_date: invoiceDate,
          status,
          line_items: lineItems.map(({ description: desc, quantity, rate }) => ({
            description: desc,
            quantity,
            rate,
            amount: quantity * rate,
          })),
          total,
        }),
      });
      navigate('/');
    } catch {
      // silently fail for now
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-primary, #fff)',
    borderColor: 'var(--border-primary, #e5e7eb)',
    color: 'var(--text-primary)',
  };

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
          <ArrowLeft className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
        </button>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          New Invoice
        </h1>
      </div>

      <div className="space-y-6">
        {/* Client info */}
        <div
          className="rounded-xl p-4 sm:p-6 border"
          style={{ backgroundColor: 'var(--bg-primary, #fff)', borderColor: 'var(--border-primary, #e5e7eb)' }}
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--text-secondary)' }}>
            Client Details
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                Client Name
              </label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Enter client name"
                className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                Client Email
              </label>
              <input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                placeholder="client@example.com"
                className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                style={inputStyle}
              />
            </div>
          </div>
        </div>

        {/* Invoice details */}
        <div
          className="rounded-xl p-4 sm:p-6 border"
          style={{ backgroundColor: 'var(--bg-primary, #fff)', borderColor: 'var(--border-primary, #e5e7eb)' }}
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--text-secondary)' }}>
            Invoice Details
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                Invoice Date
              </label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                Terms
              </label>
              <select
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                style={inputStyle}
              >
                {TERMS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-1">
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Project description"
                className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                style={inputStyle}
              />
            </div>
          </div>
        </div>

        {/* Line items */}
        <div
          className="rounded-xl p-4 sm:p-6 border"
          style={{ backgroundColor: 'var(--bg-primary, #fff)', borderColor: 'var(--border-primary, #e5e7eb)' }}
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--text-secondary)' }}>
            Line Items
          </h2>

          <div className="space-y-3">
            {/* Desktop header */}
            <div className="hidden sm:grid sm:grid-cols-12 gap-3 text-xs font-medium uppercase tracking-wide px-1"
              style={{ color: 'var(--text-secondary)' }}
            >
              <span className="col-span-5">Description</span>
              <span className="col-span-2 text-right">Qty</span>
              <span className="col-span-2 text-right">Rate</span>
              <span className="col-span-2 text-right">Amount</span>
              <span className="col-span-1" />
            </div>

            {lineItems.map((li) => (
              <div
                key={li.id}
                className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-3 rounded-lg"
                style={{ backgroundColor: 'var(--bg-secondary, #f9fafb)' }}
              >
                <div className="sm:col-span-5">
                  <label className="sm:hidden block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Description
                  </label>
                  <input
                    type="text"
                    value={li.description}
                    onChange={(e) => updateLineItem(li.id, 'description', e.target.value)}
                    placeholder="Item description"
                    className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    style={inputStyle}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="sm:hidden block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Quantity
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={li.quantity}
                    onChange={(e) => updateLineItem(li.id, 'quantity', parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 rounded-lg border text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    style={inputStyle}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="sm:hidden block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Rate
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={li.rate}
                    onChange={(e) => updateLineItem(li.id, 'rate', parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 rounded-lg border text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    style={inputStyle}
                  />
                </div>
                <div className="sm:col-span-2 flex items-center justify-end">
                  <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                    {formatCurrency(li.quantity * li.rate)}
                  </span>
                </div>
                <div className="sm:col-span-1 flex items-center justify-end">
                  <button
                    onClick={() => removeLineItem(li.id)}
                    disabled={lineItems.length <= 1}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-30"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={addLineItem}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-gray-100"
            style={{ color: 'var(--accent-emerald, #10b981)' }}
          >
            <Plus className="w-4 h-4" />
            Add Line Item
          </button>
        </div>

        {/* Total + actions */}
        <div
          className="rounded-xl p-4 sm:p-6 border"
          style={{ backgroundColor: 'var(--bg-primary, #fff)', borderColor: 'var(--border-primary, #e5e7eb)' }}
        >
          <div className="flex items-center justify-between mb-6">
            <span className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
              Total
            </span>
            <span className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {formatCurrency(total)}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => handleSubmit('draft')}
              disabled={submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors hover:bg-gray-50 disabled:opacity-50"
              style={{ borderColor: 'var(--border-primary, #e5e7eb)', color: 'var(--text-primary)' }}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save as Draft
            </button>
            <button
              onClick={() => handleSubmit('sent')}
              disabled={submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent-emerald, #10b981)' }}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Create &amp; Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewInvoicePage;
