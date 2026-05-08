/**
 * Admin: Webhook Dead-Letter queue (PR 23).
 *
 * When a Telegram update can't be processed even after exponential
 * backoff (LLM timeout, DB blip), the webhook writes the full Update
 * payload to `AbWebhookDeadLetter` and 200s back to Telegram so it
 * stops retrying its own queue. This page shows open rows, lets an
 * admin inspect the payload + last error, and triggers a manual
 * replay against the local webhook (idempotency keys keep the replay
 * safe).
 *
 * Tenant-scoped — the API only returns this tenant's rows + orphans
 * (rows whose tenant resolution failed at webhook time).
 */

import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, RefreshCw, Loader2, Check, ChevronDown, ChevronRight } from 'lucide-react';

const API = '/api/v1/agentbook-core';

interface DeadLetterRow {
  id: string;
  tenantId: string | null;
  payload: unknown;
  error: string;
  attempts: number;
  attemptedAt: string;
  resolvedAt: string | null;
  createdAt: string;
}

export const DeadLetterPage: React.FC = () => {
  const [rows, setRows] = useState<DeadLetterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [replaying, setReplaying] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/dead-letter${showAll ? '?status=all' : ''}`);
      const d = await res.json();
      if (d.success) {
        setRows(d.data);
      } else {
        setError(d.error ?? 'failed to load');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [showAll]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const replay = async (id: string) => {
    setReplaying(id);
    try {
      const res = await fetch(`${API}/dead-letter/${id}/replay`, { method: 'POST' });
      const d = await res.json();
      if (d.success) {
        // Drop the resolved row from the open list; keep it visible if
        // we're showing all rows.
        if (showAll) {
          await load();
        } else {
          setRows((prev) => prev.filter((r) => r.id !== id));
        }
      } else {
        setError(d.error ?? d.data?.error ?? 'replay failed');
        // Pull fresh state — attempts/error fields will have changed.
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReplaying(null);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <AlertTriangle className="w-6 h-6 text-orange-500" />
        <h1 className="text-2xl font-semibold">Webhook Dead-Letter Queue</h1>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        Telegram updates that failed every retry attempt land here. Tap{' '}
        <span className="font-mono">Replay</span> to send the original payload
        back through the webhook — idempotency keys keep it safe.
      </p>

      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={load}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded"
          disabled={loading}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          Include resolved
        </label>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-gray-500">
          <Check className="w-8 h-8 mx-auto mb-2 text-green-500" />
          No dead-lettered messages.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const isOpen = expanded.has(row.id);
            const isResolved = !!row.resolvedAt;
            return (
              <div
                key={row.id}
                className={`border rounded ${isResolved ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}
              >
                <div className="flex items-start gap-3 p-3">
                  <button
                    onClick={() => toggleExpand(row.id)}
                    className="mt-0.5 text-gray-500 hover:text-gray-700"
                    aria-label={isOpen ? 'Collapse' : 'Expand'}
                  >
                    {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono text-xs text-gray-500">{row.id.slice(0, 8)}</span>
                      <span className="text-gray-400">·</span>
                      <span className="text-gray-600">attempts: {row.attempts}</span>
                      <span className="text-gray-400">·</span>
                      <span className="text-gray-600">{new Date(row.createdAt).toLocaleString()}</span>
                      {isResolved && (
                        <>
                          <span className="text-gray-400">·</span>
                          <span className="text-green-700 text-xs px-1.5 py-0.5 bg-green-100 rounded">resolved</span>
                        </>
                      )}
                      {row.tenantId === null && (
                        <>
                          <span className="text-gray-400">·</span>
                          <span className="text-orange-700 text-xs px-1.5 py-0.5 bg-orange-100 rounded">unscoped</span>
                        </>
                      )}
                    </div>
                    <div className="text-sm text-red-700 mt-1 truncate">{row.error}</div>
                  </div>
                  {!isResolved && (
                    <button
                      onClick={() => replay(row.id)}
                      disabled={replaying === row.id}
                      className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded flex items-center gap-1.5"
                    >
                      {replaying === row.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      Replay
                    </button>
                  )}
                </div>
                {isOpen && (
                  <div className="px-3 pb-3 pl-10">
                    <div className="text-xs text-gray-500 mb-1">Payload</div>
                    <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto max-h-64 overflow-y-auto border">
                      {JSON.stringify(row.payload, null, 2)}
                    </pre>
                    {row.error && (
                      <>
                        <div className="text-xs text-gray-500 mt-2 mb-1">Last error</div>
                        <pre className="text-xs bg-red-50 p-2 rounded overflow-x-auto border border-red-100 whitespace-pre-wrap">
                          {row.error}
                        </pre>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
