/**
 * Cache Alignment Validation Tests
 *
 * Ensures HTTP Cache-Control s-maxage headers are properly aligned with
 * origin TTL constants to prevent serving stale data from CDN/browser cache.
 *
 * Critical Rule: HTTP s-maxage MUST NOT exceed origin TTL
 *
 * See /docs/CACHING_STRATEGY.md for detailed caching architecture.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { TTL, dashboardRouteCacheControl } from '../cache';

describe('Dashboard Route Cache Alignment', () => {
  /**
   * Maps dashboard API routes to their expected TTL constants.
   * Update this mapping when adding new routes or changing cache strategy.
   */
  const ROUTE_TTL_MAP: Record<string, keyof typeof TTL> = {
    'pipeline-catalog/route.ts': 'PIPELINE_CATALOG',
    'kpi/route.ts': 'KPI',
    'pipelines/route.ts': 'PIPELINES',
    'pricing/route.ts': 'PRICING',
    'orchestrators/route.ts': 'ORCHESTRATORS',
    'fees/route.ts': 'FEES',
    'protocol/route.ts': 'PROTOCOL',
    'gpu-capacity/route.ts': 'GPU_CAPACITY',
  };

  /**
   * Extract s-maxage value from Cache-Control header string.
   * Returns null if not found.
   */
  function extractSMaxAge(cacheControl: string): number | null {
    const match = cacheControl.match(/s-maxage=(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Resolve the effective Cache-Control value for a route file.
   * Supports a string literal or `dashboardRouteCacheControl(TTL.KEY)` (must match expectedTtlKey).
   */
  function getRouteCacheControl(
    routePath: string,
    expectedTtlKey: keyof typeof TTL,
  ): string | null {
    try {
      const fullPath = join(__dirname, '../../../app/api/v1/dashboard', routePath);
      const content = readFileSync(fullPath, 'utf-8');

      const literal = content.match(/headers\.set\(['"]Cache-Control['"],\s*['"]([^'"]+)['"]\)/);
      if (literal) return literal[1];

      const helper = content.match(
        /headers\.set\(['"]Cache-Control['"],\s*dashboardRouteCacheControl\(TTL\.(\w+)\)\s*\)/,
      );
      if (!helper) return null;
      const keyInFile = helper[1] as keyof typeof TTL;
      if (keyInFile !== expectedTtlKey) return null;
      return dashboardRouteCacheControl(TTL[keyInFile]);
    } catch {
      return null;
    }
  }

  describe('HTTP s-maxage ≤ Origin TTL', () => {
    Object.entries(ROUTE_TTL_MAP).forEach(([routePath, ttlKey]) => {
      it(`${routePath} should have s-maxage ≤ ${ttlKey} TTL`, () => {
        const cacheControl = getRouteCacheControl(routePath, ttlKey);
        expect(cacheControl).toBeTruthy();
        
        const sMaxAge = extractSMaxAge(cacheControl!);
        expect(sMaxAge).not.toBeNull();
        
        const originTtlMs = TTL[ttlKey];
        const originTtlSec = originTtlMs / 1000;
        
        expect(sMaxAge).toBeLessThanOrEqual(originTtlSec);
      });
    });
  });

  describe('Cache Strategy Consistency', () => {
    it('should use aggressive caching (s-maxage = TTL) for all routes', () => {
      Object.entries(ROUTE_TTL_MAP).forEach(([routePath, ttlKey]) => {
        const cacheControl = getRouteCacheControl(routePath, ttlKey);
        if (!cacheControl) return; // Skip if route not found
        
        const sMaxAge = extractSMaxAge(cacheControl);
        const originTtlSec = TTL[ttlKey] / 1000;
        
        // Aggressive strategy: s-maxage should equal TTL (within 1 second tolerance)
        expect(Math.abs(sMaxAge! - originTtlSec)).toBeLessThanOrEqual(1);
      });
    });

    it('should include stale-while-revalidate for graceful degradation', () => {
      Object.entries(ROUTE_TTL_MAP).forEach(([routePath, ttlKey]) => {
        const cacheControl = getRouteCacheControl(routePath, ttlKey);
        if (!cacheControl) return;
        
        expect(cacheControl).toMatch(/stale-while-revalidate=\d+/);
      });
    });

    it('should use public cache directive for all routes', () => {
      Object.entries(ROUTE_TTL_MAP).forEach(([routePath, ttlKey]) => {
        const cacheControl = getRouteCacheControl(routePath, ttlKey);
        if (!cacheControl) return;
        
        expect(cacheControl).toContain('public');
      });
    });
  });

  describe('TTL Constants', () => {
    it('should have all expected TTL constants defined', () => {
      const requiredKeys: (keyof typeof TTL)[] = [
        'KPI',
        'PIPELINES',
        'PIPELINE_CATALOG',
        'ORCHESTRATORS',
        'GPU_CAPACITY',
        'PRICING',
        'JOB_FEED',
        'PROTOCOL',
        'FEES',
      ];

      requiredKeys.forEach((key) => {
        expect(TTL[key]).toBeDefined();
        expect(TTL[key]).toBeGreaterThan(0);
      });
    });

    it('should have TTL values in milliseconds (not seconds)', () => {
      // Sanity check: all TTL values should be at least 30,000ms (30s)
      Object.values(TTL).forEach((ttl) => {
        expect(ttl).toBeGreaterThanOrEqual(30_000);
      });
    });
  });
});

describe('Cache Alignment Documentation', () => {
  it('should have CACHING_STRATEGY.md documentation', () => {
    const docPath = join(__dirname, '../../../../../../docs/CACHING_STRATEGY.md');
    expect(() => readFileSync(docPath, 'utf-8')).not.toThrow();
  });

  it('CACHING_STRATEGY.md should reference all TTL constants', () => {
    const docPath = join(__dirname, '../../../../../../docs/CACHING_STRATEGY.md');
    const content = readFileSync(docPath, 'utf-8');
    
    // Check that major TTL constants are documented
    expect(content).toContain('KPI');
    expect(content).toContain('PIPELINES');
    expect(content).toContain('PIPELINE_CATALOG');
    expect(content).toContain('FEES');
  });
});
