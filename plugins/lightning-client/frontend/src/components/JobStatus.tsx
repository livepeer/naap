import React, { useEffect, useState, useCallback } from 'react';
import { Info, RefreshCw, Copy, Check } from 'lucide-react';
import type { JobStatusResponse, GatewayError } from '../lib/types';

interface Props {
  jobId: string | null;
  getJob: (id: string) => Promise<JobStatusResponse>;
}

export const JobStatus: React.FC<Props> = ({ jobId, getJob }) => {
  const [data, setData] = useState<JobStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const res = await getJob(jobId);
      setData(res);
      setError(null);
    } catch (err) {
      setError((err as GatewayError).message || 'Failed to get job');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [jobId, getJob]);

  useEffect(() => {
    if (!jobId) {
      setData(null);
      setError(null);
      return;
    }
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [jobId, refresh]);

  const copyToClipboard = (label: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  if (!jobId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-sm gap-2">
        <Info size={24} />
        <span>Select a job to see its status</span>
      </div>
    );
  }

  const urlFields: [string, string | null | undefined][] = [
    ['publish_url', data?.publish_url],
    ['subscribe_url', data?.subscribe_url],
    ['control_url', data?.control_url],
    ['events_url', data?.events_url],
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Job Status</h3>
        <button
          onClick={refresh}
          disabled={loading}
          className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="px-2 py-1.5 bg-red-950/50 border border-red-800 rounded text-xs text-red-400">
          {error}
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-2 text-xs">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <span className="text-zinc-500">Job ID</span>
            <span className="font-mono text-zinc-300 truncate">{data.job_id}</span>
            <span className="text-zinc-500">Model</span>
            <span className="text-zinc-300">{data.model_id}</span>
            <span className="text-zinc-500">Created</span>
            <span className="text-zinc-300">{new Date(data.created_at * 1000).toLocaleTimeString()}</span>
            <span className="text-zinc-500">Media</span>
            <span className={data.media_started ? 'text-emerald-400' : 'text-amber-400'}>
              {data.media_started ? 'Streaming' : 'Waiting'}
            </span>
            <span className="text-zinc-500">Payment</span>
            <span className="text-zinc-300">{data.has_payment_session ? 'Active' : 'None'}</span>
          </div>

          <div className="border-t border-zinc-700/50 pt-2 flex flex-col gap-1.5">
            <span className="text-zinc-400 font-medium">Orchestrator URLs</span>
            {urlFields.map(([label, url]) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className="text-zinc-500 w-24 shrink-0">{label}</span>
                {url ? (
                  <>
                    <span className="font-mono text-zinc-400 truncate text-[10px]">{url}</span>
                    <button
                      onClick={() => copyToClipboard(label, url)}
                      className="p-0.5 text-zinc-500 hover:text-zinc-300 shrink-0"
                    >
                      {copied === label ? <Check size={10} /> : <Copy size={10} />}
                    </button>
                  </>
                ) : (
                  <span className="text-zinc-600 italic">pending</span>
                )}
              </div>
            ))}
          </div>

          {data.orchestrator_url && (
            <div className="flex items-center gap-1.5 pt-1">
              <span className="text-zinc-500 w-24 shrink-0">orchestrator</span>
              <span className="font-mono text-zinc-400 truncate text-[10px]">
                {data.orchestrator_url}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
