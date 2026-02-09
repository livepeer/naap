/**
 * Session Tracking Service
 * 
 * Manages streaming session records for usage tracking
 */

import { prisma } from '../db/client.js';

export interface StartSessionParams {
  userId: string;
  streamId: string;
  playbackId: string;
  whipUrl?: string;
  prompt?: string;
  seed?: number;
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
  startedAt: Date;
  endedAt: Date | null;
  durationMins: number;
  status: string;
  prompt: string | null;
}

/**
 * Start a new streaming session
 */
export async function startSession(params: StartSessionParams): Promise<SessionRecord> {
  const session = await prisma.daydreamSession.create({
    data: {
      userId: params.userId,
      streamId: params.streamId,
      playbackId: params.playbackId,
      whipUrl: params.whipUrl,
      prompt: params.prompt,
      seed: params.seed,
      status: 'active',
    },
  });

  return session;
}

/**
 * End a streaming session
 */
export async function endSession(sessionId: string): Promise<SessionRecord> {
  const session = await prisma.daydreamSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const endedAt = new Date();
  const durationMs = endedAt.getTime() - session.startedAt.getTime();
  const durationMins = Math.round((durationMs / 1000 / 60) * 100) / 100; // 2 decimal places

  const updated = await prisma.daydreamSession.update({
    where: { id: sessionId },
    data: {
      endedAt,
      durationMins,
      status: 'ended',
    },
  });

  return updated;
}

/**
 * End a session by stream ID
 */
export async function endSessionByStreamId(streamId: string): Promise<SessionRecord | null> {
  const session = await prisma.daydreamSession.findFirst({
    where: { streamId, status: 'active' },
  });

  if (!session) {
    return null;
  }

  return endSession(session.id);
}

/**
 * Mark a session as errored
 */
export async function errorSession(sessionId: string, errorMessage: string): Promise<SessionRecord> {
  const session = await prisma.daydreamSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const endedAt = new Date();
  const durationMs = endedAt.getTime() - session.startedAt.getTime();
  const durationMins = Math.round((durationMs / 1000 / 60) * 100) / 100;

  const updated = await prisma.daydreamSession.update({
    where: { id: sessionId },
    data: {
      endedAt,
      durationMins,
      status: 'error',
      errorMessage,
    },
  });

  return updated;
}

/**
 * Get usage statistics for a user
 */
export async function getUsageStats(userId: string): Promise<UsageStats> {
  const [totalSessions, activeSessions, totalMinutesResult] = await Promise.all([
    prisma.daydreamSession.count({
      where: { userId },
    }),
    prisma.daydreamSession.count({
      where: { userId, status: 'active' },
    }),
    prisma.daydreamSession.aggregate({
      where: { userId },
      _sum: { durationMins: true },
    }),
  ]);

  return {
    totalSessions,
    activeSessions,
    totalMinutes: Math.round((totalMinutesResult._sum.durationMins || 0) * 100) / 100,
  };
}

/**
 * Get session history for a user
 */
export async function getSessionHistory(
  userId: string,
  limit = 50,
  offset = 0
): Promise<SessionRecord[]> {
  const sessions = await prisma.daydreamSession.findMany({
    where: { userId },
    orderBy: { startedAt: 'desc' },
    take: limit,
    skip: offset,
  });

  return sessions;
}

/**
 * Get active session for a user
 */
export async function getActiveSession(userId: string): Promise<SessionRecord | null> {
  const session = await prisma.daydreamSession.findFirst({
    where: { userId, status: 'active' },
    orderBy: { startedAt: 'desc' },
  });

  return session;
}

/**
 * Clean up stale sessions (older than 1 hour and still marked active)
 */
export async function cleanupStaleSessions(): Promise<number> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const result = await prisma.daydreamSession.updateMany({
    where: {
      status: 'active',
      startedAt: { lt: oneHourAgo },
    },
    data: {
      status: 'ended',
      endedAt: new Date(),
      errorMessage: 'Session timed out (stale)',
    },
  });

  return result.count;
}
