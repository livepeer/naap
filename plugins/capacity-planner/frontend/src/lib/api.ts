/**
 * Capacity Planner - API Client
 *
 * Uses @naap/plugin-sdk for backend URL resolution.
 */

import { getCsrfToken, generateCorrelationId } from '@naap/plugin-sdk';
import { HEADER_CSRF_TOKEN, HEADER_CORRELATION } from '@naap/types';
import type { CapacityRequest, RequestComment, SummaryData } from '../types';

export type { SummaryData };

// Capacity-planner API routes live in the Next.js shell
// (apps/web-next/src/app/api/v1/capacity-planner), NOT a standalone backend.
// Use the shell's own origin so requests go to port 3000 (dev) / same-origin (prod).
const getCapacityApiBaseUrl = (): string => {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/api/v1/capacity-planner`;
};

// Auth token storage key (must match shell's STORAGE_KEYS.AUTH_TOKEN)
const AUTH_TOKEN_KEY = 'naap_auth_token';

// Get auth token from available sources
function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  // 1. Try shell context (iframe mode)
  const shellContext = (window as any).__SHELL_CONTEXT__;
  if (shellContext?.authToken) return shellContext.authToken;
  // 2. Read from localStorage (UMD mode)
  if (typeof localStorage !== 'undefined') return localStorage.getItem(AUTH_TOKEN_KEY);
  return null;
}

// Get auth headers with proper token retrieval
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Add CSRF token if available
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers[HEADER_CSRF_TOKEN] = csrfToken;
  }

  // Add correlation ID for tracing
  headers[HEADER_CORRELATION] = generateCorrelationId();

  return headers;
}

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

// API response wrapper
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${getCapacityApiBaseUrl()}${endpoint}`;
  const headers = getAuthHeaders();

  if (options.headers) {
    Object.assign(headers, options.headers);
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    const data = await response.json();

    if (!response.ok || data.success === false) {
      throw new ApiError(
        data.error || 'API request failed',
        response.status,
        data.code
      );
    }

    return data.data;
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }
    console.error('[Capacity API] Network error:', err);
    throw new ApiError('Network error - backend may be unavailable', 0, 'NETWORK_ERROR');
  }
}

export interface FetchRequestsParams {
  search?: string;
  gpuModel?: string;
  pipeline?: string;
  vramMin?: string;
  sort?: string;
}

// Fetch all requests with optional filtering
export async function fetchRequests(params: FetchRequestsParams = {}): Promise<CapacityRequest[]> {
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.set('search', params.search);
  if (params.gpuModel) searchParams.set('gpuModel', params.gpuModel);
  if (params.pipeline) searchParams.set('pipeline', params.pipeline);
  if (params.vramMin) searchParams.set('vramMin', params.vramMin);
  if (params.sort) searchParams.set('sort', params.sort);

  const query = searchParams.toString();
  return apiRequest<CapacityRequest[]>(`/requests${query ? `?${query}` : ''}`);
}

// Fetch a single request by ID
export async function fetchRequest(id: string): Promise<CapacityRequest> {
  return apiRequest<CapacityRequest>(`/requests/${id}`);
}

// Create a new capacity request
export async function createRequest(
  data: Omit<CapacityRequest, 'id' | 'softCommits' | 'comments' | 'createdAt' | 'status'>
): Promise<CapacityRequest> {
  return apiRequest<CapacityRequest>('/requests', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Toggle soft commit (thumbs up)
export async function toggleCommit(
  requestId: string,
  userId: string,
  userName: string
): Promise<{ action: 'added' | 'removed' }> {
  return apiRequest<{ action: 'added' | 'removed' }>(`/requests/${requestId}/commit`, {
    method: 'POST',
    body: JSON.stringify({ userId, userName }),
  });
}

// Add a comment to a request
export async function addComment(
  requestId: string,
  author: string,
  text: string
): Promise<RequestComment> {
  return apiRequest<RequestComment>(`/requests/${requestId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ author, text }),
  });
}

// Get summary/analytics
export async function fetchSummary(): Promise<SummaryData> {
  return apiRequest<SummaryData>('/summary');
}
