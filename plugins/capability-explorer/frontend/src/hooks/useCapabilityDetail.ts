import { useState, useEffect } from 'react';
import type { EnrichedCapability } from '../lib/types';
import { fetchCapability } from '../lib/api';

export function useCapabilityDetail(id: string | null) {
  const [data, setData] = useState<EnrichedCapability | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchCapability(id)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [id]);

  return { data, loading, error };
}
