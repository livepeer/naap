import { describe, it, expect, beforeEach } from 'vitest';
import { LLMBudgetTracker } from '../llm-budget.js';

describe('LLMBudgetTracker', () => {
  let tracker: LLMBudgetTracker;

  beforeEach(() => {
    tracker = new LLMBudgetTracker();
  });

  describe('canMakeCall', () => {
    it('allows calls when no usage recorded', () => {
      expect(tracker.canMakeCall('tenant-1')).toBe(true);
    });

    it('allows calls within budget', () => {
      tracker.recordUsage({
        tenant_id: 'tenant-1',
        model_tier: 'haiku',
        input_tokens: 100,
        output_tokens: 50,
        cost_cents: 10,
        timestamp: new Date().toISOString(),
      });
      expect(tracker.canMakeCall('tenant-1')).toBe(true);
    });

    it('blocks calls when budget exceeded', () => {
      tracker.recordUsage({
        tenant_id: 'tenant-1',
        model_tier: 'sonnet',
        input_tokens: 10000,
        output_tokens: 5000,
        cost_cents: 100, // Over default $0.50 budget
        timestamp: new Date().toISOString(),
      });
      expect(tracker.canMakeCall('tenant-1')).toBe(false);
    });

    it('uses custom budget when provided', () => {
      tracker.recordUsage({
        tenant_id: 'tenant-1',
        model_tier: 'sonnet',
        input_tokens: 10000,
        output_tokens: 5000,
        cost_cents: 100,
        timestamp: new Date().toISOString(),
      });
      // With higher budget, still allowed
      expect(tracker.canMakeCall('tenant-1', 200)).toBe(true);
    });
  });

  describe('calculateCost', () => {
    it('calculates haiku cost correctly', () => {
      const cost = LLMBudgetTracker.calculateCost('haiku', 1000, 500);
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(100); // Should be very cheap
    });

    it('sonnet costs more than haiku', () => {
      const haikuCost = LLMBudgetTracker.calculateCost('haiku', 1000, 500);
      const sonnetCost = LLMBudgetTracker.calculateCost('sonnet', 1000, 500);
      expect(sonnetCost).toBeGreaterThan(haikuCost);
    });

    it('opus costs more than sonnet', () => {
      const sonnetCost = LLMBudgetTracker.calculateCost('sonnet', 1000, 500);
      const opusCost = LLMBudgetTracker.calculateCost('opus', 1000, 500);
      expect(opusCost).toBeGreaterThan(sonnetCost);
    });
  });

  describe('getDailyUsage', () => {
    it('returns null when no usage', () => {
      expect(tracker.getDailyUsage('tenant-1')).toBeNull();
    });

    it('returns accumulated usage', () => {
      tracker.recordUsage({ tenant_id: 't1', model_tier: 'haiku', input_tokens: 100, output_tokens: 50, cost_cents: 5, timestamp: new Date().toISOString() });
      tracker.recordUsage({ tenant_id: 't1', model_tier: 'haiku', input_tokens: 200, output_tokens: 100, cost_cents: 10, timestamp: new Date().toISOString() });

      const usage = tracker.getDailyUsage('t1');
      expect(usage).not.toBeNull();
      expect(usage!.calls).toBe(2);
      expect(usage!.costCents).toBe(15);
    });
  });
});
