import { useState, useEffect, useCallback } from 'react';
import type { CapabilityQueryRecord, CapabilityConnection } from '../lib/types';
import { fetchQueries, fetchQueryResults, seedQueries as apiSeedQueries } from '../lib/api';

interface QueryWithResults {
  query: CapabilityQueryRecord;
  results: CapabilityConnection | null;
  resultsLoading: boolean;
}

export function useQueries() {
  const [queries, setQueries] = useState<QueryWithResults[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { queries: data } = await fetchQueries();
      const withResults: QueryWithResults[] = data.map((q) => ({
        query: q,
        results: null,
        resultsLoading: true,
      }));
      setQueries(withResults);

      for (const item of withResults) {
        try {
          const results = await fetchQueryResults(item.query.id);
          setQueries((prev) =>
            prev.map((p) =>
              p.query.id === item.query.id
                ? { ...p, results, resultsLoading: false }
                : p,
            ),
          );
        } catch {
          setQueries((prev) =>
            prev.map((p) =>
              p.query.id === item.query.id
                ? { ...p, resultsLoading: false }
                : p,
            ),
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load queries');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const seed = useCallback(async () => {
    setSeeding(true);
    try {
      await apiSeedQueries();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to seed queries');
    } finally {
      setSeeding(false);
    }
  }, [load]);

  return { queries, loading, error, seeding, seed, refresh: load };
}
