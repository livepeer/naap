/**
 * Pipeline SDK Hooks (Phase 5)
 *
 * High-level hooks for AI/video pipeline integration.
 * Consume pipeline-gateway via the shell API client.
 */

import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation } from './useQuery.js';
import { useShell } from './useShell.js';

const PIPELINE_API = '/api/v1/pipelines';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PipelineDescriptor {
  name: string;
  type: 'batch' | 'stream';
  models: Array<{ id: string; name: string }>;
  source: string;
}

interface PipelineEnvelope<T = unknown> {
  version: string;
  pipeline: string;
  model: string;
  status: 'success' | 'pending' | 'error';
  requestId: string;
  result: T;
  metadata: {
    cost: string;
    duration: number;
    orchestrator: string;
    cached: boolean;
  };
  error?: { code: string; message: string };
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

/** List available pipelines (auto-filtered by feature flags). */
export function usePipelines() {
  const shell = useShell();
  return useQuery<PipelineDescriptor[]>(
    'pipelines:available',
    async () => {
      const res = await shell.api!.get<{ data: PipelineDescriptor[] }>(`${PIPELINE_API}/pipelines`);
      return res.data;
    },
    { staleTime: 60_000 }
  );
}

/** Execute a specific pipeline. */
export function usePipeline<T = unknown>(pipelineName: string) {
  const shell = useShell();
  const [result, setResult] = useState<PipelineEnvelope<T> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(async (input: unknown, params?: Record<string, unknown>) => {
    setLoading(true);
    setError(null);

    try {
      const res = await shell.api!.post<PipelineEnvelope<T>>(
        `${PIPELINE_API}/pipelines/${pipelineName}`,
        { ...input as Record<string, unknown>, ...params }
      );

      if (res.status === 'error') {
        throw new Error(res.error?.message || 'Pipeline execution failed');
      }

      setResult(res);
      setLoading(false);
      return res;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setLoading(false);
      throw e;
    }
  }, [shell, pipelineName]);

  return { execute, result, loading, error };
}

/** LLM chat with streaming support. */
export function useLLM() {
  const shell = useShell();
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const chat = useCallback(async (
    userMessages: Array<{ role: string; content: string }>,
    opts?: { model?: string; maxTokens?: number; temperature?: number }
  ) => {
    setLoading(true);
    setError(null);

    try {
      const res = await shell.api!.post<PipelineEnvelope<{
        choices: Array<{ message: { role: string; content: string } }>;
      }>>(
        `${PIPELINE_API}/pipelines/llm`,
        { messages: userMessages, ...opts, stream: false }
      );

      const assistantMessage = res.result?.choices?.[0]?.message;
      if (assistantMessage) {
        setMessages([...userMessages, assistantMessage]);
      }

      setLoading(false);
      return res;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setLoading(false);
      throw e;
    }
  }, [shell]);

  const streamChat = useCallback(async (
    userMessages: Array<{ role: string; content: string }>,
    onChunk: (text: string) => void,
    opts?: { model?: string; maxTokens?: number; temperature?: number }
  ) => {
    setLoading(true);
    setError(null);

    abortRef.current = new AbortController();

    try {
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const response = await fetch(`${baseUrl}${PIPELINE_API}/pipelines/llm/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: userMessages, ...opts, stream: true }),
        signal: abortRef.current.signal,
      });

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No stream body');

      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;
            try {
              const chunk = JSON.parse(data);
              const content = chunk.choices?.[0]?.delta?.content;
              if (content) {
                fullContent += content;
                onChunk(content);
              }
            } catch {
              // Skip
            }
          }
        }
      }

      setMessages([...userMessages, { role: 'assistant', content: fullContent }]);
      setLoading(false);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setLoading(false);
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { chat, streamChat, stop, messages, loading, error };
}

/** Poll an async pipeline job (Phase 5 hooks). */
export function useAsyncJob(pipelineName: string, requestId: string | null) {
  const shell = useShell();
  return useQuery(
    requestId ? `pipeline:job:${requestId}` : null,
    async () => {
      if (!requestId) return null;
      const res = await shell.api!.get<{
        data: {
          requestId: string;
          pipeline: string;
          status: 'pending' | 'processing' | 'completed' | 'error';
          result?: unknown;
          error?: string;
          submittedAt: number;
          completedAt?: number;
        };
      }>(`${PIPELINE_API}/pipelines/${pipelineName}/jobs/${requestId}`);
      return res.data;
    },
    {
      enabled: !!requestId,
      refetchInterval: 2000, // poll every 2s
    }
  );
}

/** Get pipeline usage quota / stats (Phase 5 hooks). */
export function usePipelineQuota() {
  const shell = useShell();
  return useQuery(
    'pipeline:usage',
    async () => {
      const res = await shell.api!.get<{
        data: Array<{
          pipeline: string;
          requests: number;
          errors: number;
          totalDurationMs: number;
          periodStart: number;
        }>;
      }>(`${PIPELINE_API}/usage`);
      return res.data;
    },
    { staleTime: 30_000 }
  );
}

/** Get per-pipeline feature flags. */
export function usePipelineFlags() {
  const shell = useShell();
  return useQuery(
    'pipeline:flags',
    async () => {
      const res = await shell.api!.get<{
        data: Record<string, { enabled: boolean; maxRequestsPerMinute?: number }>;
      }>(`${PIPELINE_API}/flags`);
      return res.data;
    },
    { staleTime: 60_000 }
  );
}

/** Live video session management. */
export function useLiveSession(streamId?: string) {
  const shell = useShell();
  const [session, setSession] = useState<{
    publishUrl: string;
    subscribeUrl: string;
    controlUrl: string;
    eventsUrl: string;
  } | null>(null);

  const startSession = useMutation(
    async (params: { model_id: string; [key: string]: unknown }) => {
      const res = await shell.api!.post<PipelineEnvelope<{
        publishUrl: string;
        subscribeUrl: string;
        controlUrl: string;
        eventsUrl: string;
      }>>(`${PIPELINE_API}/pipelines/live-video-to-video/sessions`, {
        stream: streamId || crypto.randomUUID(),
        ...params,
      });
      setSession(res.result);
      return res.result;
    }
  );

  const update = useMutation(
    async (params: Record<string, unknown>) => {
      if (!streamId) throw new Error('No streamId');
      return shell.api!.patch(`${PIPELINE_API}/pipelines/live-video-to-video/sessions/${streamId}`, params);
    }
  );

  const stop = useMutation(
    async () => {
      if (!streamId) throw new Error('No streamId');
      return shell.api!.delete(`${PIPELINE_API}/pipelines/live-video-to-video/sessions/${streamId}`);
    }
  );

  const status = useQuery(
    `pipeline:live-session:${streamId}`,
    async () => {
      if (!streamId) return null;
      return shell.api!.get(`${PIPELINE_API}/pipelines/live-video-to-video/sessions/${streamId}`);
    },
    { enabled: !!streamId, refetchInterval: 5000 }
  );

  return { session, start: startSession, update, stop, status };
}
