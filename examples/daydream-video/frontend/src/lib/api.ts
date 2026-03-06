/**
 * Daydream AI Video - API Client
 *
 * Stream operations (create, update, get, delete) are routed through the
 * Service Gateway daydream connector (/api/v1/gw/daydream/*), which
 * automatically injects the API key from SecretVault. The plugin never
 * handles the upstream API key directly.
 *
 * NaaP-internal operations (sessions, settings, usage, presets, controlnets)
 * are routed to the daydream-video plugin backend.
 */

import {
  getPluginBackendUrl,
  getCsrfToken,
  generateCorrelationId,
} from '@naap/plugin-sdk';
import { HEADER_CSRF_TOKEN, HEADER_CORRELATION, HEADER_PLUGIN_NAME } from '@naap/types';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const getPluginApiUrl = (): string => {
  return getPluginBackendUrl('daydream-video', {
    apiPath: '/api/v1/daydream',
  });
};

const getGatewayUrl = (): string => {
  // The gateway engine runs on the shell (port 3000). In iframe mode the
  // shell context provides the origin; in dev mode fall back to localhost:3000.
  if (typeof window !== 'undefined') {
    const shellCtx = (window as any).__SHELL_CONTEXT__;
    if (shellCtx?.shellOrigin) {
      return `${shellCtx.shellOrigin}/api/v1/gw/daydream`;
    }
    // When running inside the shell iframe, the page origin IS the shell
    const origin = window.location.origin;
    if (origin.includes(':3000')) {
      return `${origin}/api/v1/gw/daydream`;
    }
    // Dev mode (Vite on another port) — point to shell explicitly
    return `http://${window.location.hostname}:3000/api/v1/gw/daydream`;
  }
  return 'http://localhost:3000/api/v1/gw/daydream';
};

const PLUGIN_API_URL = getPluginApiUrl;
const GW_URL = getGatewayUrl;

// Auth token storage key (must match shell's STORAGE_KEYS.AUTH_TOKEN)
const AUTH_TOKEN_KEY = 'naap_auth_token';

// Get auth token from available sources
// Priority: 1) shell context (iframe mode), 2) localStorage (UMD mode)
export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;

  // 1. Try shell context (set in iframe mode via main.tsx)
  const shellContext = (window as any).__SHELL_CONTEXT__;
  if (shellContext?.authToken) {
    return shellContext.authToken;
  }

  // 2. Read from localStorage (works in UMD mode — the shell stores the
  //    auth token here via auth-context.tsx)
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }

  return null;
}

// Get auth headers with proper token retrieval
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Get auth token from shell context or localStorage
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Add CSRF token
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers[HEADER_CSRF_TOKEN] = csrfToken;
  }

  // Add correlation ID for tracing
  headers[HEADER_CORRELATION] = generateCorrelationId();
  headers[HEADER_PLUGIN_NAME] = 'daydream-video';

  return headers;
}

export interface StreamResponse {
  sessionId: string;
  streamId: string;
  playbackId: string;
  whipUrl: string;
}

export interface UsageStats {
  totalSessions: number;
  totalMinutes: number;
  activeSessions: number;
}

export interface SessionRecord {
  id: string;
  userId: string;
  streamId: string;
  playbackId: string;
  startedAt: string;
  endedAt: string | null;
  durationMins: number;
  status: string;
  prompt: string | null;
}

export interface SettingsData {
  hasApiKey: boolean;
  defaultPrompt: string;
  defaultSeed: number;
  negativePrompt: string;
}

export interface ControlNetInfo {
  name: string;
  displayName: string;
  description: string;
}

export interface PresetInfo {
  id: string;
  prompt: string;
  negative_prompt: string;
  seed: number;
  controlnets: Record<string, number>;
}

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
}

/** Call a NaaP-internal plugin backend endpoint */
async function pluginRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  return apiRequest<T>(`${PLUGIN_API_URL()}${endpoint}`, options);
}

/** Call through the Service Gateway daydream connector (upstream API) */
async function gwRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  return apiRequest<T>(`${GW_URL()}${endpoint}`, options);
}

async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    ...authHeaders(),
  };

  if (options.headers) {
    Object.assign(headers, options.headers);
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new ApiError(
        data.error?.message || 'API request failed',
        response.status,
        data.error?.code
      );
    }

    return data.data;
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }
    throw new ApiError('Network error - backend may be unavailable', 0, 'NETWORK_ERROR');
  }
}

// ─── Settings (NaaP-internal, plugin backend) ───────────────────────

export async function getSettings(): Promise<SettingsData> {
  return pluginRequest<SettingsData>('/settings');
}

export async function updateSettings(settings: Partial<{
  apiKey: string;
  defaultPrompt: string;
  defaultSeed: number;
  negativePrompt: string;
}>): Promise<SettingsData> {
  return pluginRequest<SettingsData>('/settings', {
    method: 'POST',
    body: JSON.stringify(settings),
  });
}

export async function testApiKey(apiKey?: string): Promise<{ message: string }> {
  return pluginRequest<{ message: string }>('/settings/test', {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  });
}

// ─── Stream operations (via Gateway connector → api.daydream.live) ──

export async function createStream(params?: {
  prompt?: string;
  seed?: number;
  model_id?: string;
  negative_prompt?: string;
}): Promise<StreamResponse> {
  const gwResult = await gwRequest<any>('/streams', {
    method: 'POST',
    body: JSON.stringify({
      pipeline: 'streamdiffusion',
      params: params || {},
    }),
  });

  // Record session in NaaP via plugin backend
  try {
    const session = await pluginRequest<any>('/sessions', {
      method: 'POST',
      body: JSON.stringify({
        streamId: gwResult.id,
        playbackId: gwResult.output_playback_id,
        whipUrl: gwResult.whip_url,
        prompt: params?.prompt || 'cinematic, high quality',
        seed: params?.seed || 42,
      }),
    });
    return {
      sessionId: session.id || session.sessionId,
      streamId: gwResult.id,
      playbackId: gwResult.output_playback_id,
      whipUrl: gwResult.whip_url,
    };
  } catch {
    // Session recording is non-critical; stream was created successfully
    return {
      sessionId: '',
      streamId: gwResult.id,
      playbackId: gwResult.output_playback_id,
      whipUrl: gwResult.whip_url,
    };
  }
}

export async function updateStreamParams(
  streamId: string,
  params: {
    prompt?: string;
    model_id?: string;
    negative_prompt?: string;
    seed?: number;
    num_inference_steps?: number;
    t_index_list?: number[];
    controlnetSliders?: Record<string, number>;
  }
): Promise<void> {
  await gwRequest<void>(`/streams/${streamId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      pipeline: 'streamdiffusion',
      params,
    }),
  });
}

export async function endStream(streamId: string): Promise<{
  sessionEnded: boolean;
  durationMins: number;
}> {
  // Delete on upstream via gateway
  await gwRequest<void>(`/streams/${streamId}`, {
    method: 'DELETE',
  });

  // End session tracking in NaaP
  try {
    return await pluginRequest<{ sessionEnded: boolean; durationMins: number }>(
      `/sessions/end-by-stream/${streamId}`,
      { method: 'POST' }
    );
  } catch {
    return { sessionEnded: false, durationMins: 0 };
  }
}

// ─── Usage & Sessions (NaaP-internal, plugin backend) ───────────────

export async function getUsageStats(): Promise<UsageStats> {
  return pluginRequest<UsageStats>('/usage');
}

export async function getSessionHistory(
  limit = 50,
  offset = 0
): Promise<SessionRecord[]> {
  const result = await pluginRequest<{ sessions: SessionRecord[] } | SessionRecord[]>(
    `/sessions?limit=${limit}&offset=${offset}`
  );
  if (Array.isArray(result)) return result;
  return result.sessions ?? [];
}

export async function getActiveSession(): Promise<SessionRecord | null> {
  return pluginRequest<SessionRecord | null>('/sessions/active');
}

// ─── Reference data (plugin backend or gateway) ─────────────────────

export async function getControlNets(): Promise<ControlNetInfo[]> {
  return pluginRequest<ControlNetInfo[]>('/controlnets');
}

export async function getPresets(): Promise<PresetInfo[]> {
  const result = await pluginRequest<Record<string, Omit<PresetInfo, 'id'>> | PresetInfo[]>('/presets');
  if (Array.isArray(result)) return result;
  return Object.entries(result).map(([id, preset]) => ({ id, ...preset }));
}

export async function getModels(): Promise<ModelInfo[]> {
  try {
    return await gwRequest<ModelInfo[]>('/models');
  } catch {
    return pluginRequest<ModelInfo[]>('/models');
  }
}
