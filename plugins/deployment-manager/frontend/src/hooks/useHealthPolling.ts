import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../lib/apiFetch';

export interface HealthDetails {
  endpointStatus?: string;
  isServerless?: boolean;
  workers?: { running: number; idle: number; total: number; min: number; max: number };
  jobs?: { completed: number; inQueue: number; inProgress: number };
  note?: string;
}

export function useHealthPolling(deploymentId: string | null, intervalMs = 30000) {
  const [healthStatus, setHealthStatus] = useState<string>('UNKNOWN');
  const [lastCheck, setLastCheck] = useState<string | null>(null);
  const [healthDetails, setHealthDetails] = useState<HealthDetails | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!deploymentId) return;

    const check = async () => {
      try {
        const res = await apiFetch(`/health/${deploymentId}/check`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          setHealthStatus(data.data.status);
          setLastCheck(new Date().toISOString());
          if (data.data.details) {
            setHealthDetails(data.data.details);
          }
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
