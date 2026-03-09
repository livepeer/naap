import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../lib/apiFetch';

const HEALTH_CACHE_KEY = 'dm:health:';

function readHealthCache(id: string): { status: string; lastCheck: string | null; details: HealthDetails | null } | null {
  try {
    const raw = sessionStorage.getItem(`${HEALTH_CACHE_KEY}${id}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeHealthCache(id: string, status: string, lastCheck: string | null, details: HealthDetails | null): void {
  try { sessionStorage.setItem(`${HEALTH_CACHE_KEY}${id}`, JSON.stringify({ status, lastCheck, details })); } catch { /* quota */ }
}

export interface HealthDetails {
  endpointStatus?: string;
  isServerless?: boolean;
  workers?: { running: number; idle: number; total: number; min: number; max: number };
  jobs?: { completed: number; inQueue: number; inProgress: number };
  note?: string;
}

export function useHealthPolling(deploymentId: string | null, intervalMs = 30000) {
  const cached = deploymentId ? readHealthCache(deploymentId) : null;
  const [healthStatus, setHealthStatus] = useState<string>(cached?.status ?? 'UNKNOWN');
  const [lastCheck, setLastCheck] = useState<string | null>(cached?.lastCheck ?? null);
  const [healthDetails, setHealthDetails] = useState<HealthDetails | null>(cached?.details ?? null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!deploymentId) return;

    const check = async () => {
      try {
        const res = await apiFetch(`/health/${deploymentId}/check`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          const status = data.data.status;
          const now = new Date().toISOString();
          const details = data.data.details ?? null;
          setHealthStatus(status);
          setLastCheck(now);
          setHealthDetails(details);
          writeHealthCache(deploymentId, status, now, details);
        }
      } catch {
        // ignore
      }
    };

    check();
    timerRef.current = setInterval(check, intervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [deploymentId, intervalMs]);

  return { healthStatus, lastCheck, healthDetails };
}
