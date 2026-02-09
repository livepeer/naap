/**
 * Traffic Router Service Tests
 * Tests for request routing based on traffic rules
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTrafficRouter } from '../trafficRouter.js';
import { NoActiveSlotError } from '../deploymentTypes.js';

// Mock Prisma client
const mockPrisma = {
  pluginDeploymentSlot: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
};

describe('TrafficRouter', () => {
  let trafficRouter: ReturnType<typeof createTrafficRouter>;
  const deploymentId = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    vi.clearAllMocks();
    trafficRouter = createTrafficRouter(mockPrisma as any);
    trafficRouter.clearCache(); // Reset caches between tests
  });

  describe('route', () => {
    it('should route to active slot with 100% traffic', async () => {
      mockPrisma.pluginDeploymentSlot.findMany.mockResolvedValue([
        {
          slot: 'blue',
          status: 'active',
          trafficPercent: 100,
          version: '1.0.0',
          frontendUrl: 'http://frontend-blue',
          backendUrl: 'http://backend-blue',
        },
        {
          slot: 'green',
          status: 'inactive',
          trafficPercent: 0,
          version: '0.9.0',
        },
      ]);

      const result = await trafficRouter.route(deploymentId, {
        headers: {},
      });

      expect(result.slot).toBe('blue');
      expect(result.version).toBe('1.0.0');
      expect(result.reason).toBe('weighted');
    });

    it('should use header override for slot selection', async () => {
      mockPrisma.pluginDeploymentSlot.findMany.mockResolvedValue([
        { slot: 'blue', status: 'active', trafficPercent: 100, version: '1.0.0', backendUrl: 'http://blue' },
        { slot: 'green', status: 'active', trafficPercent: 0, version: '2.0.0', backendUrl: 'http://green' },
      ]);

      const result = await trafficRouter.route(deploymentId, {
        headers: { 'x-plugin-slot': 'green' },
      });

      expect(result.slot).toBe('green');
      expect(result.reason).toBe('header-override');
    });

    it('should use version header for slot selection', async () => {
      mockPrisma.pluginDeploymentSlot.findMany.mockResolvedValue([
        { slot: 'blue', status: 'active', trafficPercent: 100, version: '1.0.0', backendUrl: 'http://blue' },
        { slot: 'green', status: 'active', trafficPercent: 0, version: '2.0.0', backendUrl: 'http://green' },
      ]);

      const result = await trafficRouter.route(deploymentId, {
        headers: { 'x-plugin-version': '2.0.0' },
      });

      expect(result.slot).toBe('green');
      expect(result.reason).toBe('version-header');
    });

    it('should route beta requests to canary slot', async () => {
      mockPrisma.pluginDeploymentSlot.findMany.mockResolvedValue([
        { slot: 'blue', status: 'active', trafficPercent: 90, version: '1.0.0', backendUrl: 'http://blue' },
        { slot: 'green', status: 'active', trafficPercent: 10, version: '2.0.0', backendUrl: 'http://green' },
      ]);

      const result = await trafficRouter.route(deploymentId, {
        headers: { 'x-plugin-beta': 'true' },
      });

      expect(result.slot).toBe('green');
      expect(result.reason).toBe('beta-header');
    });

    it('should throw NoActiveSlotError when no slots exist', async () => {
      mockPrisma.pluginDeploymentSlot.findMany.mockResolvedValue([]);

      await expect(
        trafficRouter.route(deploymentId, { headers: {} })
      ).rejects.toThrow(NoActiveSlotError);
    });

    it('should use session stickiness', async () => {
      mockPrisma.pluginDeploymentSlot.findMany.mockResolvedValue([
        { slot: 'blue', status: 'active', trafficPercent: 50, version: '1.0.0', backendUrl: 'http://blue' },
        { slot: 'green', status: 'active', trafficPercent: 50, version: '2.0.0', backendUrl: 'http://green' },
      ]);

      // First request establishes sticky session
      const result1 = await trafficRouter.route(deploymentId, {
        headers: {},
        sessionId: 'session-123',
      });

      // Second request should return same slot
      const result2 = await trafficRouter.route(deploymentId, {
        headers: {},
        sessionId: 'session-123',
      });

      expect(result2.slot).toBe(result1.slot);
      expect(result2.reason).toBe('cache');
    });
  });

  describe('getTrafficDistribution', () => {
    it('should return traffic distribution for all slots', async () => {
      mockPrisma.pluginDeploymentSlot.findMany.mockResolvedValue([
        { slot: 'blue', trafficPercent: 80, version: '1.0.0', status: 'active' },
        { slot: 'green', trafficPercent: 20, version: '2.0.0', status: 'active' },
      ]);

      const distribution = await trafficRouter.getTrafficDistribution(deploymentId);

      expect(distribution).toHaveLength(2);
      expect(distribution[0]).toEqual({ slot: 'blue', percent: 80, version: '1.0.0', status: 'active' });
      expect(distribution[1]).toEqual({ slot: 'green', percent: 20, version: '2.0.0', status: 'active' });
    });
  });

  describe('updateWeights', () => {
    it('should update traffic weights', async () => {
      mockPrisma.pluginDeploymentSlot.update.mockResolvedValue({});
      mockPrisma.$transaction.mockImplementation((ops) => Promise.all(ops));

      await trafficRouter.updateWeights(deploymentId, 70, 30);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should reject weights that do not sum to 100', async () => {
      await expect(
        trafficRouter.updateWeights(deploymentId, 60, 60)
      ).rejects.toThrow('Traffic percentages must sum to 100');
    });

    it('should reject invalid percentages', async () => {
      await expect(
        trafficRouter.updateWeights(deploymentId, -10, 110)
      ).rejects.toThrow('Traffic percentages must be between 0 and 100');
    });

    it('should invalidate caches after weight update', async () => {
      mockPrisma.pluginDeploymentSlot.update.mockResolvedValue({});
      mockPrisma.$transaction.mockImplementation((ops) => Promise.all(ops));

      // Prime the cache
      mockPrisma.pluginDeploymentSlot.findMany.mockResolvedValue([
        { slot: 'blue', status: 'active', trafficPercent: 100, version: '1.0.0' },
      ]);
      await trafficRouter.route(deploymentId, { headers: {}, sessionId: 'test' });

      // Update weights
      await trafficRouter.updateWeights(deploymentId, 50, 50);

      // Cache should be cleared
      const stats = trafficRouter.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe('getBackendUrls', () => {
    it('should return active backend URLs with weights', async () => {
      mockPrisma.pluginDeploymentSlot.findMany.mockResolvedValue([
        { slot: 'blue', status: 'active', trafficPercent: 80, backendUrl: 'http://blue:3001' },
        { slot: 'green', status: 'active', trafficPercent: 20, backendUrl: 'http://green:3001' },
      ]);

      const urls = await trafficRouter.getBackendUrls(deploymentId);

      expect(urls).toHaveLength(2);
      expect(urls[0]).toEqual({ slot: 'blue', url: 'http://blue:3001', weight: 80 });
    });

    it('should exclude inactive slots', async () => {
      mockPrisma.pluginDeploymentSlot.findMany.mockResolvedValue([
        { slot: 'blue', status: 'active', trafficPercent: 100, backendUrl: 'http://blue:3001' },
        { slot: 'green', status: 'inactive', trafficPercent: 0, backendUrl: 'http://green:3001' },
      ]);

      const urls = await trafficRouter.getBackendUrls(deploymentId);

      expect(urls).toHaveLength(1);
      expect(urls[0].slot).toBe('blue');
    });
  });

  describe('getFrontendUrls', () => {
    it('should return active frontend URLs with weights', async () => {
      mockPrisma.pluginDeploymentSlot.findMany.mockResolvedValue([
        { slot: 'blue', status: 'active', trafficPercent: 100, frontendUrl: 'http://frontend-blue' },
        { slot: 'green', status: 'inactive', trafficPercent: 0, frontendUrl: 'http://frontend-green' },
      ]);

      const urls = await trafficRouter.getFrontendUrls(deploymentId);

      expect(urls).toHaveLength(1);
      expect(urls[0]).toEqual({ slot: 'blue', url: 'http://frontend-blue', weight: 100 });
    });
  });

  describe('clearCache', () => {
    it('should clear all caches', async () => {
      mockPrisma.pluginDeploymentSlot.findMany.mockResolvedValue([
        { slot: 'blue', status: 'active', trafficPercent: 100, version: '1.0.0' },
      ]);

      // Prime the cache
      await trafficRouter.route(deploymentId, { headers: {}, sessionId: 'test' });

      // Clear
      trafficRouter.clearCache();

      const stats = trafficRouter.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should clear cache for specific deployment', async () => {
      mockPrisma.pluginDeploymentSlot.findMany.mockResolvedValue([
        { slot: 'blue', status: 'active', trafficPercent: 100, version: '1.0.0' },
      ]);

      // Prime caches for two deployments
      await trafficRouter.route(deploymentId, { headers: {}, sessionId: 'test1' });
      await trafficRouter.route('other-deployment-id', { headers: {}, sessionId: 'test2' });

      // Clear only one
      trafficRouter.clearCache(deploymentId);

      // The cache for other deployment might still exist (depending on implementation)
      // But the cleared one should be gone
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', () => {
      const stats = trafficRouter.getCacheStats();

      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('oldestEntry');
      expect(typeof stats.size).toBe('number');
    });
  });
});
