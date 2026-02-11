/**
 * LivepeerAIClient
 *
 * Typed client for go-livepeer's AI Gateway API.
 * Handles batch AI pipelines, LLM streaming, live video-to-video, and BYOC.
 */

import type { Capability } from '../types.js';

export interface TextToImageRequest {
  prompt: string;
  model_id?: string;
  width?: number;
  height?: number;
  guidance_scale?: number;
  num_images_per_prompt?: number;
  seed?: number;
  negative_prompt?: string;
}

export interface ImageResponse {
  images: Array<{ url: string; seed?: number }>;
}

export interface LLMRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface LLMResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface LLMChunk {
  choices: Array<{
    delta: { content?: string };
    finish_reason: string | null;
  }>;
}

export interface LiveV2VRequest {
  model_id: string;
  params?: Record<string, unknown>;
  publish_url?: string;
  subscribe_url?: string;
}

export interface LiveV2VSession {
  publishUrl: string;
  subscribeUrl: string;
  controlUrl: string;
  eventsUrl: string;
}

export class LivepeerAIClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:9935') {
    // Validate baseUrl to prevent SSRF via constructor injection
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`LivepeerAIClient: unsupported protocol "${parsed.protocol}"`);
    }
    // Only allow loopback hosts for the AI gateway to avoid SSRF against arbitrary hosts.
    const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
    if (!allowedHosts.has(parsed.hostname)) {
      throw new Error(`LivepeerAIClient: disallowed hostname "${parsed.hostname}"`);
    }
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Sanitize a path segment to prevent path traversal attacks.
   * Validates the segment doesn't contain traversal sequences, then encodes.
   */
  private sanitizePath(segment: string): string {
    if (typeof segment !== 'string' || segment.length === 0) {
      throw new Error('Path segment must be a non-empty string');
    }
    if (segment.includes('..') || segment.includes('/') || segment.includes('\\')) {
      throw new Error(`Invalid path segment: contains traversal characters`);
    }
    return encodeURIComponent(segment);
  }

  // --- Batch AI Pipelines ---

  async textToImage(params: TextToImageRequest): Promise<ImageResponse> {
    return this.postJSON<ImageResponse>('/text-to-image', params);
  }

  async imageToImage(image: File | Blob, params: Record<string, unknown>): Promise<ImageResponse> {
    return this.postMultipart<ImageResponse>('/image-to-image', image, params);
  }

  async imageToVideo(image: File | Blob, params: Record<string, unknown>): Promise<{ video: { url: string } }> {
    return this.postMultipart('/image-to-video', image, params);
  }

  async upscale(image: File | Blob, params: Record<string, unknown>): Promise<ImageResponse> {
    return this.postMultipart<ImageResponse>('/upscale', image, params);
  }

  async audioToText(audio: File | Blob, params?: Record<string, unknown>): Promise<{ text: string }> {
    return this.postMultipart('/audio-to-text', audio, params || {});
  }

  async segmentAnything2(image: File | Blob, params?: Record<string, unknown>): Promise<{ masks: string[] }> {
    return this.postMultipart('/segment-anything-2', image, params || {});
  }

  async imageToText(image: File | Blob, params?: Record<string, unknown>): Promise<{ text: string }> {
    return this.postMultipart('/image-to-text', image, params || {});
  }

  async textToSpeech(params: { text: string; model_id?: string }): Promise<ArrayBuffer> {
    const res = await fetch(`${this.baseUrl}/text-to-speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`Text-to-speech failed: ${res.status}`);
    return res.arrayBuffer();
  }

  // --- LLM ---

  async llm(params: LLMRequest): Promise<LLMResponse> {
    return this.postJSON<LLMResponse>('/llm', { ...params, stream: false });
  }

  async *llmStream(params: LLMRequest): AsyncIterable<LLMChunk> {
    const res = await fetch(`${this.baseUrl}/llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, stream: true }),
    });

    if (!res.ok) throw new Error(`LLM stream failed: ${res.status}`);

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            yield JSON.parse(data) as LLMChunk;
          } catch {
            // Skip malformed chunks
          }
        }
      }
    }
  }

  // --- Live Video-to-Video ---

  async startLiveVideoToVideo(stream: string, params: LiveV2VRequest): Promise<LiveV2VSession> {
    return this.postJSON<LiveV2VSession>(`/live/video-to-video/${this.sanitizePath(stream)}`, params);
  }

  async updateLiveVideoToVideo(stream: string, params: Record<string, unknown>): Promise<void> {
    await this.postJSON(`/live/video-to-video/${this.sanitizePath(stream)}/update`, params);
  }

  async getLiveVideoStatus(streamId: string): Promise<{ status: string }> {
    const safeId = this.sanitizePath(streamId);
    const res = await fetch(`${this.baseUrl}/live/video-to-video/${safeId}/status`);
    if (!res.ok) throw new Error(`Get live status failed: ${res.status}`);
    return res.json();
  }

  // --- BYOC ---

  async processRequest(capability: string, body: unknown, headers?: Record<string, string>): Promise<unknown> {
    const safeCapability = this.sanitizePath(capability);
    const res = await fetch(`${this.baseUrl}/${safeCapability}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`BYOC request failed: ${res.status}`);
    return res.json();
  }

  async getNetworkCapabilities(): Promise<Capability[]> {
    const res = await fetch(`${this.baseUrl}/getNetworkCapabilities`);
    if (!res.ok) throw new Error(`Get capabilities failed: ${res.status}`);
    const data = await res.json();
    return data.capabilities || [];
  }

  // --- Helpers ---

  private async postJSON<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`AI API ${path} failed: ${res.status} ${text}`);
    }
    return res.json() as Promise<T>;
  }

  private async postMultipart<T>(path: string, file: File | Blob, params: Record<string, unknown>): Promise<T> {
    const formData = new FormData();
    formData.append('image', file);
    for (const [key, value] of Object.entries(params)) {
      formData.append(key, String(value));
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`AI API ${path} failed: ${res.status} ${text}`);
    }
    return res.json() as Promise<T>;
  }
}
