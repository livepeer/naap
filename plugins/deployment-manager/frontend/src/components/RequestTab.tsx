import React, { useState, useCallback } from 'react';
import { Play, Clock, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

interface RequestTabProps {
  deploymentId: string;
  endpointUrl?: string;
  providerSlug: string;
}

interface InvokeResult {
  status: number;
  statusText: string;
  responseTimeMs: number;
  body: unknown;
}

interface HistoryEntry {
  id: string;
  timestamp: Date;
  status: number | null;
  responseTimeMs: number;
  error?: string;
  body?: unknown;
}

const API_BASE = '/api/v1/deployment-manager';

function getDisplayUrl(endpointUrl: string | undefined, providerSlug: string): string {
  if (!endpointUrl) return 'No endpoint URL';
  if (providerSlug === 'runpod') return `${endpointUrl}/run`;
  return endpointUrl;
}

const DEFAULT_BODY = JSON.stringify({ input: { prompt: "Hello, world!" } }, null, 2);

export const RequestTab: React.FC<RequestTabProps> = ({ deploymentId, endpointUrl, providerSlug }) => {
  const [requestBody, setRequestBody] = useState(DEFAULT_BODY);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<InvokeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setResult(null);
    setError(null);

    try {
      JSON.parse(requestBody);
    } catch {
      setError('Invalid JSON in request body');
      setRunning(false);
      return;
    }

    const start = Date.now();
    try {
      const res = await fetch(`${API_BASE}/deployments/${deploymentId}/invoke?timeout=60000`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });
      const data = await res.json();
      const elapsed = Date.now() - start;

      if (data.success) {
        setResult(data.data);
        setHistory(prev => [{
          id: crypto.randomUUID(), timestamp: new Date(),
          status: data.data.status, responseTimeMs: data.data.responseTimeMs,
          body: data.data.body,
        }, ...prev].slice(0, 10));
      } else {
        setError(data.error || 'Request failed');
        setHistory(prev => [{
          id: crypto.randomUUID(), timestamp: new Date(),
          status: null, responseTimeMs: elapsed, error: data.error,
        }, ...prev].slice(0, 10));
      }
    } catch (err: any) {
      setError(err.message);
      setHistory(prev => [{
        id: crypto.randomUUID(), timestamp: new Date(),
        status: null, responseTimeMs: Date.now() - start, error: err.message,
      }, ...prev].slice(0, 10));
    }
    setRunning(false);
  }, [deploymentId, requestBody]);

  const displayUrl = getDisplayUrl(endpointUrl, providerSlug);

  return (
    <div>
      {/* URL display */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--dm-text-tertiary)', display: 'block', marginBottom: '0.25rem' }}>
          POST Endpoint
        </label>
        <div style={{
          padding: '0.5rem 0.75rem', background: 'var(--dm-bg-secondary)',
          border: '1px solid var(--dm-border)', borderRadius: '0.375rem',
          fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--dm-text-primary)',
          wordBreak: 'break-all',
        }}>
          {displayUrl}
        </div>
      </div>

      {/* Request body */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--dm-text-tertiary)', display: 'block', marginBottom: '0.25rem' }}>
          Request Body (JSON)
        </label>
        <textarea
          value={requestBody}
          onChange={(e) => setRequestBody(e.target.value)}
          data-testid="request-body"
          style={{
            width: '100%', minHeight: '120px', padding: '0.75rem',
            fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem',
            background: '#111827', color: '#e5e7eb',
            border: '1px solid var(--dm-border)', borderRadius: '0.375rem',
            resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Run button */}
      <button
        onClick={handleRun}
        disabled={running || !endpointUrl}
        data-testid="run-request"
        style={{
          padding: '0.5rem 1.25rem',
          background: running ? '#6b7280' : 'var(--dm-accent-blue)',
          color: '#fff', border: 'none', borderRadius: '0.375rem',
          cursor: running ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          fontSize: '0.875rem', fontWeight: 500, marginBottom: '1rem',
        }}
      >
        <Play size={14} />
        {running ? 'Running...' : 'Run'}
      </button>

      {/* Error display */}
      {error && (
        <div style={{
          padding: '0.75rem', marginBottom: '1rem',
          background: '#fef2f2', border: '1px solid #fca5a5',
          borderRadius: '0.375rem', color: '#dc2626',
          display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.8rem',
        }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
          {error}
        </div>
      )}

      {/* Response panel */}
      {result && (
        <div data-testid="response-panel" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', fontSize: '0.8rem' }}>
            <span style={{
              padding: '0.2rem 0.5rem', borderRadius: '0.25rem', fontWeight: 600,
              background: result.status >= 200 && result.status < 300 ? '#dcfce7' : '#fef2f2',
              color: result.status >= 200 && result.status < 300 ? '#166534' : '#dc2626',
            }}>
              {result.status} {result.statusText}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--dm-text-secondary)' }}>
              <Clock size={12} /> {result.responseTimeMs}ms
            </span>
          </div>
          <pre style={{
            background: '#111827', color: '#e5e7eb',
            fontFamily: 'ui-monospace, monospace', fontSize: '0.7rem',
            padding: '0.75rem', borderRadius: '0.375rem',
            maxHeight: '250px', overflowY: 'auto', margin: 0, lineHeight: 1.6,
          }}>
            {typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2)}
          </pre>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div>
          <h4 style={{ fontSize: '0.8rem', fontWeight: 600, margin: '0 0 0.5rem', color: 'var(--dm-text-secondary)' }}>
            Recent Requests ({history.length})
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {history.map((h) => (
              <div key={h.id} style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.4rem 0.5rem', background: 'var(--dm-bg-secondary)',
                borderRadius: '0.25rem', fontSize: '0.75rem',
              }}>
                {h.status && h.status >= 200 && h.status < 300
                  ? <CheckCircle size={12} color="#22c55e" />
                  : <XCircle size={12} color="#ef4444" />
                }
                <span style={{ color: 'var(--dm-text-secondary)' }}>{h.timestamp.toLocaleTimeString()}</span>
                <span style={{ fontWeight: 500, color: 'var(--dm-text-primary)' }}>
                  {h.status ? `${h.status}` : 'Error'}
                </span>
                <span style={{ color: 'var(--dm-text-tertiary)' }}>{h.responseTimeMs}ms</span>
                {h.error && <span style={{ color: '#ef4444', fontSize: '0.7rem' }}>{h.error.substring(0, 50)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
