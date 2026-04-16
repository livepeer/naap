import { useState, useEffect, useCallback } from 'react';
import type { CapabilityQueryRecord, CapabilityConnection } from '../lib/types';
import { fetchQuery, fetchQueryResults, updateQuery as apiUpdateQuery, deleteQuery as apiDeleteQuery } from '../lib/api';

export function useQueryDetail(id: string) {
  const [query, setQuery] = useState<CapabilityQueryRecord | null>(null);
  const [results, setResults] = useState<CapabilityConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [resultsLoading, setResultsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = await fetchQuery(id);
      setQuery(q);
      setLoading(false);

      setResultsLoading(true);
      const r = await fetchQueryResults(id);
      setResults(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load query');
    } finally {
      setLoading(false);
      setResultsLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const update = useCallback(async (input: Record<string, unknown>) => {
    setError(null);
    try {
      const updated = await apiUpdateQuery(id, input);
      setQuery(updated);
      setResultsLoading(true);
      const r = await fetchQueryResults(id);
      setResults(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update query');
    } finally {
      setResultsLoading(false);
    }
  }, [id]);

  const remove = useCallback(async () => {
    try {
      await apiDeleteQuery(id);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete query');
      return false;
    }
  }, [id]);

  return { query, results, loading, resultsLoading, error, update, remove, refresh: load };
}
