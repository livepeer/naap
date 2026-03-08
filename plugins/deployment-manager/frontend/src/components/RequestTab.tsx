import React, { useState, useCallback } from 'react';
import { Play, Clock, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';

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
      const res = await apiFetch(`/deployments/${deploymentId}/invoke?timeout=60000`, {
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
      <div className="mb-4">
        <label className="text-xs font-medium text-muted-foreground block mb-1.5">
          POST Endpoint
        </label>
        <div className="px-3 py-2 bg-secondary border border-border rounded-md font-mono text-xs text-foreground break-all">
          {displayUrl}
        </div>
      </div>

      {/* Request body */}
      <div className="mb-4">
        <label className="text-xs font-medium text-muted-foreground block mb-1.5">
          Request Body (JSON)
        </label>
        <textarea
          value={requestBody}
          onChange={(e) => setRequestBody(e.target.value)}
          data-testid="request-body"
          className="w-full min-h-[120px] p-3 font-mono text-xs bg-zinc-900 dark:bg-zinc-950 text-zinc-100 border border-border rounded-md resize-y leading-relaxed box-border"
        />
      </div>

      {/* Run button */}
      <button
        onClick={handleRun}
        disabled={running || !endpointUrl}
        data-testid="run-request"
        className={`h-9 px-4 text-white border-none rounded-md flex items-center gap-2 text-sm font-medium mb-4 ${
          running ? 'bg-zinc-400 cursor-not-allowed' : 'bg-foreground cursor-pointer'
        }`}
      >
        <Play size={13} />
        {running ? 'Running...' : 'Run'}
      </button>

      {/* Error display */}
      {error && (
        <div className="px-4 py-3 mb-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 flex items-start gap-2 text-sm">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Response panel */}
      {result && (
        <div data-testid="response-panel" className="mb-4">
          <div className="flex gap-3 mb-2 text-sm items-center">
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                result.status >= 200 && result.status < 300
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                  : 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400'
              }`}
            >
              {result.status} {result.statusText}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock size={11} /> {result.responseTimeMs}ms
            </span>
          </div>
          <pre className="bg-zinc-900 dark:bg-zinc-950 text-zinc-100 font-mono text-xs p-3 rounded-lg max-h-[250px] overflow-y-auto m-0 leading-relaxed">
            {typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2)}
          </pre>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div>
          <h4 className="text-xs font-medium mb-2 text-muted-foreground">
            Recent Requests ({history.length})
          </h4>
          <div className="flex flex-col gap-1">
            {history.map((h) => (
              <div key={h.id} className="flex items-center gap-3 px-3 py-2 bg-secondary rounded-md text-xs">
                {h.status && h.status >= 200 && h.status < 300
                  ? <CheckCircle size={12} className="text-emerald-500" />
                  : <XCircle size={12} className="text-red-500" />
                }
                <span className="text-muted-foreground">{h.timestamp.toLocaleTimeString()}</span>
                <span className="font-medium text-foreground">
                  {h.status ? `${h.status}` : 'Error'}
                </span>
                <span className="text-muted-foreground">{h.responseTimeMs}ms</span>
                {h.error && <span className="text-red-500 text-xs truncate max-w-[200px]">{h.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
