/**
 * Security Scanning
 * 
 * Integrates npm audit to detect vulnerabilities in plugin dependencies.
 * Blocks plugins with critical/high vulnerabilities from being published.
 */

import { execa } from 'execa';
import path from 'path';
import fs from 'fs-extra';

export interface SecurityScanResult {
  passed: boolean;
  scanned: boolean;
  vulnerabilities: Vulnerability[];
  summary: {
    total: number;
    critical: number;
    high: number;
    moderate: number;
    low: number;
    info: number;
  };
  errors: string[];
}

export interface Vulnerability {
  name: string;
  severity: 'critical' | 'high' | 'moderate' | 'low' | 'info';
  title: string;
  url?: string;
  fixAvailable: boolean;
  fixVersion?: string;
  path: string[];
  source: 'frontend' | 'backend';
}

export interface SecurityScanOptions {
  /**
   * Skip security scanning (e.g., for development)
   */
  skip?: boolean;
  
  /**
   * Allow moderate and low vulnerabilities
   * Default: true (only block critical and high)
   */
  allowModerate?: boolean;
  
  /**
   * Timeout for npm audit command in milliseconds
   * Default: 30000 (30 seconds)
   */
  timeout?: number;
  
  /**
   * Scan frontend dependencies
   * Default: true
   */
  scanFrontend?: boolean;
  
  /**
   * Scan backend dependencies
   * Default: true
   */
  scanBackend?: boolean;
}

interface NpmAuditOutput {
  vulnerabilities?: Record<string, NpmVulnerability>;
  metadata?: {
    vulnerabilities: {
      total: number;
      critical: number;
      high: number;
      moderate: number;
      low: number;
      info: number;
    };
  };
}

interface NpmVulnerability {
  name: string;
  severity: string;
  via: Array<string | { title?: string; url?: string }>;
  effects: string[];
  fixAvailable: boolean | { name: string; version: string };
}

/**
 * Run npm audit on a directory and parse results
 */
async function runNpmAudit(
  dir: string,
  timeout: number
): Promise<{ output: NpmAuditOutput; error?: string }> {
  // Check if package.json exists
  if (!await fs.pathExists(path.join(dir, 'package.json'))) {
    return { output: {}, error: 'No package.json found' };
  }

  // Check if node_modules exists (required for audit)
  if (!await fs.pathExists(path.join(dir, 'node_modules'))) {
    return { output: {}, error: 'No node_modules found. Run npm install first.' };
  }

  try {
    const result = await execa('npm', ['audit', '--json'], {
      cwd: dir,
      timeout,
      reject: false, // Don't throw on non-zero exit (audit returns 1 if vulnerabilities found)
    });

    // npm audit returns JSON even with vulnerabilities
    const output = JSON.parse(result.stdout || '{}') as NpmAuditOutput;
    return { output };
  } catch (error) {
    if (error instanceof Error) {
      // Handle timeout
      if (error.message.includes('timeout')) {
        return { output: {}, error: 'npm audit timed out' };
      }
      // Handle other errors
      return { output: {}, error: error.message };
    }
    return { output: {}, error: 'Unknown error running npm audit' };
  }
}

/**
 * Parse npm audit output into vulnerability list
 */
function parseAuditOutput(
  output: NpmAuditOutput,
  source: 'frontend' | 'backend'
): Vulnerability[] {
  const vulnerabilities: Vulnerability[] = [];

  if (!output.vulnerabilities) {
    return vulnerabilities;
  }

  for (const [name, vuln] of Object.entries(output.vulnerabilities)) {
    // Extract title from via array
    let title = name;
    let url: string | undefined;
    
    for (const via of vuln.via) {
      if (typeof via === 'object' && via.title) {
        title = via.title;
        url = via.url;
        break;
      }
    }

    // Determine fix version if available
    let fixVersion: string | undefined;
    if (typeof vuln.fixAvailable === 'object') {
      fixVersion = vuln.fixAvailable.version;
    }

    vulnerabilities.push({
      name,
      severity: vuln.severity as Vulnerability['severity'],
      title,
      url,
      fixAvailable: !!vuln.fixAvailable,
      fixVersion,
      path: [name, ...vuln.effects],
      source,
    });
  }

  return vulnerabilities;
}

/**
 * Scan plugin for security vulnerabilities
 */
export async function securityScan(
  pluginDir: string,
  options: SecurityScanOptions = {}
): Promise<SecurityScanResult> {
  const {
    skip = false,
    allowModerate = true,
    timeout = 30000,
    scanFrontend = true,
    scanBackend = true,
  } = options;

  // Return early if skipped
  if (skip) {
    return {
      passed: true,
      scanned: false,
      vulnerabilities: [],
      summary: { total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 },
      errors: [],
    };
  }

  const allVulnerabilities: Vulnerability[] = [];
  const errors: string[] = [];
  let totalSummary = { total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 };

  // Scan frontend
  if (scanFrontend) {
    const frontendDir = path.join(pluginDir, 'frontend');
    if (await fs.pathExists(frontendDir)) {
      const { output, error } = await runNpmAudit(frontendDir, timeout);
      
      if (error) {
        errors.push(`Frontend: ${error}`);
      } else {
        const vulns = parseAuditOutput(output, 'frontend');
        allVulnerabilities.push(...vulns);
        
        if (output.metadata?.vulnerabilities) {
          const meta = output.metadata.vulnerabilities;
          totalSummary.total += meta.total;
          totalSummary.critical += meta.critical;
          totalSummary.high += meta.high;
          totalSummary.moderate += meta.moderate;
          totalSummary.low += meta.low;
          totalSummary.info += meta.info;
        }
      }
    }
  }

  // Scan backend
  if (scanBackend) {
    const backendDir = path.join(pluginDir, 'backend');
    if (await fs.pathExists(backendDir)) {
      const { output, error } = await runNpmAudit(backendDir, timeout);
      
      if (error) {
        errors.push(`Backend: ${error}`);
      } else {
        const vulns = parseAuditOutput(output, 'backend');
        allVulnerabilities.push(...vulns);
        
        if (output.metadata?.vulnerabilities) {
          const meta = output.metadata.vulnerabilities;
          totalSummary.total += meta.total;
          totalSummary.critical += meta.critical;
          totalSummary.high += meta.high;
          totalSummary.moderate += meta.moderate;
          totalSummary.low += meta.low;
          totalSummary.info += meta.info;
        }
      }
    }
  }

  // Determine if scan passed
  // Block on critical and high vulnerabilities
  // Optionally allow moderate and below
  let passed = true;
  if (totalSummary.critical > 0 || totalSummary.high > 0) {
    passed = false;
  }
  if (!allowModerate && totalSummary.moderate > 0) {
    passed = false;
  }

  return {
    passed,
    scanned: true,
    vulnerabilities: allVulnerabilities,
    summary: totalSummary,
    errors,
  };
}

/**
 * Format security scan result for CLI output
 */
export function formatSecurityResult(result: SecurityScanResult): string {
  const lines: string[] = [];

  if (!result.scanned) {
    lines.push('⏭️  Security scanning skipped');
    return lines.join('\n');
  }

  if (result.passed) {
    if (result.summary.total === 0) {
      lines.push('✅ No vulnerabilities found');
    } else {
      lines.push(`✅ Security scan passed (${result.summary.total} low-risk vulnerabilities)`);
    }
  } else {
    lines.push('❌ Security scan failed');
    lines.push(`   ${result.summary.critical} critical, ${result.summary.high} high, ${result.summary.moderate} moderate`);
  }

  // Show critical and high vulnerabilities
  const critical = result.vulnerabilities.filter(v => v.severity === 'critical');
  const high = result.vulnerabilities.filter(v => v.severity === 'high');

  for (const vuln of critical) {
    lines.push(`   🔴 CRITICAL: ${vuln.name} - ${vuln.title}`);
    if (vuln.fixAvailable) {
      lines.push(`      Fix: Upgrade to ${vuln.fixVersion || 'available version'}`);
    }
  }

  for (const vuln of high) {
    lines.push(`   🟠 HIGH: ${vuln.name} - ${vuln.title}`);
    if (vuln.fixAvailable) {
      lines.push(`      Fix: Upgrade to ${vuln.fixVersion || 'available version'}`);
    }
  }

  // Show errors
  for (const error of result.errors) {
    lines.push(`   ⚠️  ${error}`);
  }

  return lines.join('\n');
}

/**
 * Get fix suggestions for vulnerabilities
 */
export function getFixSuggestions(result: SecurityScanResult): string[] {
  const suggestions: string[] = [];
  
  const criticalOrHigh = result.vulnerabilities.filter(
    v => v.severity === 'critical' || v.severity === 'high'
  );

  if (criticalOrHigh.length === 0) {
    return suggestions;
  }

  suggestions.push('To fix vulnerabilities:');

  // Group by source
  const frontendVulns = criticalOrHigh.filter(v => v.source === 'frontend');
  const backendVulns = criticalOrHigh.filter(v => v.source === 'backend');

  if (frontendVulns.length > 0) {
    suggestions.push('  Frontend:');
    suggestions.push('    cd frontend && npm audit fix');
    suggestions.push('    # Or manually update specific packages');
  }

  if (backendVulns.length > 0) {
    suggestions.push('  Backend:');
    suggestions.push('    cd backend && npm audit fix');
    suggestions.push('    # Or manually update specific packages');
  }

  return suggestions;
}
