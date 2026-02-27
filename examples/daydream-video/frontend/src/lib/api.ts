/**
 * Daydream AI Video - API Client
 *
 * Dual-path routing:
 * - Stream/model calls → Service Gateway connector at /api/v1/gw/daydream
 * - Local data calls (settings, sessions, usage) → plugin backend via SDK
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

// Gateway connector base URL for Daydream API calls (streams, models)
const getGatewayUrl = (): string => {
  return `${window.location.origin}/api/v1/gw/daydream`;
};

// Plugin backend URL for local data (settings, sessions, usage, presets)
const getBackendUrl = (): string => {
  return getPluginBackendUrl('daydream-video', {
    apiPath: '/api/v1/daydream',
  });
};

const AUTH_TOKEN_KEY = 'naap_auth_token';

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;

  const shellContext = (window as any).__SHELL_CONTEXT__;
  if (shellContext?.authToken) {
    return shellContext.authToken;
  }

  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }

  return null;
}

/** Headers for gateway connector calls (JWT auth only, no plugin-specific headers) */
function gatewayHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

/** Headers for plugin backend calls (full plugin SDK headers) */
function backendHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers[HEADER_CSRF_TOKEN] = csrfToken;
  }

  headers[HEADER_CORRELATION] = generateCorrelationId();
  headers[HEADER_PLUGIN_NAME] = 'daydream-video';

  return headers;
}

export interface StreamResponse {
  sessionId?: string;
  streamId: string;
  playbackId: string;
  whipUrl: string;
}

/** Raw Daydream.live API response from POST /api/v1/streams */
interface DaydreamStreamRaw {
  id: string;
  output_playback_id: string;
  whip_url: string;
  [key: string]: unknown;
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

/** Generic fetch + unwrap for { success, data, error } envelope */
async function request<T>(
  url: string,
  headers: Record<string, string>,
  options: RequestInit = {}
): Promise<T> {
  console.log(`[API] ${options.method || 'GET'} ${url}`, options.body ? JSON.parse(options.body as string) : '');

  try {
    const response = await fetch(url, { ...options, headers });
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
    if (err instanceof ApiError) throw err;
    console.log(`[API] Network/fetch error:`, err);
    throw new ApiError('Network error - backend may be unavailable', 0, 'NETWORK_ERROR');
  }
}

/** Call through the Service Gateway connector */
async function gwRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  return request<T>(`${getGatewayUrl()}${endpoint}`, gatewayHeaders(), options);
}

/** Call the plugin backend (local data) */
async function backendRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  return request<T>(`${getBackendUrl()}${endpoint}`, backendHeaders(), options);
}

// ── Plugin Backend (local data) ──

export async function getSettings(): Promise<SettingsData> {
  return backendRequest<SettingsData>('/settings');
}

export async function updateSettings(settings: Partial<{
  apiKey: string;
  defaultPrompt: string;
  defaultSeed: number;
  negativePrompt: string;
}>): Promise<SettingsData> {
  return backendRequest<SettingsData>('/settings', {
    method: 'POST',
    body: JSON.stringify(settings),
  });
}

export async function testApiKey(apiKey?: string): Promise<{ message: string }> {
  return backendRequest<{ message: string }>('/settings/test', {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  });
}

export async function getUsageStats(): Promise<UsageStats> {
  return backendRequest<UsageStats>('/usage');
}

export async function getSessionHistory(
  limit = 50,
  offset = 0
): Promise<SessionRecord[]> {
  const result = await backendRequest<{ sessions: SessionRecord[] } | SessionRecord[]>(
    `/sessions?limit=${limit}&offset=${offset}`
  );
  if (Array.isArray(result)) return result;
  return result.sessions ?? [];
}

export async function getActiveSession(): Promise<SessionRecord | null> {
  return backendRequest<SessionRecord | null>('/sessions/active');
}

export async function getControlNets(): Promise<ControlNetInfo[]> {
  return backendRequest<ControlNetInfo[]>('/controlnets');
}

export async function getPresets(): Promise<PresetInfo[]> {
  const result = await backendRequest<Record<string, Omit<PresetInfo, 'id'>> | PresetInfo[]>('/presets');
  if (Array.isArray(result)) return result;
  return Object.entries(result).map(([id, preset]) => ({ id, ...preset }));
}

// ── Service Gateway (Daydream.live API) ──

export async function createStream(params?: {
  prompt?: string;
  seed?: number;
  model_id?: string;
  negative_prompt?: string;
}): Promise<StreamResponse> {
  console.log('[API] createStream via gateway, params:', params);
  const body = {
    pipeline: 'streamdiffusion',
    params: {
      model_id: params?.model_id || 'stabilityai/sdxl-turbo',
      prompt: params?.prompt || 'anime character',
      ...(params?.seed != null && { seed: params.seed }),
      ...(params?.negative_prompt && { negative_prompt: params.negative_prompt }),
    },
  };
  const raw = await gwRequest<DaydreamStreamRaw>('/streams', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return {
    streamId: raw.id,
    playbackId: raw.output_playback_id,
    whipUrl: raw.whip_url,
  };
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
  console.log('[API] updateStreamParams via gateway - streamId:', streamId);
  await gwRequest<void>(`/streams/${streamId}`, {
    method: 'PATCH',
    body: JSON.stringify({ params }),
  });
}

export async function endStream(streamId: string): Promise<{
  sessionEnded: boolean;
  durationMins: number;
}> {
  return gwRequest(`/streams/${streamId}`, {
    method: 'DELETE',
  });
}

const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'stabilityai/sd-turbo', name: 'SD Turbo', description: 'Fast SD model, optimized for real-time' },
  { id: 'stabilityai/sdxl-turbo', name: 'SDXL Turbo', description: 'High quality SDXL model' },
];

export async function getModels(): Promise<ModelInfo[]> {
  try {
    const raw = await gwRequest<unknown>('/models');
    const isModel = (m: unknown): m is ModelInfo =>
      !!m && typeof m === 'object' && 'id' in (m as Record<string, unknown>);

    if (Array.isArray(raw) && raw.length > 0 && isModel(raw[0])) return raw;
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      for (const key of ['models', 'data']) {
        if (Array.isArray(obj[key]) && (obj[key] as unknown[]).length > 0 && isModel((obj[key] as unknown[])[0])) {
          return obj[key] as ModelInfo[];
        }
      }
    }
    return FALLBACK_MODELS;
  } catch {
    return FALLBACK_MODELS;
  }
}
