/**
 * useAlerts - Hook for alert management
 */

import { useState, useEffect, useCallback } from 'react';
import { useShell } from '@naap/plugin-sdk';
import { getApiUrl } from '../App';

interface Alert {
  id: string;
  type: string;
  orchestratorAddr: string | null;
  threshold: string | null;
  enabled: boolean;
  createdAt: string;
  history: AlertHistoryItem[];
}

interface AlertHistoryItem {
  id: string;
  message: string;
  data: string | null;
  readAt: string | null;
  createdAt: string;
  alert?: { type: string; orchestratorAddr: string | null };
}

export function useAlerts() {
  const shell = useShell();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [history, setHistory] = useState<AlertHistoryItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const getHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await shell.auth.getToken().catch(() => '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, [shell]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    try {
      const apiUrl = getApiUrl();
      const headers = await getHeaders();
      const res = await fetch(`${apiUrl}/alerts`, { headers, signal });
      const json = await res.json();
      const data = json.data ?? json;
      setAlerts(data.alerts || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Failed to fetch alerts:', err);
    } finally {
      setIsLoading(false);
    }
  }, [getHeaders]);

  const fetchHistory = useCallback(async (limit = 50, offset = 0, signal?: AbortSignal) => {
    try {
      const apiUrl = getApiUrl();
      const headers = await getHeaders();
      const res = await fetch(`${apiUrl}/alerts/history?limit=${limit}&offset=${offset}`, { headers, signal });
      const json = await res.json();
      const data = json.data ?? json;
      setHistory(data.items || []);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Failed to fetch alert history:', err);
    }
  }, [getHeaders]);

  const create = useCallback(async (type: string, orchestratorAddr?: string, threshold?: Record<string, unknown>) => {
    const apiUrl = getApiUrl();
    const headers = await getHeaders();
    await fetch(`${apiUrl}/alerts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type, orchestratorAddr, threshold }),
    });
    await refresh();
  }, [getHeaders, refresh]);

  const update = useCallback(async (id: string, updates: { enabled?: boolean; threshold?: Record<string, unknown> }) => {
    const apiUrl = getApiUrl();
    const headers = await getHeaders();
    await fetch(`${apiUrl}/alerts/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(updates),
    });
    await refresh();
  }, [getHeaders, refresh]);

  const remove = useCallback(async (id: string) => {
    const apiUrl = getApiUrl();
    const headers = await getHeaders();
    await fetch(`${apiUrl}/alerts/${id}`, { method: 'DELETE', headers });
    await refresh();
  }, [getHeaders, refresh]);

  const markRead = useCallback(async (historyId: string) => {
    const apiUrl = getApiUrl();
    const headers = await getHeaders();
    await fetch(`${apiUrl}/alerts/history/${historyId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({}),
    });
    setUnreadCount(c => Math.max(0, c - 1));
    setHistory(h => h.map(item => item.id === historyId ? { ...item, readAt: new Date().toISOString() } : item));
  }, [getHeaders]);

  useEffect(() => {
    const user = shell.auth.getUser();
    if (user) {
      const controller = new AbortController();
      refresh(controller.signal);
      fetchHistory(50, 0, controller.signal);
      return () => controller.abort();
    }
  }, [shell, refresh, fetchHistory]);

  return { alerts, history, unreadCount, isLoading, create, update, remove, markRead, refresh, fetchHistory };
}
