import React, { useState, useCallback, useEffect } from 'react';
import { Play, Square, RefreshCw, Loader2 } from 'lucide-react';
import type { JobListItem, StartJobRequest, GatewayError } from '../lib/types';

interface Props {
  startJob: (req: StartJobRequest) => Promise<any>;
  stopJob: (id: string) => Promise<any>;
  listJobs: () => Promise<JobListItem[]>;
  onJobStarted: (jobId: string) => void;
  onJobSelected: (jobId: string) => void;
  selectedJobId: string | null;
}

export const JobManager: React.FC<Props> = ({
  startJob,
  stopJob,
  listJobs,
  onJobStarted,
  onJobSelected,
  selectedJobId,
}) => {
  const [modelId, setModelId] = useState('noop');
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const list = await listJobs();
      setJobs(Array.isArray(list) ? list : []);
      setError(null);
    } catch (err) {
      setError((err as GatewayError).message || 'Failed to list jobs');
    } finally {
      setRefreshing(false);
    }
  }, [listJobs]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await startJob({ model_id: modelId || 'noop' });
      onJobStarted(res.job_id);
      await refresh();
    } catch (err) {
      setError((err as GatewayError).message || 'Failed to start job');
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async (jobId: string) => {
    setStopping(jobId);
    setError(null);
    try {
      await stopJob(jobId);
      await refresh();
    } catch (err) {
      setError((err as GatewayError).message || 'Failed to stop job');
    } finally {
      setStopping(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Job Manager</h3>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Refresh job list"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          placeholder="model_id"
          className="flex-1 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
        />
        <button
          onClick={handleStart}
          disabled={starting}
          className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 text-white text-xs font-medium rounded transition-colors"
        >
          {starting ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          Start
        </button>
      </div>

      {error && (
        <div className="px-2 py-1.5 bg-red-950/50 border border-red-800 rounded text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
        {jobs.length === 0 && !refreshing && (
          <div className="text-xs text-zinc-500 py-2 text-center">No active jobs</div>
        )}
        {jobs.map((job) => (
          <div
            key={job.job_id}
            onClick={() => onJobSelected(job.job_id)}
            className={`flex items-center justify-between px-2 py-1.5 rounded cursor-pointer text-xs transition-colors ${
              selectedJobId === job.job_id
                ? 'bg-amber-900/30 border border-amber-700'
                : 'bg-zinc-800/50 border border-zinc-700/50 hover:bg-zinc-700/50'
            }`}
          >
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="font-mono text-zinc-300 truncate">{job.job_id.slice(0, 12)}...</span>
              <span className="text-zinc-500">
                {job.model_id} &middot;{' '}
                {job.media_started ? '🟢 streaming' : '⏳ waiting'}
              </span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleStop(job.job_id);
              }}
              disabled={stopping === job.job_id}
              className="p-1 text-red-400 hover:text-red-300 disabled:text-zinc-600 transition-colors"
              title="Stop job"
            >
              {stopping === job.job_id ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Square size={12} />
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
