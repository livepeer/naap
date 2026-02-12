/**
 * Unit tests for Session Tracking Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the db client module - vi.mock is hoisted, so we define mock inside
vi.mock('../../db/client.js', () => ({
  prisma: {
    daydreamSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
  },
}));

// Import after mocking
import {
  startSession,
  endSession,
  endSessionByStreamId,
  errorSession,
  getUsageStats,
  getSessionHistory,
  getActiveSession,
  cleanupStaleSessions,
} from '../sessions.js';
import { prisma } from '../../db/client.js';

// Get typed mock
const mockPrisma = prisma as unknown as {
  daydreamSession: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    aggregate: ReturnType<typeof vi.fn>;
  };
};

describe('Session Tracking Service', () => {
  const TEST_USER_ID = 'user_123';
  const TEST_STREAM_ID = 'str_abc123';
  const TEST_SESSION_ID = 'session_xyz789';
  const TEST_PLAYBACK_ID = 'playback_def456';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('startSession', () => {
    it('should create a new session', async () => {
      const mockSession = {
        id: TEST_SESSION_ID,
        userId: TEST_USER_ID,
        streamId: TEST_STREAM_ID,
        playbackId: TEST_PLAYBACK_ID,
        startedAt: new Date(),
        endedAt: null,
        durationMins: 0,
        status: 'active',
        prompt: 'test prompt',
      };

      mockPrisma.daydreamSession.create.mockResolvedValueOnce(mockSession);

      const result = await startSession({
        userId: TEST_USER_ID,
        streamId: TEST_STREAM_ID,
        playbackId: TEST_PLAYBACK_ID,
        prompt: 'test prompt',
        seed: 42,
      });

      expect(mockPrisma.daydreamSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: TEST_USER_ID,
          streamId: TEST_STREAM_ID,
          playbackId: TEST_PLAYBACK_ID,
          prompt: 'test prompt',
          seed: 42,
          status: 'active',
        }),
      });

      expect(result.id).toBe(TEST_SESSION_ID);
      expect(result.status).toBe('active');
    });
  });

  describe('endSession', () => {
    it('should end a session and calculate duration', async () => {
      const startTime = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
      
      const mockSession = {
        id: TEST_SESSION_ID,
        userId: TEST_USER_ID,
        streamId: TEST_STREAM_ID,
        startedAt: startTime,
        status: 'active',
      };

      mockPrisma.daydreamSession.findUnique.mockResolvedValueOnce(mockSession);
      mockPrisma.daydreamSession.update.mockResolvedValueOnce({
        ...mockSession,
        endedAt: new Date(),
        durationMins: 5,
        status: 'ended',
      });

      const result = await endSession(TEST_SESSION_ID);

      expect(mockPrisma.daydreamSession.update).toHaveBeenCalledWith({
        where: { id: TEST_SESSION_ID },
        data: expect.objectContaining({
          status: 'ended',
          endedAt: expect.any(Date),
          durationMins: expect.any(Number),
        }),
      });

      expect(result.status).toBe('ended');
      expect(result.durationMins).toBeGreaterThan(0);
    });

    it('should throw error for non-existent session', async () => {
      mockPrisma.daydreamSession.findUnique.mockResolvedValueOnce(null);

      await expect(endSession('nonexistent')).rejects.toThrow('Session not found');
    });
  });

  describe('endSessionByStreamId', () => {
    it('should find and end active session by stream ID', async () => {
      const startTime = new Date(Date.now() - 10 * 60 * 1000);
      
      const mockSession = {
        id: TEST_SESSION_ID,
        streamId: TEST_STREAM_ID,
        startedAt: startTime,
        status: 'active',
      };

      mockPrisma.daydreamSession.findFirst.mockResolvedValueOnce(mockSession);
      mockPrisma.daydreamSession.findUnique.mockResolvedValueOnce(mockSession);
      mockPrisma.daydreamSession.update.mockResolvedValueOnce({
        ...mockSession,
        status: 'ended',
        endedAt: new Date(),
        durationMins: 10,
      });

      const result = await endSessionByStreamId(TEST_STREAM_ID);

      expect(result).not.toBeNull();
      expect(result?.status).toBe('ended');
    });

    it('should return null for non-existent stream', async () => {
      mockPrisma.daydreamSession.findFirst.mockResolvedValueOnce(null);

      const result = await endSessionByStreamId('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('errorSession', () => {
    it('should mark session as errored', async () => {
      const mockSession = {
        id: TEST_SESSION_ID,
        startedAt: new Date(Date.now() - 1000),
        status: 'active',
      };

      mockPrisma.daydreamSession.findUnique.mockResolvedValueOnce(mockSession);
      mockPrisma.daydreamSession.update.mockResolvedValueOnce({
        ...mockSession,
        status: 'error',
        errorMessage: 'Connection lost',
        endedAt: new Date(),
      });

      const result = await errorSession(TEST_SESSION_ID, 'Connection lost');

      expect(mockPrisma.daydreamSession.update).toHaveBeenCalledWith({
        where: { id: TEST_SESSION_ID },
        data: expect.objectContaining({
          status: 'error',
          errorMessage: 'Connection lost',
        }),
      });

      expect(result.status).toBe('error');
    });
  });

  describe('getUsageStats', () => {
    it('should return aggregated usage stats', async () => {
      mockPrisma.daydreamSession.count
        .mockResolvedValueOnce(10) // totalSessions
        .mockResolvedValueOnce(1); // activeSessions

      mockPrisma.daydreamSession.aggregate.mockResolvedValueOnce({
        _sum: { durationMins: 45.5 },
      });

      const stats = await getUsageStats(TEST_USER_ID);

      expect(stats.totalSessions).toBe(10);
      expect(stats.activeSessions).toBe(1);
      expect(stats.totalMinutes).toBe(45.5);
    });

    it('should handle zero usage', async () => {
      mockPrisma.daydreamSession.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      mockPrisma.daydreamSession.aggregate.mockResolvedValueOnce({
        _sum: { durationMins: null },
      });

      const stats = await getUsageStats(TEST_USER_ID);

      expect(stats.totalSessions).toBe(0);
      expect(stats.activeSessions).toBe(0);
      expect(stats.totalMinutes).toBe(0);
    });
  });

  describe('getSessionHistory', () => {
    it('should return paginated session history', async () => {
      const mockSessions = [
        { id: 'session1', startedAt: new Date() },
        { id: 'session2', startedAt: new Date() },
      ];

      mockPrisma.daydreamSession.findMany.mockResolvedValueOnce(mockSessions);

      const result = await getSessionHistory(TEST_USER_ID, 10, 0);

      expect(mockPrisma.daydreamSession.findMany).toHaveBeenCalledWith({
        where: { userId: TEST_USER_ID },
        orderBy: { startedAt: 'desc' },
        take: 10,
        skip: 0,
      });

      expect(result).toHaveLength(2);
    });
  });

  describe('getActiveSession', () => {
    it('should return the most recent active session', async () => {
      const mockSession = {
        id: TEST_SESSION_ID,
        status: 'active',
        startedAt: new Date(),
      };

      mockPrisma.daydreamSession.findFirst.mockResolvedValueOnce(mockSession);

      const result = await getActiveSession(TEST_USER_ID);

      expect(mockPrisma.daydreamSession.findFirst).toHaveBeenCalledWith({
        where: { userId: TEST_USER_ID, status: 'active' },
        orderBy: { startedAt: 'desc' },
      });

      expect(result?.id).toBe(TEST_SESSION_ID);
    });

    it('should return null when no active session', async () => {
      mockPrisma.daydreamSession.findFirst.mockResolvedValueOnce(null);

      const result = await getActiveSession(TEST_USER_ID);

      expect(result).toBeNull();
    });
  });

  describe('cleanupStaleSessions', () => {
    it('should mark stale sessions as ended', async () => {
      mockPrisma.daydreamSession.updateMany.mockResolvedValueOnce({ count: 3 });

      const cleaned = await cleanupStaleSessions();

      expect(mockPrisma.daydreamSession.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'active',
          startedAt: { lt: expect.any(Date) },
        },
        data: {
          status: 'ended',
          endedAt: expect.any(Date),
          errorMessage: 'Session timed out (stale)',
        },
      });

      expect(cleaned).toBe(3);
    });
  });
});
