/**
 * Livepeer Gateway Connector Hook
 *
 * All 7 endpoints go through the Service Gateway proxy at
 * /api/v1/gw/livepeer-gateway/*
 *
 * Uses raw fetch (not useApiClient) because the connector has
 * responseWrapper: false — upstream JSON passes through without
 * the { success, data, meta } envelope.
 */

import { useCallback, useMemo } from 'react';
import { useTeam } from '@naap/plugin-sdk';
import type {
  HealthResponse,
  StartJobRequest,
  StartJobResponse,
  JobListItem,
  JobStatusResponse,
  ControlMessageBody,
  GatewayError,
} from '../lib/types';

const GW_BASE = '/api/v1/gw/livepeer-gateway';

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  const ctx = (window as any).__SHELL_CONTEXT__;
  if (ctx?.token) return ctx.token;
  return localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
}

async function gw<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string>) || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (init?.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${GW_BASE}${path}`, { ...init, headers });

  if (!res.ok) {
    let errorBody: any;
    try {
      errorBody = await res.json();
    } catch {
      errorBody = { message: res.statusText };
    }
    const err: GatewayError = {
      status: res.status,
      code: errorBody?.error?.code || errorBody?.code,
      message: errorBody?.error?.message || errorBody?.message || errorBody?.detail || res.statusText,
      details: errorBody,
    };
    throw err;
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await res.json();
    // Handle gateway envelope if responseWrapper was unexpectedly true
    if (body && typeof body === 'object' && 'success' in body && 'data' in body) {
      return body.data as T;
    }
    return body as T;
  }

  return {} as T;
}

export function useGatewayApi() {
  const teamContext = useTeam();
  const teamId = teamContext?.currentTeam?.id;

  const addTeamHeader = useCallback(
    (extra?: Record<string, string>): Record<string, string> => {
      const h: Record<string, string> = { ...(extra || {}) };
      if (teamId) h['x-team-id'] = teamId;
      return h;
    },
    [teamId],
  );

  const health = useCallback(
    () => gw<HealthResponse>('/health', { headers: addTeamHeader() }),
    [addTeamHeader],
  );

  const listJobs = useCallback(
    () => gw<JobListItem[]>('/jobs', { headers: addTeamHeader() }),
    [addTeamHeader],
  );

  const startJob = useCallback(
    (body: StartJobRequest) =>
      gw<StartJobResponse>('/start-job', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: addTeamHeader(),
      }),
    [addTeamHeader],
  );

  const getJob = useCallback(
    (jobId: string) => gw<JobStatusResponse>(`/job/${jobId}`, { headers: addTeamHeader() }),
    [addTeamHeader],
  );

  const stopJob = useCallback(
    (jobId: string) =>
      gw<Record<string, unknown>>(`/stop-job/${jobId}`, {
        method: 'DELETE',
        headers: addTeamHeader(),
      }),
    [addTeamHeader],
  );

  const sendControl = useCallback(
    (jobId: string, message: Record<string, unknown>) =>
      gw<Record<string, unknown>>(`/job/${jobId}/control`, {
        method: 'POST',
        body: JSON.stringify({ message } satisfies ControlMessageBody),
        headers: addTeamHeader(),
      }),
    [addTeamHeader],
  );

  const streamEvents = useCallback(
    (jobId: string, onEvent: (data: string) => void, signal?: AbortSignal) => {
      const token = getAuthToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (teamId) headers['x-team-id'] = teamId;

      fetch(`${GW_BASE}/job/${jobId}/events`, { headers, signal })
        .then(async (res) => {
          if (!res.ok || !res.body) {
            onEvent(`[error] ${res.status} ${res.statusText}`);
            return;
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (line.startsWith('data:')) {
                onEvent(line.slice(5).trim());
              } else if (line.trim()) {
                onEvent(line.trim());
              }
            }
          }
        })
        .catch((err) => {
          if (err.name !== 'AbortError') {
            onEvent(`[error] ${err.message}`);
          }
        });
    },
    [teamId],
  );

  return useMemo(
    () => ({ health, listJobs, startJob, getJob, stopJob, sendControl, streamEvents }),
    [health, listJobs, startJob, getJob, stopJob, sendControl, streamEvents],
  );
}
