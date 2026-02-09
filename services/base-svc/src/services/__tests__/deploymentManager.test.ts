/**
 * Deployment Manager Service Tests
 * Tests for blue-green and canary deployment strategies
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { createDeploymentManager, type DeploymentStrategy } from '../deploymentManager.js';
import { ConcurrentDeploymentError, InvalidDeploymentIdError } from '../deploymentTypes.js';

// Mock Prisma client
const mockPrisma = {
  pluginDeploymentSlot: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  pluginDeployment: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  deploymentEvent: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  $transaction: vi.fn(),
};

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('DeploymentManager', () => {
  let deploymentManager: ReturnType<typeof createDeploymentManager>;
  const validDeploymentId = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    vi.clearAllMocks();
    deploymentManager = createDeploymentManager(mockPrisma as any);

    // Default mock for slot initialization
    mockPrisma.pluginDeploymentSlot.findMany.mockResolvedValue([
      {
        id: 'slot-1',
        deploymentId: validDeploymentId,
        slot: 'blue',
        version: '1.0.0',
        status: 'active',
        trafficPercent: 100,
        frontendUrl: 'http://frontend-blue',
        backendUrl: 'http://backend-blue:3001',
        healthStatus: 'healthy',
        deployedAt: new Date(),
      },
      {
        id: 'slot-2',
        deploymentId: validDeploymentId,
        slot: 'green',
        version: '1.0.0',
        status: 'inactive',
        trafficPercent: 0,
        healthStatus: null,
        deployedAt: null,
      },
    ]);

    mockPrisma.deploymentEvent.create.mockResolvedValue({ id: 'event-1' });
    mockPrisma.$transaction.mockImplementation((operations) => Promise.all(operations));
  });

  describe('Input Validation', () => {
    it('should reject invalid deployment ID', async () => {
      const strategy: DeploymentStrategy = { type: 'blue-green' };

      await expect(deploymentManager.deploy({
        deploymentId: 'invalid-id',
        version: '2.0.0',
        strategy,
      })).rejects.toThrow(InvalidDeploymentIdError);
    });

    it('should reject invalid version format', async () => {
      const strategy: DeploymentStrategy = { type: 'blue-green' };

      await expect(deploymentManager.deploy({
        deploymentId: validDeploymentId,
        version: 'not-semver',
        strategy,
      })).rejects.toThrow('Invalid version format');
    });
  });

  describe('Concurrent Deployment Protection', () => {
    it('should prevent concurrent deployments', async () => {
      const strategy: DeploymentStrategy = { type: 'blue-green' };

      // Mock slow deployment
      mockPrisma.pluginDeploymentSlot.update.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 1000))
      );
      mockFetch.mockResolvedValue({ ok: true, json: () => ({ status: 'healthy' }) });

      // Start first deployment (don't await)
      const deploy1 = deploymentManager.deploy({
        deploymentId: validDeploymentId,
        version: '2.0.0',
        strategy,
      });

      // Try concurrent deployment
      const deploy2Promise = deploymentManager.deploy({
        deploymentId: validDeploymentId,
        version: '2.1.0',
        strategy,
      });

      await expect(deploy2Promise).rejects.toThrow(ConcurrentDeploymentError);

      // Cancel first deployment
      deploy1.catch(() => {}); // Ignore any errors
    });
  });

  describe('getStatus', () => {
    it('should return current deployment status', async () => {
      mockPrisma.deploymentEvent.findFirst.mockResolvedValue({
        id: 'event-1',
        type: 'deploy_complete',
        createdAt: new Date(),
      });

      const status = await deploymentManager.getStatus(validDeploymentId);

      expect(status.deploymentId).toBe(validDeploymentId);
      expect(status.activeSlot).toBe('blue');
      expect(status.activeVersion).toBe('1.0.0');
      expect(status.slots).toHaveLength(2);
      expect(status.isDeploying).toBe(false);
    });

    it('should detect deploying status', async () => {
      mockPrisma.pluginDeploymentSlot.findMany.mockResolvedValue([
        { slot: 'blue', status: 'active', trafficPercent: 100, version: '1.0.0' },
        { slot: 'green', status: 'deploying', trafficPercent: 0, version: '2.0.0' },
      ]);

      const status = await deploymentManager.getStatus(validDeploymentId);

      expect(status.isDeploying).toBe(true);
    });
  });

  describe('rollback', () => {
    it('should rollback to previous slot', async () => {
      mockPrisma.pluginDeploymentSlot.update.mockResolvedValue({});

      const result = await deploymentManager.rollback(validDeploymentId, 'user-1', 'Test rollback');

      expect(result.success).toBe(true);
      expect(result.rolledBackTo).toBe('green');
      expect(mockPrisma.deploymentEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'rollback',
            initiatedBy: 'user-1',
          }),
        })
      );
    });
  });

  describe('shiftTraffic', () => {
    it('should shift traffic to target slot', async () => {
      mockPrisma.pluginDeploymentSlot.update.mockResolvedValue({});

      await deploymentManager.shiftTraffic(validDeploymentId, 'green', 50);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.deploymentEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'traffic_shift',
            trafficPercent: 50,
          }),
        })
      );
    });

    it('should reject invalid traffic percentage', async () => {
      await expect(
        deploymentManager.shiftTraffic(validDeploymentId, 'green', 150)
      ).rejects.toThrow('Invalid traffic percentage');
    });
  });

  describe('getDefaults', () => {
    it('should return default configurations', () => {
      const defaults = deploymentManager.getDefaults();

      expect(defaults.canary.initialPercent).toBe(5);
      expect(defaults.canary.incrementPercent).toBe(25);
      expect(defaults.healthCheck.endpoint).toBe('/healthz');
      expect(defaults.rollback.onHealthCheckFail).toBe(true);
    });
  });

  describe('getHistory', () => {
    it('should return deployment history', async () => {
      const mockEvents = [
        { id: '1', type: 'deploy_complete', createdAt: new Date() },
        { id: '2', type: 'deploy_start', createdAt: new Date() },
      ];
      mockPrisma.deploymentEvent.findMany.mockResolvedValue(mockEvents);

      const history = await deploymentManager.getHistory(validDeploymentId, 10);

      expect(history).toHaveLength(2);
      expect(mockPrisma.deploymentEvent.findMany).toHaveBeenCalledWith({
        where: { deploymentId: validDeploymentId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    });
  });

  describe('updateSlotHealth', () => {
    it('should update slot health status', async () => {
      mockPrisma.pluginDeploymentSlot.update.mockResolvedValue({});

      await deploymentManager.updateSlotHealth(validDeploymentId, 'blue', 'unhealthy', 3);

      expect(mockPrisma.pluginDeploymentSlot.update).toHaveBeenCalledWith({
        where: { deploymentId_slot: { deploymentId: validDeploymentId, slot: 'blue' } },
        data: expect.objectContaining({
          healthStatus: 'unhealthy',
          healthCheckFailures: 3,
        }),
      });
    });
  });
});
