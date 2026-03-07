import React, { useState, useCallback, useEffect } from 'react';
import { Play, Clock, AlertTriangle, CheckCircle, XCircle, Activity } from 'lucide-react';

const API_BASE = '/api/v1/deployment-manager';

interface PipelineStatus {
  capabilityName: string;
  topology: string;
  adapterHealthy: boolean;
  deploymentStatus: string;
  healthStatus: string;
  endpointUrl: string | null;
  orchestratorSecret?: string;
}

interface InvokeResult {
  status: number;
  statusText: string;
  responseTimeMs: number;
  body: unknown;
}

interface InferencePlaygroundProps {
  deploymentId: string;
  endpointUrl?: string;
}

const DEFAULT_INFERENCE_BODY = JSON.stringify({
  input: {
    prompt: "A beautiful sunset over mountains",
  },
}, null, 2);

export const InferencePlayground: React.FC<InferencePlaygroundProps> = ({ deploymentId, endpointUrl }) => {
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(null);
  const [loadingPipeline, setLoadingPipeline] = useState(true);
  const [requestBody, setRequestBody] = useState(DEFAULT_INFERENCE_BODY);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<InvokeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPipeline = async () => {
      try {
        const res = await fetch(`${API_BASE}/deployments/${deploymentId}/pipeline-status`);
        const data = await res.json();
        if (data.success) setPipelineStatus(data.data);
      } catch { /* ignore */ }
      setLoadingPipeline(false);
    };
    fetchPipeline();
  }, [deploymentId]);

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

    try {
      const res = await fetch(`${API_BASE}/deployments/${deploymentId}/invoke?timeout=60000`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });
      const data = await res.json();

      if (data.success) {
        setResult(data.data);
      } else {
        setError(data.error || 'Request failed');
      }
    } catch (err: any) {
      setError(err.message);
    }
    setRunning(false);
  }, [deploymentId, requestBody]);

  if (loadingPipeline) {
    return <p style={{ color: 'var(--dm-text-secondary)', fontSize: '0.875rem' }}>Loading pipeline status...</p>;
  }

  return (
    <div>
      {/* Pipeline status card */}
      {pipelineStatus && (
        <div data-testid="pipeline-status" style={{
          padding: '1rem',
          background: 'var(--dm-bg-secondary)',
          borderRadius: '0.5rem',
          marginBottom: '1.5rem',
        }}>
          <h4 style={{ fontSize: '0.9rem', fontWeight: 600, margin: '0 0 0.75rem', color: 'var(--dm-text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={16} /> Pipeline Status
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.8rem' }}>
            <div>
              <span style={{ color: 'var(--dm-text-tertiary)' }}>Capability:</span>{' '}
              <strong style={{ color: 'var(--dm-text-primary)' }}>{pipelineStatus.capabilityName}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--dm-text-tertiary)' }}>Topology:</span>{' '}
              <strong style={{ color: 'var(--dm-text-primary)' }}>{pipelineStatus.topology}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--dm-text-tertiary)' }}>Adapter:</span>{' '}
              {pipelineStatus.adapterHealthy
                ? <span style={{ color: '#16a34a', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><CheckCircle size={12} /> Healthy</span>
                : <span style={{ color: '#dc2626', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><XCircle size={12} /> Unhealthy</span>
              }
            </div>
            <div>
              <span style={{ color: 'var(--dm-text-tertiary)' }}>Secret:</span>{' '}
              <span style={{ color: 'var(--dm-text-secondary)' }}>{pipelineStatus.orchestratorSecret || 'N/A'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Endpoint display */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--dm-text-tertiary)', display: 'block', marginBottom: '0.25rem' }}>
          Inference Endpoint
        </label>
        <div style={{
          padding: '0.5rem 0.75rem',
          background: 'var(--dm-bg-secondary)',
          border: '1px solid var(--dm-border)',
          borderRadius: '0.375rem',
          fontFamily: 'monospace',
          fontSize: '0.8rem',
          color: 'var(--dm-text-primary)',
          wordBreak: 'break-all',
        }}>
          {endpointUrl || 'No endpoint URL'}
        </div>
      </div>

      {/* Request body */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--dm-text-tertiary)', display: 'block', marginBottom: '0.25rem' }}>
          Inference Request (JSON)
        </label>
        <textarea
          value={requestBody}
          onChange={(e) => setRequestBody(e.target.value)}
          data-testid="inference-request-body"
          style={{
            width: '100%',
            minHeight: '120px',
            padding: '0.75rem',
            fontFamily: 'ui-monospace, monospace',
            fontSize: '0.75rem',
            background: '#111827',
            color: '#e5e7eb',
            border: '1px solid var(--dm-border)',
            borderRadius: '0.375rem',
            resize: 'vertical',
            lineHeight: 1.6,
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Run button */}
      <button
        onClick={handleRun}
        disabled={running || !endpointUrl}
        data-testid="run-inference"
        style={{
          padding: '0.5rem 1.25rem',
          background: running ? '#6b7280' : '#8b5cf6',
          color: '#fff',
          border: 'none',
          borderRadius: '0.375rem',
          cursor: running ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.875rem',
          fontWeight: 500,
          marginBottom: '1rem',
        }}
      >
        <Play size={14} />
        {running ? 'Running Inference...' : 'Run Inference'}
      </button>

      {/* Error */}
      {error && (
        <div style={{
          padding: '0.75rem',
          marginBottom: '1rem',
          background: '#fef2f2',
          border: '1px solid #fca5a5',
          borderRadius: '0.375rem',
          color: '#dc2626',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.5rem',
          fontSize: '0.8rem',
        }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
          {error}
        </div>
      )}

      {/* Response */}
      {result && (
        <div data-testid="inference-response" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', fontSize: '0.8rem' }}>
            <span style={{
              padding: '0.2rem 0.5rem',
              borderRadius: '0.25rem',
              fontWeight: 600,
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
            background: '#111827',
            color: '#e5e7eb',
            fontFamily: 'ui-monospace, monospace',
            fontSize: '0.7rem',
            padding: '0.75rem',
            borderRadius: '0.375rem',
            maxHeight: '300px',
            overflowY: 'auto',
            margin: 0,
            lineHeight: 1.6,
          }}>
            {typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
