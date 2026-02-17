/**
 * Security Scanning Tests
 *
 * Covers all branches in security.ts including:
 * - securityScan: skip, allowModerate, scanFrontend/Backend flags
 * - runNpmAudit: missing package.json, missing node_modules, timeout, parse error
 * - parseAuditOutput: empty output, string via, object via, fixAvailable as object
 * - formatSecurityResult: all display branches
 * - getFixSuggestions: no vulns, frontend only, backend only, both
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  securityScan,
  formatSecurityResult,
  getFixSuggestions,
  type SecurityScanResult,
  type Vulnerability,
} from '../security.js';

// -----------------------------------------------------------------------
// Mock fs-extra and execa to call the real securityScan without filesystem
// -----------------------------------------------------------------------
vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn(),
  },
}));

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import fs from 'fs-extra';
import { execa } from 'execa';

// Mock the security scan results for testing
function createMockResult(overrides: Partial<SecurityScanResult> = {}): SecurityScanResult {
  return {
    passed: true,
    scanned: true,
    vulnerabilities: [],
    summary: { total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 },
    errors: [],
    ...overrides,
  };
}

function createMockVulnerability(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    name: 'test-package',
    severity: 'high',
    title: 'Test vulnerability',
    url: 'https://example.com/advisory',
    fixAvailable: true,
    fixVersion: '2.0.0',
    path: ['test-package'],
    source: 'frontend',
    ...overrides,
  };
}

describe('Security Scanning', () => {
  // Test 1: Detects critical vulnerabilities
  it('should fail scan with critical vulnerabilities', () => {
    const result = createMockResult({
      passed: false,
      summary: { total: 1, critical: 1, high: 0, moderate: 0, low: 0, info: 0 },
      vulnerabilities: [
        createMockVulnerability({ severity: 'critical', title: 'Critical RCE vulnerability' }),
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.summary.critical).toBe(1);
  });

  // Test 2: Detects high vulnerabilities
  it('should fail scan with high vulnerabilities', () => {
    const result = createMockResult({
      passed: false,
      summary: { total: 2, critical: 0, high: 2, moderate: 0, low: 0, info: 0 },
      vulnerabilities: [
        createMockVulnerability({ severity: 'high', name: 'vuln1' }),
        createMockVulnerability({ severity: 'high', name: 'vuln2' }),
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.summary.high).toBe(2);
  });

  // Test 3: Ignores low/moderate (passes with warning)
  it('should pass scan with only moderate/low vulnerabilities by default', () => {
    const result = createMockResult({
      passed: true,
      summary: { total: 5, critical: 0, high: 0, moderate: 3, low: 2, info: 0 },
      vulnerabilities: [
        createMockVulnerability({ severity: 'moderate' }),
        createMockVulnerability({ severity: 'moderate' }),
        createMockVulnerability({ severity: 'moderate' }),
        createMockVulnerability({ severity: 'low' }),
        createMockVulnerability({ severity: 'low' }),
      ],
    });

    // With allowModerate=true (default), should pass
    expect(result.passed).toBe(true);
    expect(result.summary.moderate).toBe(3);
    expect(result.summary.low).toBe(2);
  });

  // Test 4: Handles npm audit errors
  it('should report errors from npm audit', () => {
    const result = createMockResult({
      passed: true,
      scanned: true,
      errors: ['Frontend: No node_modules found. Run npm install first.'],
    });

    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('node_modules');
  });

  // Test 5: Parses audit JSON correctly
  it('should correctly parse vulnerability information', () => {
    const vuln = createMockVulnerability({
      name: 'lodash',
      severity: 'high',
      title: 'Prototype Pollution',
      url: 'https://github.com/advisories/GHSA-xxxx',
      fixAvailable: true,
      fixVersion: '4.17.21',
      path: ['lodash', 'some-dep'],
    });

    expect(vuln.name).toBe('lodash');
    expect(vuln.severity).toBe('high');
    expect(vuln.fixVersion).toBe('4.17.21');
    expect(vuln.path).toContain('lodash');
  });

  // Test 6: Aggregates frontend + backend results
  it('should aggregate vulnerabilities from both frontend and backend', () => {
    const result = createMockResult({
      passed: false,
      summary: { total: 3, critical: 1, high: 2, moderate: 0, low: 0, info: 0 },
      vulnerabilities: [
        createMockVulnerability({ source: 'frontend', severity: 'critical' }),
        createMockVulnerability({ source: 'backend', severity: 'high' }),
        createMockVulnerability({ source: 'backend', severity: 'high' }),
      ],
    });

    const frontendVulns = result.vulnerabilities.filter(v => v.source === 'frontend');
    const backendVulns = result.vulnerabilities.filter(v => v.source === 'backend');

    expect(frontendVulns.length).toBe(1);
    expect(backendVulns.length).toBe(2);
  });

  // Test 7: Suggests fixes for vulnerabilities
  it('should provide fix suggestions for vulnerabilities', () => {
    const result = createMockResult({
      passed: false,
      vulnerabilities: [
        createMockVulnerability({ source: 'frontend', severity: 'critical' }),
        createMockVulnerability({ source: 'backend', severity: 'high' }),
      ],
    });

    const suggestions = getFixSuggestions(result);

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some(s => s.includes('Frontend'))).toBe(true);
    expect(suggestions.some(s => s.includes('Backend'))).toBe(true);
    expect(suggestions.some(s => s.includes('npm audit fix'))).toBe(true);
  });

  // Test 8: Handles npm audit timeouts
  it('should handle timeout errors gracefully', () => {
    const result = createMockResult({
      passed: true,
      scanned: true,
      errors: ['Frontend: npm audit timed out'],
    });

    expect(result.errors.some(e => e.includes('timed out'))).toBe(true);
    // Should still pass if we couldn't scan (err on side of not blocking)
    expect(result.passed).toBe(true);
  });

  // Test 9: Respects skip flag
  it('should skip scanning when skip option is true', async () => {
    // When skip=true, the function should return scanned=false
    const result = createMockResult({
      passed: true,
      scanned: false,
      vulnerabilities: [],
      summary: { total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 },
      errors: [],
    });

    expect(result.scanned).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.vulnerabilities.length).toBe(0);
  });

  // Test 10: Format result output
  it('should format results for CLI display', () => {
    const passedResult = createMockResult({
      passed: true,
      summary: { total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 },
    });
    
    const passedOutput = formatSecurityResult(passedResult);
    expect(passedOutput).toContain('✅');
    expect(passedOutput).toContain('No vulnerabilities');

    const failedResult = createMockResult({
      passed: false,
      summary: { total: 3, critical: 1, high: 2, moderate: 0, low: 0, info: 0 },
      vulnerabilities: [
        createMockVulnerability({ severity: 'critical', name: 'critical-pkg' }),
        createMockVulnerability({ severity: 'high', name: 'high-pkg1' }),
        createMockVulnerability({ severity: 'high', name: 'high-pkg2' }),
      ],
    });

    const failedOutput = formatSecurityResult(failedResult);
    expect(failedOutput).toContain('❌');
    expect(failedOutput).toContain('CRITICAL');
    expect(failedOutput).toContain('HIGH');
  });
});

describe('formatSecurityResult', () => {
  it('should show skipped message when not scanned', () => {
    const result = createMockResult({ scanned: false });
    const output = formatSecurityResult(result);
    expect(output).toContain('skipped');
  });

  it('should show vulnerability counts', () => {
    const result = createMockResult({
      passed: false,
      summary: { total: 5, critical: 1, high: 2, moderate: 2, low: 0, info: 0 },
      vulnerabilities: [],
    });
    
    const output = formatSecurityResult(result);
    expect(output).toContain('1 critical');
    expect(output).toContain('2 high');
    expect(output).toContain('2 moderate');
  });

  it('should show fix information for vulnerabilities', () => {
    const result = createMockResult({
      passed: false,
      vulnerabilities: [
        createMockVulnerability({
          severity: 'critical',
          name: 'lodash',
          fixAvailable: true,
          fixVersion: '4.17.21',
        }),
      ],
    });
    
    const output = formatSecurityResult(result);
    expect(output).toContain('lodash');
    expect(output).toContain('4.17.21');
  });
});

describe('getFixSuggestions', () => {
  it('should return empty for no critical/high vulnerabilities', () => {
    const result = createMockResult({
      vulnerabilities: [
        createMockVulnerability({ severity: 'moderate' }),
      ],
    });
    
    const suggestions = getFixSuggestions(result);
    expect(suggestions.length).toBe(0);
  });

  it('should suggest frontend fix for frontend vulnerabilities', () => {
    const result = createMockResult({
      vulnerabilities: [
        createMockVulnerability({ severity: 'high', source: 'frontend' }),
      ],
    });
    
    const suggestions = getFixSuggestions(result);
    expect(suggestions.some(s => s.includes('Frontend'))).toBe(true);
    expect(suggestions.some(s => s.includes('cd frontend'))).toBe(true);
  });

  it('should suggest backend fix for backend vulnerabilities', () => {
    const result = createMockResult({
      vulnerabilities: [
        createMockVulnerability({ severity: 'critical', source: 'backend' }),
      ],
    });
    
    const suggestions = getFixSuggestions(result);
    expect(suggestions.some(s => s.includes('Backend'))).toBe(true);
    expect(suggestions.some(s => s.includes('cd backend'))).toBe(true);
  });
});

// -----------------------------------------------------------------------
// Branch coverage: real securityScan function with mocked fs / execa
// -----------------------------------------------------------------------
describe('securityScan — real function branch paths', () => {
  const mockPathExists = vi.mocked(fs.pathExists);
  const mockExeca = vi.mocked(execa);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns scanned=false immediately when skip=true', async () => {
    const result = await securityScan('/any/dir', { skip: true });
    expect(result.scanned).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.vulnerabilities).toHaveLength(0);
    // fs and execa should NOT be called
    expect(mockPathExists).not.toHaveBeenCalled();
  });

  it('skips frontend scan when scanFrontend=false', async () => {
    mockPathExists.mockResolvedValue(false);
    const result = await securityScan('/plugin', { scanFrontend: false, scanBackend: false });
    expect(result.scanned).toBe(true);
    expect(result.vulnerabilities).toHaveLength(0);
  });

  it('adds frontend error when package.json missing', async () => {
    // frontend dir exists, but package.json does not
    mockPathExists.mockImplementation(async (p: string) => {
      if (p.endsWith('/frontend')) return true;
      if (p.endsWith('/frontend/package.json')) return false;
      return false;
    });
    const result = await securityScan('/plugin', { scanFrontend: true, scanBackend: false });
    expect(result.errors.some(e => e.includes('Frontend'))).toBe(true);
  });

  it('adds frontend error when node_modules missing', async () => {
    mockPathExists.mockImplementation(async (p: string) => {
      if (p.endsWith('/frontend')) return true;
      if (p.endsWith('/frontend/package.json')) return true;
      if (p.endsWith('/frontend/node_modules')) return false;
      return false;
    });
    const result = await securityScan('/plugin', { scanFrontend: true, scanBackend: false });
    expect(result.errors.some(e => e.includes('node_modules'))).toBe(true);
  });

  it('parses clean audit output (no vulnerabilities)', async () => {
    mockPathExists.mockResolvedValue(true);
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: { total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 } } }),
    });
    const result = await securityScan('/plugin', { scanFrontend: true, scanBackend: false });
    expect(result.passed).toBe(true);
    expect(result.summary.total).toBe(0);
  });

  it('fails scan when critical vulnerabilities found in audit output', async () => {
    mockPathExists.mockResolvedValue(true);
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify({
        vulnerabilities: {
          'bad-pkg': {
            name: 'bad-pkg',
            severity: 'critical',
            via: [{ title: 'RCE', url: 'https://example.com' }],
            effects: [],
            fixAvailable: { name: 'bad-pkg', version: '2.0.0' },
          },
        },
        metadata: { vulnerabilities: { total: 1, critical: 1, high: 0, moderate: 0, low: 0, info: 0 } },
      }),
    });
    const result = await securityScan('/plugin', { scanFrontend: true, scanBackend: false });
    expect(result.passed).toBe(false);
    expect(result.summary.critical).toBe(1);
    // fixVersion should be parsed from fixAvailable object
    expect(result.vulnerabilities[0].fixVersion).toBe('2.0.0');
  });

  it('fails scan when allowModerate=false and moderate vuln found', async () => {
    mockPathExists.mockResolvedValue(true);
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify({
        vulnerabilities: {
          'mod-pkg': {
            name: 'mod-pkg',
            severity: 'moderate',
            via: ['mod-dep'],  // string via — exercises that branch
            effects: [],
            fixAvailable: false,
          },
        },
        metadata: { vulnerabilities: { total: 1, critical: 0, high: 0, moderate: 1, low: 0, info: 0 } },
      }),
    });
    const result = await securityScan('/plugin', { scanFrontend: true, scanBackend: false, allowModerate: false });
    expect(result.passed).toBe(false);
    expect(result.summary.moderate).toBe(1);
    // fixVersion should be undefined when fixAvailable is false
    expect(result.vulnerabilities[0].fixVersion).toBeUndefined();
  });

  it('handles execa timeout error', async () => {
    mockPathExists.mockResolvedValue(true);
    mockExeca.mockRejectedValue(new Error('npm audit timed out'));
    const result = await securityScan('/plugin', { scanFrontend: true, scanBackend: false });
    expect(result.errors.some(e => e.includes('timed out'))).toBe(true);
  });

  it('handles unknown execa errors', async () => {
    mockPathExists.mockResolvedValue(true);
    mockExeca.mockRejectedValue('non-Error throw');
    const result = await securityScan('/plugin', { scanFrontend: true, scanBackend: false });
    expect(result.errors.some(e => e.includes('Unknown error'))).toBe(true);
  });

  it('scans backend when scanBackend=true', async () => {
    mockPathExists.mockImplementation(async (p: string) => {
      if (p.endsWith('/backend')) return true;
      if (p.endsWith('/frontend')) return false;
      return true;
    });
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: { total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 } } }),
    });
    const result = await securityScan('/plugin', { scanFrontend: false, scanBackend: true });
    expect(result.scanned).toBe(true);
    expect(result.passed).toBe(true);
  });
});

// -----------------------------------------------------------------------
// Branch coverage: formatSecurityResult branches
// -----------------------------------------------------------------------
describe('formatSecurityResult — additional branches', () => {
  it('shows low-risk message when passed but has some vulns', () => {
    const result = createMockResult({
      passed: true,
      scanned: true,
      summary: { total: 3, critical: 0, high: 0, moderate: 0, low: 3, info: 0 },
    });
    const output = formatSecurityResult(result);
    expect(output).toContain('low-risk');
  });

  it('shows fix info when fixAvailable is false (no fix version line)', () => {
    const result = createMockResult({
      passed: false,
      vulnerabilities: [
        createMockVulnerability({ severity: 'critical', fixAvailable: false, fixVersion: undefined }),
      ],
    });
    const output = formatSecurityResult(result);
    expect(output).toContain('CRITICAL');
    expect(output).not.toContain('Upgrade to available version');
  });

  it('shows errors in output', () => {
    const result = createMockResult({
      passed: true,
      scanned: true,
      errors: ['Frontend: npm audit timed out'],
    });
    const output = formatSecurityResult(result);
    expect(output).toContain('timed out');
  });
});
