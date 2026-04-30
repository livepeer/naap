/**
 * Public Invoice View — Client Portal
 *
 * Anyone with the invoice ID can view this page (no auth required).
 * Shows invoice details, line items, total, and a "Pay Now" button.
 */

const INVOICE_API = process.env.INVOICE_API_URL || 'http://localhost:4052';

interface InvoiceLine {
  description: string;
  quantity: number;
  rateCents: number;
  amountCents: number;
}

interface PublicInvoice {
  number: string;
  amountCents: number;
  currency: string;
  issuedDate: string;
  dueDate: string;
  status: string;
  paymentUrl?: string;
  clientName?: string;
  lines: InvoiceLine[];
}

function fmtMoney(cents: number, currency?: string): string {
  const symbols: Record<string, string> = { USD: '$', CAD: 'CA$', GBP: '\u00a3', EUR: '\u20ac', AUD: 'A$' };
  const sym = symbols[currency || 'USD'] || (currency || 'USD') + ' ';
  return `${sym}${(cents / 100).toFixed(2)}`;
}

function statusBadge(status: string) {
  const colors: Record<string, { bg: string; text: string }> = {
    draft: { bg: '#f1f5f9', text: '#64748b' },
    sent: { bg: '#dbeafe', text: '#2563eb' },
    viewed: { bg: '#e0e7ff', text: '#4338ca' },
    paid: { bg: '#d1fae5', text: '#059669' },
    overdue: { bg: '#fee2e2', text: '#dc2626' },
    void: { bg: '#f1f5f9', text: '#94a3b8' },
  };
  const c = colors[status] || colors.draft;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 14px',
        borderRadius: 12,
        fontSize: 13,
        fontWeight: 600,
        textTransform: 'uppercase',
        background: c.bg,
        color: c.text,
      }}
    >
      {status}
    </span>
  );
}

async function fetchInvoice(invoiceId: string): Promise<PublicInvoice | null> {
  try {
    const res = await fetch(`${INVOICE_API}/api/v1/agentbook-invoice/invoices/${invoiceId}/public`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body.success ? body.data : null;
  } catch {
    return null;
  }
}

export default async function PayInvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const invoice = await fetchInvoice(invoiceId);

  if (!invoice) {
    return (
      <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', maxWidth: 600, margin: '80px auto', textAlign: 'center', color: '#64748b' }}>
        <h1 style={{ fontSize: 28, fontWeight: 300, marginBottom: 8 }}>Invoice Not Found</h1>
        <p>This invoice may have been removed or the link is invalid.</p>
      </div>
    );
  }

  const currency = invoice.currency || 'USD';

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Invoice {invoice.number}</title>
      </head>
      <body style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: '#1a1a2e', margin: 0, padding: 0, background: '#f8fafc' }}>
        <div style={{ maxWidth: 700, margin: '40px auto', background: 'white', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ background: '#1a1a2e', color: 'white', padding: '32px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 300 }}>INVOICE</div>
              <div style={{ fontSize: 14, opacity: 0.8, marginTop: 4 }}>{invoice.number}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              {invoice.clientName && <div style={{ fontSize: 16, fontWeight: 500 }}>{invoice.clientName}</div>}
              <div style={{ marginTop: 8 }}>{statusBadge(invoice.status)}</div>
            </div>
          </div>

          {/* Details */}
          <div style={{ padding: '24px 40px', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0' }}>
            <div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: 1 }}>Issued</div>
              <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>{new Date(invoice.issuedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: 1 }}>Due Date</div>
              <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>{new Date(invoice.dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: 1 }}>Amount Due</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#10b981', marginTop: 4 }}>{fmtMoney(invoice.amountCents, currency)}</div>
            </div>
          </div>

          {/* Line Items */}
          {invoice.lines.length > 0 && (
            <div style={{ padding: '24px 40px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                    <th style={{ textAlign: 'left', padding: '8px 0', fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: 0.5 }}>Description</th>
                    <th style={{ textAlign: 'center', padding: '8px 0', fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', width: 60 }}>Qty</th>
                    <th style={{ textAlign: 'right', padding: '8px 0', fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', width: 100 }}>Rate</th>
                    <th style={{ textAlign: 'right', padding: '8px 0', fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', width: 100 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((line, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 0', fontSize: 14 }}>{line.description}</td>
                      <td style={{ textAlign: 'center', padding: '10px 0', fontSize: 14 }}>{line.quantity}</td>
                      <td style={{ textAlign: 'right', padding: '10px 0', fontSize: 14 }}>{fmtMoney(line.rateCents, currency)}</td>
                      <td style={{ textAlign: 'right', padding: '10px 0', fontSize: 14, fontWeight: 500 }}>{fmtMoney(line.amountCents, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Total */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <div style={{ background: '#10b981', color: 'white', padding: '12px 28px', borderRadius: 8, fontSize: 18, fontWeight: 700 }}>
                  Total: {fmtMoney(invoice.amountCents, currency)}
                </div>
              </div>
            </div>
          )}

          {/* Pay Button */}
          {invoice.paymentUrl && invoice.status !== 'paid' && (
            <div style={{ padding: '24px 40px 32px', textAlign: 'center' }}>
              <a
                href={invoice.paymentUrl}
                style={{
                  display: 'inline-block',
                  padding: '16px 40px',
                  background: '#10b981',
                  color: 'white',
                  textDecoration: 'none',
                  borderRadius: 8,
                  fontWeight: 'bold',
                  fontSize: 16,
                }}
              >
                Pay {fmtMoney(invoice.amountCents, currency)} Now
              </a>
              <p style={{ marginTop: 8, fontSize: 12, color: '#94a3b8' }}>Secure payment powered by Stripe</p>
            </div>
          )}

          {/* Footer */}
          <div style={{ borderTop: '1px solid #e2e8f0', padding: '20px 40px', textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>
            <p style={{ margin: 0 }}>Powered by AgentBook</p>
          </div>
        </div>
      </body>
    </html>
  );
}
