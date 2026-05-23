import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Check, Play, Loader2, X, AlertCircle } from 'lucide-react';
import { testPlanResultsEndpoint, type PlanResultsTestResponse } from '../lib/api';

interface EndpointGuideProps {
  planId: string;
}

function getBaseUrl() {
  return typeof globalThis.window !== 'undefined' ? globalThis.window.location.origin : '';
}

function formatResponseBody(body: unknown): string {
  if (body === null || body === undefined) {
    return '';
  }
  if (typeof body === 'string') {
    return body;
  }
  return JSON.stringify(body, null, 2);
}

function EndpointTestModal({
  result,
  error,
  onClose,
}: Readonly<{
  result: PlanResultsTestResponse | null;
  error: string | null;
  onClose: () => void;
}>) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return undefined;
    }
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const status = result?.status;
  const statusClass = result?.ok
    ? 'bg-accent-emerald/15 text-accent-emerald border-accent-emerald/30'
    : 'bg-accent-rose/15 text-accent-rose border-accent-rose/30';

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="endpoint-test-title"
      className="fixed inset-0 z-50 m-0 p-4 w-full max-w-none max-h-none bg-transparent backdrop:bg-black/60 open:flex open:items-center open:justify-center"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-bg-secondary border border-[var(--border-color)] rounded-xl shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2 min-w-0">
            <h2 id="endpoint-test-title" className="text-sm font-semibold text-text-primary">
              Discovery test response
            </h2>
            {status != null && (
              <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${statusClass}`}>
                HTTP {status}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-4">
          {error && (
            <div className="flex items-start gap-2 text-sm text-accent-rose mb-3">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}
          {result && (
            <pre className="text-[11px] font-mono text-text-secondary whitespace-pre-wrap break-all">
              {formatResponseBody(result.body) || '(empty response)'}
            </pre>
          )}
        </div>
      </div>
    </dialog>
  );
}

export const EndpointGuide: React.FC<EndpointGuideProps> = ({ planId }) => {
  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<PlanResultsTestResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const baseUrl = getBaseUrl();
  const endpoint = `${baseUrl}/api/v1/orchestrator-leaderboard/plans/${planId}/results`;
  const curlExample = `curl -s "${endpoint}"`;

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback ignored */ }
  };

  const closeModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  const runTest = async () => {
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const result = await testPlanResultsEndpoint(planId);
      setTestResult(result);
      setModalOpen(true);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Request failed');
      setModalOpen(true);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-muted">
        Uses your current browser session when you run Test.
      </p>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0 bg-bg-primary border border-[var(--border-color)] rounded-lg px-3 py-2">
          <pre className="text-[11px] text-accent-emerald font-mono flex-1 overflow-x-auto whitespace-nowrap">
            {curlExample}
          </pre>
          <button
            type="button"
            onClick={() => copyToClipboard(curlExample)}
            className="shrink-0 p-1 rounded hover:bg-bg-tertiary transition-colors"
            title="Copy curl command"
          >
            {copied ? (
              <Check size={13} className="text-accent-emerald" />
            ) : (
              <Copy size={13} className="text-text-muted" />
            )}
          </button>
        </div>
        <button
          type="button"
          onClick={runTest}
          disabled={testing}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-accent-emerald/40 bg-accent-emerald/10 text-accent-emerald hover:bg-accent-emerald/20 hover:border-accent-emerald/60 disabled:opacity-50 transition-colors"
        >
          {testing ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Play size={12} />
          )}
          Test
        </button>
      </div>

      {modalOpen && (
        <EndpointTestModal
          result={testResult}
          error={testError}
          onClose={closeModal}
        />
      )}
    </div>
  );
};
