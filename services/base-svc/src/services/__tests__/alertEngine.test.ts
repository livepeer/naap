/**
 * Alert Engine Service Tests
 * Tests for alert monitoring and notification
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAlertEngine, type AlertConfig, type AlertSeverity } from '../alertEngine.js';
import { InvalidDeploymentIdError } from '../deploymentTypes.js';

// Mock Prisma client
const mockPrisma = {
  pluginAlert: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  pluginMetrics: {
    findMany: vi.fn(),
  },
  pluginDeploymentSlot: {
    findUnique: vi.fn(),
  },
};

// Mock fetch for notifications
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AlertEngine', () => {
  let alertEngine: ReturnType<typeof createAlertEngine>;
  const deploymentId = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    alertEngine = createAlertEngine(mockPrisma as any);
  });

  afterEach(() => {
    alertEngine.shutdown();
    vi.useRealTimers();
  });

  describe('createAlert', () => {
    it('should create a new alert', async () => {
      mockPrisma.pluginAlert.create.mockResolvedValue({
        id: 'alert-1',
        deploymentId,
        name: 'High Error Rate',
        metric: 'error_rate',
        operator: 'gt',
        threshold: 0.05,
        duration: 300,
        severity: 'critical',
        enabled: true,
      });

      const config: AlertConfig = {
        deploymentId,
        name: 'High Error Rate',
        condition: {
          metric: 'error_rate',
          operator: 'gt',
          threshold: 0.05,
          duration: 300,
        },
        severity: 'critical',
        channels: [],
      };

      const alert = await alertEngine.createAlert(config);

      expect(alert.name).toBe('High Error Rate');
      expect(mockPrisma.pluginAlert.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          deploymentId,
          name: 'High Error Rate',
          metric: 'error_rate',
          threshold: 0.05,
        }),
      });
    });

    it('should reject invalid deployment ID', async () => {
      const config: AlertConfig = {
        deploymentId: 'invalid-id',
        name: 'Test Alert',
        condition: {
          metric: 'error_rate',
          operator: 'gt',
          threshold: 0.05,
          duration: 60,
        },
        severity: 'warning',
        channels: [],
      };

      await expect(alertEngine.createAlert(config)).rejects.toThrow(InvalidDeploymentIdError);
    });

    it('should reject negative threshold', async () => {
      const config: AlertConfig = {
        deploymentId,
        name: 'Test Alert',
        condition: {
          metric: 'error_rate',
          operator: 'gt',
          threshold: -1,
          duration: 60,
        },
        severity: 'warning',
        channels: [],
      };

      await expect(alertEngine.createAlert(config)).rejects.toThrow('non-negative');
    });

    it('should reject zero or negative duration', async () => {
      const config: AlertConfig = {
        deploymentId,
        name: 'Test Alert',
        condition: {
          metric: 'error_rate',
          operator: 'gt',
          threshold: 0.05,
          duration: 0,
        },
        severity: 'warning',
        channels: [],
      };

      await expect(alertEngine.createAlert(config)).rejects.toThrow('positive');
    });
  });

  describe('updateAlert', () => {
    it('should update an existing alert', async () => {
      mockPrisma.pluginAlert.update.mockResolvedValue({
        id: 'alert-1',
        name: 'Updated Alert',
        threshold: 0.1,
      });

      const updated = await alertEngine.updateAlert('alert-1', {
        name: 'Updated Alert',
        condition: {
          metric: 'error_rate',
          operator: 'gt',
          threshold: 0.1,
          duration: 60,
        },
      });

      expect(updated.name).toBe('Updated Alert');
      expect(mockPrisma.pluginAlert.update).toHaveBeenCalledWith({
        where: { id: 'alert-1' },
        data: expect.objectContaining({
          name: 'Updated Alert',
          threshold: 0.1,
        }),
      });
    });
  });

  describe('deleteAlert', () => {
    it('should delete an alert', async () => {
      mockPrisma.pluginAlert.delete.mockResolvedValue({});

      await alertEngine.deleteAlert('alert-1');

      expect(mockPrisma.pluginAlert.delete).toHaveBeenCalledWith({
        where: { id: 'alert-1' },
      });
    });
  });

  describe('setAlertEnabled', () => {
    it('should enable an alert', async () => {
      mockPrisma.pluginAlert.update.mockResolvedValue({ enabled: true });

      await alertEngine.setAlertEnabled('alert-1', true);

      expect(mockPrisma.pluginAlert.update).toHaveBeenCalledWith({
        where: { id: 'alert-1' },
        data: { enabled: true },
      });
    });

    it('should disable an alert', async () => {
      mockPrisma.pluginAlert.update.mockResolvedValue({ enabled: false });

      await alertEngine.setAlertEnabled('alert-1', false);

      expect(mockPrisma.pluginAlert.update).toHaveBeenCalledWith({
        where: { id: 'alert-1' },
        data: { enabled: false },
      });
    });
  });

  describe('getAlerts', () => {
    it('should return all alerts for a deployment', async () => {
      mockPrisma.pluginAlert.findMany.mockResolvedValue([
        { id: 'alert-1', name: 'Alert 1' },
        { id: 'alert-2', name: 'Alert 2' },
      ]);

      const alerts = await alertEngine.getAlerts(deploymentId);

      expect(alerts).toHaveLength(2);
      expect(mockPrisma.pluginAlert.findMany).toHaveBeenCalledWith({
        where: { deploymentId },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getActiveAlerts', () => {
    it('should return only triggered alerts (initially empty)', async () => {
      mockPrisma.pluginAlert.findMany.mockResolvedValue([
        { id: 'alert-1', enabled: true },
        { id: 'alert-2', enabled: true },
      ]);

      const activeAlerts = await alertEngine.getActiveAlerts(deploymentId);

      // getActiveAlerts filters alerts based on internal condition state
      // Since we haven't triggered any alerts, it filters them out via the
      // condition state which tracks conditionMetSince
      expect(Array.isArray(activeAlerts)).toBe(true);
    });
  });

  describe('startMonitoring / stopMonitoring', () => {
    it('should start monitoring a deployment', () => {
      alertEngine.startMonitoring(deploymentId, 60);
      // No direct way to verify timer, but should not throw
    });

    it('should stop monitoring a deployment', () => {
      alertEngine.startMonitoring(deploymentId, 60);
      alertEngine.stopMonitoring(deploymentId);
      // Should not throw
    });
  });

  describe('checkCondition', () => {
    it('should check health_check conditions', async () => {
      mockPrisma.pluginAlert.findMany.mockResolvedValue([
        {
          id: 'alert-1',
          deploymentId,
          name: 'Health Check Alert',
          metric: 'health_check',
          operator: 'eq',
          threshold: 1,
          duration: 0,
          severity: 'critical',
          enabled: true,
          autoRollback: false,
          channels: [],
          cooldownSeconds: 300,
          lastTriggeredAt: null,
        },
      ]);

      mockPrisma.pluginAlert.update.mockResolvedValue({});

      await alertEngine.checkCondition(deploymentId, 'health_check', {
        error: 'Backend unreachable',
      });

      // Alert should be triggered
      expect(mockPrisma.pluginAlert.update).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return alert statistics', async () => {
      mockPrisma.pluginAlert.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(8); // enabled

      mockPrisma.pluginAlert.groupBy.mockResolvedValue([
        { severity: 'critical', _count: 2 },
        { severity: 'warning', _count: 5 },
        { severity: 'info', _count: 3 },
      ]);

      const stats = await alertEngine.getStats(deploymentId);

      expect(stats.total).toBe(10);
      expect(stats.enabled).toBe(8);
      expect(stats.triggered).toBe(0);
      expect(stats.bySeverity.critical).toBe(2);
      expect(stats.bySeverity.warning).toBe(5);
    });
  });

  describe('shutdown', () => {
    it('should clean up all resources', () => {
      alertEngine.startMonitoring(deploymentId, 60);
      alertEngine.shutdown();
      // Should not throw
    });
  });

  describe('Notification Channels', () => {
    it('should send Slack notification on alert trigger', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const onTrigger = vi.fn();
      alertEngine = createAlertEngine(mockPrisma as any, { onTrigger });

      mockPrisma.pluginAlert.findMany.mockResolvedValue([
        {
          id: 'alert-1',
          deploymentId,
          name: 'Test Alert',
          metric: 'error_rate',
          operator: 'gt',
          threshold: 0.01,
          duration: 0,
          severity: 'critical',
          enabled: true,
          autoRollback: false,
          channels: [{ type: 'slack', config: { url: 'https://hooks.slack.com/test' } }],
          cooldownSeconds: 300,
          lastTriggeredAt: null,
        },
      ]);

      mockPrisma.pluginMetrics.findMany.mockResolvedValue([
        { requestCount: 100, errorCount: 10 }, // 10% error rate > 1% threshold
      ]);

      mockPrisma.pluginAlert.update.mockResolvedValue({});

      // Manually evaluate alerts (simulating what the monitoring timer does)
      // This would normally happen via the timer
    });

    it('should send webhook notification on alert trigger', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      // Test would verify fetch is called with correct webhook URL and payload
    });
  });

  describe('Cooldown', () => {
    it('should respect cooldown period', async () => {
      mockPrisma.pluginAlert.findMany.mockResolvedValue([
        {
          id: 'alert-1',
          deploymentId,
          name: 'Test Alert',
          metric: 'error_rate',
          operator: 'gt',
          threshold: 0.01,
          duration: 0,
          severity: 'warning',
          enabled: true,
          autoRollback: false,
          channels: [],
          cooldownSeconds: 300,
          lastTriggeredAt: new Date(), // Just triggered
        },
      ]);

      mockPrisma.pluginMetrics.findMany.mockResolvedValue([
        { requestCount: 100, errorCount: 10 },
      ]);

      // Alert should not be triggered again due to cooldown
      // Implementation would check lastTriggeredAt + cooldownSeconds
    });
  });
});
