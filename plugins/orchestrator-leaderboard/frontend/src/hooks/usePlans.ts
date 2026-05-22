import { useState, useEffect, useCallback } from 'react';
import {
  fetchPlans,
  fetchPlanResults,
  seedDemoPlans,
  type DiscoveryPlan,
  type PlanResults,
} from '../lib/api';

interface PlanWithResults {
  plan: DiscoveryPlan;
  results: PlanResults | null;
  resultsLoading: boolean;
  resultsError: string | null;
}

interface UsePlansResult {
  plans: PlanWithResults[];
  loading: boolean;
  error: string | null;
  seeding: boolean;
  seed: () => Promise<void>;
  refresh: () => void;
}

export function usePlans(): UsePlansResult {
  const [planItems, setPlanItems] = useState<PlanWithResults[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const plans = await fetchPlans();
        if (cancelled) return;

        const items: PlanWithResults[] = plans.map((plan) => ({
          plan,
          results: null,
          resultsLoading: plan.enabled,
          resultsError: null,
        }));
        setPlanItems(items);
        setLoading(false);

        for (const item of items) {
          if (!item.plan.enabled || cancelled) continue;
          try {
            const results = await fetchPlanResults(item.plan.id);
            if (cancelled) return;
            setPlanItems((prev) =>
              prev.map((p) =>
                p.plan.id === item.plan.id
                  ? { ...p, results, resultsLoading: false }
                  : p,
              ),
            );
          } catch (err) {
            if (cancelled) return;
            setPlanItems((prev) =>
              prev.map((p) =>
                p.plan.id === item.plan.id
                  ? {
                      ...p,
                      resultsLoading: false,
                      resultsError: err instanceof Error ? err.message : 'Failed to load results',
                    }
                  : p,
              ),
            );
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load plans');
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const seed = useCallback(async () => {
    setSeeding(true);
    try {
      await seedDemoPlans();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to seed plans');
    } finally {
      setSeeding(false);
    }
  }, [refresh]);

  return { plans: planItems, loading, error, seeding, seed, refresh };
}
