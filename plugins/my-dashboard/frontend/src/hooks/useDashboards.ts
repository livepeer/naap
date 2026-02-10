/**
 * useDashboards - Hook for fetching and managing dashboards
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiUrl, getAuthHeaders, getCurrentUser } from '../App';
import type { Dashboard, UserPreference, ApiResponse } from '../types';

interface UseDashboardsReturn {
  dashboards: Dashboard[];
  preferences: Map<string, UserPreference>;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  togglePin: (dashboardId: string) => Promise<void>;
}

export function useDashboards(): UseDashboardsReturn {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [preferences, setPreferences] = useState<Map<string, UserPreference>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboards = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const apiUrl = getApiUrl();
      
      // Fetch dashboards
      const dashboardsRes = await fetch(`${apiUrl}/dashboards`, {
        headers: await getAuthHeaders(),
      });
      
      if (!dashboardsRes.ok) {
        throw new Error('Failed to fetch dashboards');
      }
      
      const dashboardsJson: ApiResponse<{ dashboards: Dashboard[] } | Dashboard[]> = await dashboardsRes.json();
      
      if (dashboardsJson.success && dashboardsJson.data) {
        // Route wraps in { dashboards: [...] } inside the envelope
        const payload = dashboardsJson.data;
        setDashboards(Array.isArray(payload) ? payload : (payload as any).dashboards ?? []);
      }

      // Fetch user preferences
      const user = getCurrentUser();
      if (user) {
        const prefsRes = await fetch(`${apiUrl}/preferences`, {
          headers: await getAuthHeaders(),
        });
        
        if (prefsRes.ok) {
          const prefsJson: ApiResponse<{ preferences: UserPreference[] } | UserPreference[]> = await prefsRes.json();
          if (prefsJson.success && prefsJson.data) {
            const payload = prefsJson.data;
            const prefsArr = Array.isArray(payload) ? payload : (payload as any).preferences ?? [];
            const prefsMap = new Map<string, UserPreference>();
            prefsArr.forEach((pref: UserPreference) => {
              prefsMap.set(pref.dashboardId, pref);
            });
            setPreferences(prefsMap);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch dashboards:', err);
      setError(err instanceof Error ? err.message : 'Failed to load dashboards');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const togglePin = useCallback(async (dashboardId: string) => {
    const apiUrl = getApiUrl();
    const currentPref = preferences.get(dashboardId);
    const newPinned = !currentPref?.pinned;

    try {
      const res = await fetch(`${apiUrl}/preferences`, {
        method: 'PUT',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          dashboardId,
          pinned: newPinned,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to update preference');
      }

      // Update local state
      setPreferences(prev => {
        const newMap = new Map(prev);
        if (currentPref) {
          newMap.set(dashboardId, { ...currentPref, pinned: newPinned });
        } else {
          newMap.set(dashboardId, {
            id: '',
            userId: '',
            dashboardId,
            pinned: newPinned,
            order: 0,
          });
        }
        return newMap;
      });
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  }, [preferences]);

  useEffect(() => {
    fetchDashboards();
  }, [fetchDashboards]);

  return {
    dashboards,
    preferences,
    isLoading,
    error,
    refresh: fetchDashboards,
    togglePin,
  };
}

export default useDashboards;
