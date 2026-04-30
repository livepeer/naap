import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Send, Save, ArrowLeft, Loader2 } from 'lucide-react';

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  rate: number;
}

interface Client {
  id: string;
  name: string;
  email?: string;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

const TERMS_OPTIONS = [
  { value: 'net-30', label: 'Net 30', days: 30 },
  { value: 'net-15', label: 'Net 15', days: 15 },
  { value: 'due-on-receipt', label: 'Due on Receipt', days: 0 },
];

const API = '/api/v1/agentbook-invoice';

export const NewInvoicePage: React.FC = () => {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [description, setDescription] = useState('');
  const [terms, setTerms] = useState('net-30');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: uid(), description: '', quantity: 1, rate: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Load existing clients
  useEffect(() => {
    fetch(`${API}/clients`).then(r => r.json()).then(d => {
      if (d.success) setClients(d.data || []);
    }).catch(() => {});
  }, []);

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
    setError('');
    try {
      // 1. Resolve clientId — use selected or create new
      let clientId = selectedClientId;
      if (!clientId && clientName.trim()) {
        const clientRes = await fetch(`${API}/clients`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: clientName.trim(), email: clientEmail.trim() || undefined }),
        });
        const clientData = await clientRes.json();
        if (!clientData.success) {
          setError(clientData.error || 'Failed to create client');
          return;
        }
        clientId = clientData.data.id;
      }

      if (!clientId) {
        setError('Please select a client or enter a new client name');
        return;
      }

      // Validate line items
      const validLines = lineItems.filter(li => li.description.trim() && li.rate > 0);
      if (validLines.length === 0) {
        setError('Add at least one line item with a description and rate');
        return;
      }

      // 2. Calculate due date from terms
      const termsDays = TERMS_OPTIONS.find(t => t.value === terms)?.days ?? 30;
      const issuedDate = new Date(invoiceDate);
      const dueDate = new Date(issuedDate);
      dueDate.setDate(dueDate.getDate() + termsDays);

      // 3. Create invoice — amounts in CENTS
      const res = await fetch(`${API}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          issuedDate: invoiceDate,
          dueDate: dueDate.toISOString().slice(0, 10),
          status,
          lines: validLines.map(({ description: desc, quantity, rate }) => ({
            description: desc,
            quantity,
            rateCents: Math.round(rate * 100),
          })),
        }),
      });

      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed to create invoice');
        return;
      }

      navigate('/');
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const fieldClass =
    'w-full px-3 py-2 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring';
  const fieldClassRight = `${fieldClass} text-right`;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button type="button" onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold text-foreground">
          New Invoice
        </h1>
      </div>

      <div className="space-y-6">
        {/* Client info */}
        <div className="rounded-xl p-4 sm:p-6 border border-border bg-card">
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-4 text-muted-foreground">
            Client Details
          </h2>
          {clients.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1 text-foreground">
                Select Existing Client
              </label>
              <select
                value={selectedClientId}
                onChange={(e) => { setSelectedClientId(e.target.value); if (e.target.value) { setClientName(''); setClientEmail(''); } }}
                className={fieldClass}
              >
                <option value="">— New client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.email ? ` (${c.email})` : ''}</option>)}
              </select>
            </div>
          )}
          {!selectedClientId && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-foreground">
                  Client Name
                </label>
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Enter client name"
                  className={fieldClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-foreground">
                  Client Email
                </label>
                <input
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="client@example.com"
                  className={fieldClass}
                />
              </div>
            </div>
          )}
        </div>

        {/* Invoice details */}
        <div className="rounded-xl p-4 sm:p-6 border border-border bg-card">
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-4 text-muted-foreground">
            Invoice Details
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-foreground">
                Invoice Date
              </label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-foreground">
                Terms
              </label>
              <select
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                className={fieldClass}
              >
                {TERMS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-1">
              <label className="block text-sm font-medium mb-1 text-foreground">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Project description"
                className={fieldClass}
              />
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="rounded-xl p-4 sm:p-6 border border-border bg-card">
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-4 text-muted-foreground">
            Line Items
          </h2>

          <div className="space-y-3">
            {/* Desktop header */}
            <div className="hidden sm:grid sm:grid-cols-12 gap-3 text-xs font-medium uppercase tracking-wide px-1 text-muted-foreground">
              <span className="col-span-5">Description</span>
              <span className="col-span-2 text-right">Qty</span>
              <span className="col-span-2 text-right">Rate</span>
              <span className="col-span-2 text-right">Amount</span>
              <span className="col-span-1" />
            </div>

            {lineItems.map((li) => (
              <div
                key={li.id}
                className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-3 rounded-lg bg-muted/40"
              >
                <div className="sm:col-span-5">
                  <label className="sm:hidden block text-xs font-medium mb-1 text-muted-foreground">
                    Description
                  </label>
                  <input
                    type="text"
                    value={li.description}
                    onChange={(e) => updateLineItem(li.id, 'description', e.target.value)}
                    placeholder="Item description"
                    className={fieldClass}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="sm:hidden block text-xs font-medium mb-1 text-muted-foreground">
                    Quantity
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={li.quantity}
                    onChange={(e) => updateLineItem(li.id, 'quantity', parseFloat(e.target.value) || 0)}
                    className={fieldClassRight}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="sm:hidden block text-xs font-medium mb-1 text-muted-foreground">
                    Rate
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={li.rate}
                    onChange={(e) => updateLineItem(li.id, 'rate', parseFloat(e.target.value) || 0)}
                    className={fieldClassRight}
                  />
                </div>
                <div className="sm:col-span-2 flex items-center justify-end">
                  <span className="font-semibold text-sm text-foreground">
                    {formatCurrency(li.quantity * li.rate)}
                  </span>
                </div>
                <div className="sm:col-span-1 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => removeLineItem(li.id)}
                    disabled={lineItems.length <= 1}
                    className="p-1.5 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-30"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addLineItem}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-muted text-primary"
          >
            <Plus className="w-4 h-4" />
            Add Line Item
          </button>
        </div>

        {/* Total + actions */}
        <div className="rounded-xl p-4 sm:p-6 border border-border bg-card">
          <div className="flex items-center justify-between mb-6">
            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Total
            </span>
            <span className="text-2xl font-bold text-foreground">
              {formatCurrency(total)}
            </span>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg text-sm text-destructive bg-destructive/10 border border-destructive/20">
              {error}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => handleSubmit('draft')}
              disabled={submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border border-border bg-background text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save as Draft
            </button>
            <button
              type="button"
              onClick={() => handleSubmit('sent')}
              disabled={submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
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
