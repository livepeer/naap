import React, { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import type { HealthResponse, GatewayError } from '../lib/types';

interface Props {
  health: () => Promise<HealthResponse>;
}

export const HealthBadge: React.FC<Props> = ({ health }) => {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const res = await health();
        if (mounted) {
          setData(res);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError((err as GatewayError).message || 'Unreachable');
          setData(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };
    poll();
    const interval = setInterval(poll, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [health]);

  const isOk = data?.status === 'ok';

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
        loading
          ? 'border-zinc-600 text-zinc-400 bg-zinc-800/50'
          : isOk
            ? 'border-emerald-700 text-emerald-400 bg-emerald-950/50'
            : 'border-red-700 text-red-400 bg-red-950/50'
      }`}
    >
      <Activity size={14} />
      {loading ? (
        'Checking...'
      ) : isOk ? (
        <>
          Gateway OK &middot; {data!.active_jobs} jobs &middot; v{data!.version}
        </>
      ) : (
        <span title={error || undefined}>Gateway Down</span>
      )}
    </div>
  );
};
