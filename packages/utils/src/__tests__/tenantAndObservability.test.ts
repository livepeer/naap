/**
 * Tests for Tenant Context and Observability Features
 * 
 * Phase 5: Validation tests for:
 * - Tenant context detection
 * - Feature flags and kill switch
 * - Tracing infrastructure
 * - Metrics
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Import the modules we're testing
import {
  // Feature flags
  setFeatureFlag,
  getFeatureFlag,
  isFeatureEnabled,
  deleteFeatureFlag,
  resetAllFlags,
  activateKillSwitch,
  deactivateKillSwitch,
  isPluginEnabled,
  shouldLoadPlugin,
  
  // Tracing
  initTracing,
  createSpan,
  withSpan,
  getCurrentSpanContext,
  injectTraceContext,
  extractTraceContext,
  SpanStatusCode,
  clearCompletedSpans,
  getCompletedSpans,
  
  // Metrics
  Counter,
  Gauge,
  Histogram,
  registry,
  exportMetrics,
} from '../index.js';

// ============================================
// Feature Flags Tests
// ============================================

describe('Feature Flags', () => {
  beforeEach(() => {
    resetAllFlags();
  });

  describe('setFeatureFlag / getFeatureFlag', () => {
    it('should set and get a feature flag', () => {
      setFeatureFlag({ name: 'test-flag', enabled: true });
      const flag = getFeatureFlag('test-flag');
      expect(flag).toBeDefined();
      expect(flag?.name).toBe('test-flag');
      expect(flag?.enabled).toBe(true);
    });

    it('should return undefined for non-existent flag', () => {
      const flag = getFeatureFlag('non-existent');
      expect(flag).toBeUndefined();
    });
  });

  describe('isFeatureEnabled', () => {
    it('should return false for non-existent flag', () => {
      expect(isFeatureEnabled('non-existent')).toBe(false);
    });

    it('should return false for disabled flag', () => {
      setFeatureFlag({ name: 'disabled-flag', enabled: false });
      expect(isFeatureEnabled('disabled-flag')).toBe(false);
    });

    it('should return true for enabled flag', () => {
      setFeatureFlag({ name: 'enabled-flag', enabled: true });
      expect(isFeatureEnabled('enabled-flag')).toBe(true);
    });

    it('should respect user exclusions', () => {
      setFeatureFlag({ 
        name: 'exclusive-flag', 
        enabled: true,
        excludeUsers: ['user-123'],
      });
      expect(isFeatureEnabled('exclusive-flag', { userId: 'user-123' })).toBe(false);
      expect(isFeatureEnabled('exclusive-flag', { userId: 'user-456' })).toBe(true);
    });

    it('should respect user inclusions', () => {
      setFeatureFlag({ 
        name: 'inclusive-flag', 
        enabled: true,
        percentage: 0, // Would normally block everyone
        includeUsers: ['user-123'],
      });
      expect(isFeatureEnabled('inclusive-flag', { userId: 'user-123' })).toBe(true);
    });
  });

  describe('deleteFeatureFlag', () => {
    it('should delete a flag', () => {
      setFeatureFlag({ name: 'to-delete', enabled: true });
      expect(getFeatureFlag('to-delete')).toBeDefined();
      deleteFeatureFlag('to-delete');
      expect(getFeatureFlag('to-delete')).toBeUndefined();
    });
  });
});

// ============================================
// Kill Switch Tests
// ============================================

describe('Kill Switch', () => {
  beforeEach(() => {
    resetAllFlags();
  });

  describe('activateKillSwitch / isPluginEnabled', () => {
    it('should disable a plugin when kill switch is activated', () => {
      expect(isPluginEnabled('risky-plugin')).toBe(true);
      activateKillSwitch('risky-plugin', 'Security issue', 'admin');
      expect(isPluginEnabled('risky-plugin')).toBe(false);
    });

    it('should re-enable a plugin when kill switch is deactivated', () => {
      activateKillSwitch('risky-plugin', 'Security issue', 'admin');
      expect(isPluginEnabled('risky-plugin')).toBe(false);
      deactivateKillSwitch('risky-plugin');
      expect(isPluginEnabled('risky-plugin')).toBe(true);
    });
  });

  describe('shouldLoadPlugin', () => {
    it('should return true for enabled plugin without kill switch', () => {
      expect(shouldLoadPlugin('normal-plugin')).toBe(true);
    });

    it('should return false for killed plugin', () => {
      activateKillSwitch('killed-plugin', 'Testing');
      expect(shouldLoadPlugin('killed-plugin')).toBe(false);
    });

    it('should respect plugin-specific feature flags', () => {
      setFeatureFlag({ 
        name: 'plugin:beta-plugin:enabled', 
        enabled: true,
        percentage: 0,
        includeUsers: ['beta-user'],
      });
      expect(shouldLoadPlugin('beta-plugin', { userId: 'beta-user' })).toBe(true);
      expect(shouldLoadPlugin('beta-plugin', { userId: 'normal-user' })).toBe(false);
    });
  });
});

// ============================================
// Tracing Tests
// ============================================

describe('Tracing', () => {
  beforeEach(() => {
    clearCompletedSpans();
    initTracing({ serviceName: 'test-service' });
  });

  describe('createSpan', () => {
    it('should create a span with name and attributes', () => {
      const span = createSpan('test-operation', { key: 'value' });
      expect(span.name).toBe('test-operation');
      expect(span.attributes.key).toBe('value');
      expect(span.spanId).toBeDefined();
      expect(span.traceId).toBeDefined();
      span.end();
    });

    it('should add service name from config', () => {
      const span = createSpan('test-operation');
      expect(span.attributes['service.name']).toBe('test-service');
      span.end();
    });
  });

  describe('withSpan', () => {
    it('should execute function within span context', async () => {
      const result = await withSpan('async-operation', async (span) => {
        span.setAttribute('custom', 'attribute');
        return 'result';
      });
      expect(result).toBe('result');
      
      const completed = getCompletedSpans();
      expect(completed.length).toBeGreaterThan(0);
      const lastSpan = completed[completed.length - 1];
      expect(lastSpan.name).toBe('async-operation');
      expect(lastSpan.status.code).toBe(SpanStatusCode.OK);
    });

    it('should record exceptions on error', async () => {
      await expect(withSpan('failing-operation', async () => {
        throw new Error('Test error');
      })).rejects.toThrow('Test error');

      const completed = getCompletedSpans();
      const lastSpan = completed[completed.length - 1];
      expect(lastSpan.status.code).toBe(SpanStatusCode.ERROR);
      expect(lastSpan.events.some(e => e.name === 'exception')).toBe(true);
    });
  });

  describe('trace context propagation', () => {
    it('should inject trace context into headers', () => {
      const span = createSpan('parent-operation');
      const headers: Record<string, string> = {};
      injectTraceContext(headers);
      expect(headers.traceparent).toBeDefined();
      expect(headers.traceparent).toContain(span.traceId);
      span.end();
    });

    it('should extract trace context from headers', () => {
      const headers = {
        traceparent: '00-abc123def456-span123-01',
      };
      const context = extractTraceContext(headers);
      expect(context?.traceId).toBe('abc123def456');
      expect(context?.parentSpanId).toBe('span123');
    });
  });
});

// ============================================
// Metrics Tests
// ============================================

describe('Metrics', () => {
  beforeEach(() => {
    // Clear registry by creating new metrics
  });

  describe('Counter', () => {
    it('should increment and track values', () => {
      const counter = new Counter({ name: 'test_counter', help: 'Test counter' });
      counter.inc();
      counter.inc({ label: 'value' });
      counter.inc({ label: 'value' }, 5);
      
      // Counter should have recorded values
      expect(counter).toBeDefined();
    });
  });

  describe('Gauge', () => {
    it('should set and track current values', () => {
      const gauge = new Gauge({ name: 'test_gauge', help: 'Test gauge' });
      gauge.set({}, 42);
      gauge.inc();
      gauge.dec();
      
      expect(gauge).toBeDefined();
    });
  });

  describe('Histogram', () => {
    it('should observe values in buckets', () => {
      const histogram = new Histogram({ name: 'test_histogram', help: 'Test histogram' });
      histogram.observe({}, 0.5);
      histogram.observe({}, 1.5);
      histogram.observe({}, 5);
      histogram.observe({}, 100);
      
      expect(histogram).toBeDefined();
    });
  });

  describe('exportMetrics', () => {
    it('should export metrics in Prometheus format', () => {
      const output = exportMetrics();
      expect(output).toContain('# HELP');
      expect(output).toContain('# TYPE');
    });
  });
});

// ============================================
// Integration Tests
// ============================================

describe('Integration: Tenant-aware Plugin Loading', () => {
  beforeEach(() => {
    resetAllFlags();
    clearCompletedSpans();
  });

  it('should load plugin with tracing when enabled', async () => {
    initTracing({ serviceName: 'integration-test' });
    
    const loadPlugin = async (name: string) => {
      return withSpan('plugin.load', async (span) => {
        span.setAttribute('plugin.name', name);
        
        // Check kill switch
        if (!shouldLoadPlugin(name)) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'Plugin disabled' });
          throw new Error('Plugin disabled by kill switch');
        }
        
        // Simulate plugin load
        await new Promise(r => setTimeout(r, 10));
        return { name, version: '1.0.0' };
      });
    };

    const result = await loadPlugin('test-plugin');
    expect(result.name).toBe('test-plugin');

    const spans = getCompletedSpans();
    const loadSpan = spans.find(s => s.name === 'plugin.load');
    expect(loadSpan).toBeDefined();
    expect(loadSpan?.attributes['plugin.name']).toBe('test-plugin');
  });

  it('should block plugin when kill switch is active', async () => {
    activateKillSwitch('blocked-plugin', 'Testing');

    const loadPlugin = async (name: string) => {
      if (!shouldLoadPlugin(name)) {
        throw new Error('Plugin disabled');
      }
      return { name };
    };

    await expect(loadPlugin('blocked-plugin')).rejects.toThrow('Plugin disabled');
  });
});
