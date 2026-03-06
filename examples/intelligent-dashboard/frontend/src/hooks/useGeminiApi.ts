/**
 * Gemini API Hook
 *
 * Calls the Gemini connector through the Service Gateway proxy.
 * Endpoint: POST /api/v1/gw/gemini/chat
 * Auth: JWT (injected by useApiClient from plugin-sdk)
 */

import { useCallback, useMemo } from 'react';
import { useApiClient, useTeam } from '@naap/plugin-sdk';
import type { GeminiRequest, GeminiResponse } from '../types';

const GW_GEMINI_BASE = '/api/v1/gw/gemini';

function unwrap<T>(sdkResponse: unknown): T {
  const apiRes = sdkResponse as { data: unknown };
  const body = apiRes.data as Record<string, unknown>;

  // Gateway envelope: { success, data, meta }
  if (body && typeof body === 'object' && 'success' in body && 'data' in body) {
    return body.data as T;
  }

  return body as T;
}

export function useGeminiApi() {
  const shellOrigin = useMemo(
    () => (typeof window !== 'undefined' ? window.location.origin : ''),
    [],
  );
  const apiClient = useApiClient({ baseUrl: shellOrigin });
  const teamContext = useTeam();
  const teamId = teamContext?.currentTeam?.id;

  const headers = useCallback(() => {
    const h: Record<string, string> = {};
    if (teamId) h['x-team-id'] = teamId;
    return h;
  }, [teamId]);

  const generateContent = useCallback(
    async (request: GeminiRequest): Promise<GeminiResponse> => {
      const res = await apiClient.post(
        `${GW_GEMINI_BASE}/chat`,
        request,
        headers(),
      );
      return unwrap<GeminiResponse>(res);
    },
    [apiClient, headers],
  );

  return useMemo(() => ({ generateContent }), [generateContent]);
}
