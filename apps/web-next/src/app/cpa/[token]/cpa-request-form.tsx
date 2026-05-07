'use client';

import { useState } from 'react';

interface Props {
  token: string;
}

const ENTITY_TYPES = [
  { value: 'general', label: 'General question' },
  { value: 'AbExpense', label: 'About a specific expense' },
  { value: 'AbInvoice', label: 'About a specific invoice' },
  { value: 'AbMileageEntry', label: 'About a mileage entry' },
];

export function CpaRequestForm({ token }: Props) {
  const [entityType, setEntityType] = useState('general');
  const [entityId, setEntityId] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch(`/api/v1/cpa-portal/${token}/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType,
          entityId: entityType === 'general' ? null : entityId.trim() || null,
          message: message.trim(),
        }),
      });
      if (res.ok) {
        setResult({ ok: true, text: 'Sent — the owner has been notified.' });
        setMessage('');
        setEntityId('');
      } else {
        const j = await res.json().catch(() => ({}));
        setResult({ ok: false, text: j?.error || 'Could not send — try again.' });
      }
    } catch {
      setResult({ ok: false, text: 'Network error — try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: '12px', maxWidth: '600px' }}>
      <label style={{ display: 'grid', gap: '4px', fontSize: '13px' }}>
        <span style={{ color: '#374151' }}>Type</span>
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          style={{ padding: '8px', border: '1px solid #d1d5db', borderRadius: '6px' }}
        >
          {ENTITY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </label>

      {entityType !== 'general' && (
        <label style={{ display: 'grid', gap: '4px', fontSize: '13px' }}>
          <span style={{ color: '#374151' }}>Entity ID (optional)</span>
          <input
            type="text"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            placeholder="UUID of the row you're asking about"
            style={{ padding: '8px', border: '1px solid #d1d5db', borderRadius: '6px', fontFamily: 'monospace' }}
          />
        </label>
      )}

      <label style={{ display: 'grid', gap: '4px', fontSize: '13px' }}>
        <span style={{ color: '#374151' }}>Message</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. Need receipt for the AWS October bill"
          rows={4}
          maxLength={4000}
          style={{ padding: '8px', border: '1px solid #d1d5db', borderRadius: '6px', fontFamily: 'inherit' }}
          required
        />
      </label>

      <button
        type="submit"
        disabled={submitting || !message.trim()}
        style={{
          padding: '10px 16px',
          background: submitting ? '#9ca3af' : '#2563eb',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          fontWeight: 600,
          cursor: submitting ? 'wait' : 'pointer',
          width: 'fit-content',
        }}
      >
        {submitting ? 'Sending…' : 'Send to owner'}
      </button>

      {result && (
        <p style={{ fontSize: '13px', color: result.ok ? '#059669' : '#dc2626', margin: 0 }}>
          {result.text}
        </p>
      )}
    </form>
  );
}
