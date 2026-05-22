import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchPlans,
  fetchPlanResults,
  updatePlan as apiUpdatePlan,
  type DiscoveryPlan,
  type PlanResults,
  type PlanUpdatePayload,
} from '../lib/api';

interface UsePlanDetailResult {
  plan: DiscoveryPlan | null;
  results: PlanResults | null;
  loading: boolean;
  resultsLoading: boolean;
  error: string | null;
  dirty: boolean;
  saving: boolean;
  savedFlash: boolean;
  draft: PlanUpdatePayload;
  setDraft: (updates: Partial<PlanUpdatePayload>) => void;
  applyChanges: () => Promise<void>;
  refreshResults: () => void;
}

export function usePlanDetail(planId: string): UsePlanDetailResult {
  const [plan, setPlan] = useState<DiscoveryPlan | null>(null);
  const [results, setResults] = useState<PlanResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [draft, setDraftState] = useState<PlanUpdatePayload>({});
  const [dirty, setDirty] = useState(false);
  const [resultsKey, setResultsKey] = useState(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();

  const setDraft = useCallback((updates: Partial<PlanUpdatePayload>) => {
    setDraftState((prev) => ({ ...prev, ...updates }));
    setDirty(true);
    setSavedFlash(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const plans = await fetchPlans();
        const found = plans.find((p) => p.id === planId) ?? null;
        if (cancelled) return;
        setPlan(found);
        if (!found) {
          setError('Plan not found');
          setLoading(false);
          return;
        }
        setDraftState({
          topN: found.topN,
          slaWeights: found.slaWeights,
          slaMinScore: found.slaMinScore,
          sortBy: found.sortBy,
          filters: found.filters,
        });
        setDirty(false);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load plan');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [planId]);

  useEffect(() => {
    if (!plan?.enabled) return;
    let cancelled = false;
    setResultsLoading(true);

    async function loadResults() {
      try {
        const r = await fetchPlanResults(plan!.id);
        if (!cancelled) setResults(r);
      } catch {
        // non-fatal
      } finally {
        if (!cancelled) setResultsLoading(false);
      }
    }

    loadResults();
    return () => { cancelled = true; };
  }, [plan?.id, plan?.enabled, resultsKey]);

  const refreshResults = useCallback(() => setResultsKey((k) => k + 1), []);

  const applyChanges = useCallback(async () => {
    if (!plan) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await apiUpdatePlan(plan.id, draft);
      setPlan(updated);
      setDirty(false);
      setSavedFlash(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setSavedFlash(false), 3000);
      refreshResults();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }, [plan, draft, refreshResults]);

  return {
    plan,
    results,
    loading,
    resultsLoading,
    error,
    dirty,
    saving,
    savedFlash,
    draft,
    setDraft,
    applyChanges,
    refreshResults,
  };
}
