/**
 * Daydream AI Video - API Client
 *
 * Uses @naap/plugin-sdk for backend URL resolution and auth.
 */

import {
  getPluginBackendUrl,
  getCsrfToken,
  generateCorrelationId,
} from '@naap/plugin-sdk';
import { HEADER_CSRF_TOKEN, HEADER_CORRELATION, HEADER_PLUGIN_NAME } from '@naap/types';

// API Error class
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

// Get Daydream API URL using SDK's unified resolution
const getDaydreamApiUrl = (): string => {
  return getPluginBackendUrl('daydream-video', {
    apiPath: '/api/v1/daydream',
  });
};

const API_URL = getDaydreamApiUrl;

// Auth token storage key (must match shell's STORAGE_KEYS.AUTH_TOKEN)
const AUTH_TOKEN_KEY = 'naap_auth_token';

// Get auth token from available sources
// Priority: 1) shell context (iframe mode), 2) localStorage (UMD mode)
function getAuthToken(): string | null {
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

// API response wrapper
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL()}${endpoint}`;
  const headers: Record<string, string> = {
    ...authHeaders(),
  };

  // Merge any additional headers from options
  if (options.headers) {
    Object.assign(headers, options.headers);
  }

  console.log(`[API] ${options.method || 'GET'} ${url}`, options.body ? JSON.parse(options.body as string) : '');

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      console.log(`[API] Request returned error:`, response.status, data.error?.message);
      throw new ApiError(
        data.error?.message || 'API request failed',
        response.status,
        data.error?.code
      );
    }

    console.log(`[API] Response OK`);
    return data.data;
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }
    console.log(`[API] Network/fetch error:`, err);
    throw new ApiError('Network error - backend may be unavailable', 0, 'NETWORK_ERROR');
  }
}

// Settings API
export async function getSettings(): Promise<SettingsData> {
  return apiRequest<SettingsData>('/settings');
}

export async function updateSettings(settings: Partial<{
  apiKey: string;
  defaultPrompt: string;
  defaultSeed: number;
  negativePrompt: string;
}>): Promise<SettingsData> {
  return apiRequest<SettingsData>('/settings', {
    method: 'POST',
    body: JSON.stringify(settings),
  });
}

export async function testApiKey(apiKey?: string): Promise<{ message: string }> {
  return apiRequest<{ message: string }>('/settings/test', {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  });
}

// Stream API
export async function createStream(params?: {
  prompt?: string;
  seed?: number;
  model_id?: string;
  negative_prompt?: string;
}): Promise<StreamResponse> {
  console.log('[API] createStream with params:', params);
  return apiRequest<StreamResponse>('/streams', {
    method: 'POST',
    body: JSON.stringify(params || {}),
  });
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
  console.log('[API] updateStreamParams called - streamId:', streamId, 'params:', params);
  await apiRequest<void>(`/streams/${streamId}`, {
    method: 'PATCH',
    body: JSON.stringify(params),
  });
  console.log('[API] updateStreamParams completed successfully');
}

export async function endStream(streamId: string): Promise<{
  sessionEnded: boolean;
  durationMins: number;
}> {
  return apiRequest(`/streams/${streamId}`, {
    method: 'DELETE',
  });
}

// Usage API
export async function getUsageStats(): Promise<UsageStats> {
  return apiRequest<UsageStats>('/usage');
}

export async function getSessionHistory(
  limit = 50,
  offset = 0
): Promise<SessionRecord[]> {
  const result = await apiRequest<{ sessions: SessionRecord[] } | SessionRecord[]>(
    `/sessions?limit=${limit}&offset=${offset}`
  );
  // Route returns { sessions: [...] } inside the envelope
  if (Array.isArray(result)) return result;
  return result.sessions ?? [];
}

export async function getActiveSession(): Promise<SessionRecord | null> {
  return apiRequest<SessionRecord | null>('/sessions/active');
}

// Reference data
export async function getControlNets(): Promise<ControlNetInfo[]> {
  return apiRequest<ControlNetInfo[]>('/controlnets');
}

export async function getPresets(): Promise<PresetInfo[]> {
  const result = await apiRequest<Record<string, Omit<PresetInfo, 'id'>> | PresetInfo[]>('/presets');
  // Route returns an object keyed by preset name; convert to array
  if (Array.isArray(result)) return result;
  return Object.entries(result).map(([id, preset]) => ({ id, ...preset }));
}

export async function getModels(): Promise<ModelInfo[]> {
  return apiRequest<ModelInfo[]>('/models');
}
