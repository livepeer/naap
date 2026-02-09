/**
 * Live Video Adapter (Phase 5c)
 *
 * Handles WHIP/WHEP + live video-to-video + trickle control.
 * Session lifecycle management for live AI video transformation.
 */

import type { LivepeerAIClient } from '@naap/livepeer-node-client';
import type { IPipelineAdapter, PipelineDescriptor } from '@naap/livepeer-pipeline';
import type { PipelineContext, PipelineResult } from './BatchAIAdapter.js';

interface LiveSession {
  streamId: string;
  publishUrl: string;
  subscribeUrl: string;
  controlUrl: string;
  eventsUrl: string;
  createdAt: number;
  status: 'active' | 'stopped' | 'error';
  params: Record<string, unknown>;
}

export class LiveVideoAdapter implements IPipelineAdapter {
  readonly name = 'live-video';
  readonly type = 'stream' as const;

  private sessions = new Map<string, LiveSession>();

  constructor(private aiClient: LivepeerAIClient) {}

  canHandle(pipeline: PipelineDescriptor): boolean {
    return pipeline.name === 'live-video-to-video' || pipeline.type === 'stream';
  }

  /** Start a live video-to-video session */
  async execute(input: unknown, ctx: PipelineContext): Promise<PipelineResult> {
    const body = input as Record<string, unknown>;
    const streamId = (body.stream as string) || crypto.randomUUID();

    const session = await this.aiClient.startLiveVideoToVideo(streamId, body as Parameters<LivepeerAIClient['startLiveVideoToVideo']>[1]);

    const liveSession: LiveSession = {
      streamId,
      publishUrl: session.publishUrl,
      subscribeUrl: session.subscribeUrl,
      controlUrl: session.controlUrl,
      eventsUrl: session.eventsUrl,
      createdAt: Date.now(),
      status: 'active',
      params: body,
    };

    this.sessions.set(streamId, liveSession);

    return {
      result: {
        publishUrl: session.publishUrl,
        subscribeUrl: session.subscribeUrl,
        controlUrl: session.controlUrl,
        eventsUrl: session.eventsUrl,
        streamId,
      },
      model: (body.model_id as string) || 'default',
      orchestrator: 'auto',
    };
  }

  /** Get session status */
  async getSessionStatus(streamId: string): Promise<LiveSession | null> {
    const local = this.sessions.get(streamId);
    if (!local) return null;

    try {
      const remoteStatus = await this.aiClient.getLiveVideoStatus(streamId);
      return { ...local, ...remoteStatus } as unknown as LiveSession;
    } catch {
      return local;
    }
  }

  /** Update session parameters (trickle control) */
  async updateSession(streamId: string, params: Record<string, unknown>): Promise<void> {
    const session = this.sessions.get(streamId);
    if (!session) throw new Error(`Session ${streamId} not found`);

    await this.aiClient.updateLiveVideoToVideo(streamId, params as Parameters<LivepeerAIClient['updateLiveVideoToVideo']>[1]);
    session.params = { ...session.params, ...params };
  }

  /** Stop a live session */
  stopSession(streamId: string): void {
    const session = this.sessions.get(streamId);
    if (session) {
      session.status = 'stopped';
    }
  }

  /** List all active sessions */
  listSessions(): LiveSession[] {
    return Array.from(this.sessions.values()).filter((s) => s.status === 'active');
  }

  /** Cleanup stale sessions */
  cleanupStaleSessions(maxAgeMs: number = 3600_000): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, session] of this.sessions) {
      if (session.status !== 'active' && now - session.createdAt > maxAgeMs) {
        this.sessions.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }
}
