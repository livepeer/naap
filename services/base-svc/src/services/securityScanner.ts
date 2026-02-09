/**
 * Security Scanner Service
 * Scans packages and Docker images for vulnerabilities
 */

import { dockerHubClient, ghcrClient } from './dockerRegistry';

export interface VulnerabilitySummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

export interface SecurityScanResult {
  passed: boolean;
  vulnerabilities: VulnerabilitySummary;
  details: Array<{
    id: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    package: string;
    version: string;
    fixedIn?: string;
    description: string;
  }>;
  scannedAt: Date;
  scanDuration: number; // ms
}

export interface PackageLockVulnerability {
  name: string;
  severity: 'critical' | 'high' | 'moderate' | 'low' | 'info';
  via: string[];
  effects: string[];
  range: string;
  fixAvailable: boolean | { name: string; version: string };
}

/**
 * Create security scanner service
 */
export function createSecurityScanner(config?: {
  blockCritical?: boolean;
  blockHigh?: boolean;
  allowedPackages?: string[];
}) {
  const { 
    blockCritical = true, 
    blockHigh = false,
    allowedPackages = [],
  } = config || {};

  // Known malicious packages
  const MALICIOUS_PACKAGES = [
    'event-stream', // Known supply chain attack
    'flatmap-stream',
    'crossenv', // Typosquatting
    'cross-env.js',
    'lodash-es.js',
    'react-dom.js',
    // Add more as discovered
  ];

  return {
    /**
     * Analyze npm audit JSON output
     */
    analyzeNpmAudit(auditJson: unknown): SecurityScanResult {
      const startTime = Date.now();
      const result: SecurityScanResult = {
        passed: true,
        vulnerabilities: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
        details: [],
        scannedAt: new Date(),
        scanDuration: 0,
      };

      if (!auditJson || typeof auditJson !== 'object') {
        result.scanDuration = Date.now() - startTime;
        return result;
      }

      const audit = auditJson as {
        vulnerabilities?: Record<string, PackageLockVulnerability>;
        metadata?: { vulnerabilities?: Record<string, number> };
      };

      // Extract vulnerability counts from metadata
      if (audit.metadata?.vulnerabilities) {
        const v = audit.metadata.vulnerabilities;
        result.vulnerabilities.critical = v.critical || 0;
        result.vulnerabilities.high = v.high || 0;
        result.vulnerabilities.medium = v.moderate || 0;
        result.vulnerabilities.low = (v.low || 0) + (v.info || 0);
        result.vulnerabilities.total = 
          result.vulnerabilities.critical + 
          result.vulnerabilities.high + 
          result.vulnerabilities.medium + 
          result.vulnerabilities.low;
      }

      // Extract individual vulnerabilities
      if (audit.vulnerabilities) {
        for (const [pkgName, vuln] of Object.entries(audit.vulnerabilities)) {
          // Skip if package is in allowlist
          if (allowedPackages.includes(pkgName)) {
            continue;
          }

          const severity = mapSeverity(vuln.severity);
          
          result.details.push({
            id: `npm:${pkgName}`,
            severity,
            package: pkgName,
            version: vuln.range,
            fixedIn: vuln.fixAvailable && typeof vuln.fixAvailable === 'object' 
              ? vuln.fixAvailable.version 
              : undefined,
            description: `Vulnerable via: ${vuln.via.join(', ')}`,
          });
        }
      }

      // Check blocking conditions
      if (blockCritical && result.vulnerabilities.critical > 0) {
        result.passed = false;
      }
      if (blockHigh && result.vulnerabilities.high > 0) {
        result.passed = false;
      }

      result.scanDuration = Date.now() - startTime;
      return result;
    },

    /**
     * Check for known malicious packages
     */
    checkMaliciousPackages(dependencies: Record<string, string>): {
      found: string[];
      safe: boolean;
    } {
      const found: string[] = [];
      
      for (const pkg of Object.keys(dependencies)) {
        if (MALICIOUS_PACKAGES.includes(pkg.toLowerCase())) {
          found.push(pkg);
        }
      }

      return {
        found,
        safe: found.length === 0,
      };
    },

    /**
     * Scan a package.json for issues
     */
    analyzePackageJson(packageJson: {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }): {
      issues: Array<{ type: string; package: string; message: string }>;
      warnings: Array<{ type: string; package: string; message: string }>;
    } {
      const issues: Array<{ type: string; package: string; message: string }> = [];
      const warnings: Array<{ type: string; package: string; message: string }> = [];

      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      for (const [pkg, version] of Object.entries(allDeps)) {
        // Check for malicious packages
        if (MALICIOUS_PACKAGES.includes(pkg.toLowerCase())) {
          issues.push({
            type: 'malicious',
            package: pkg,
            message: 'Known malicious package',
          });
        }

        // Check for * or latest versions
        if (version === '*' || version === 'latest') {
          warnings.push({
            type: 'unpinned',
            package: pkg,
            message: 'Version is not pinned',
          });
        }

        // Check for git dependencies
        if (version.includes('git') || version.includes('github')) {
          warnings.push({
            type: 'git-dependency',
            package: pkg,
            message: 'Git dependency may not be reproducible',
          });
        }

        // Check for http dependencies
        if (version.startsWith('http://')) {
          issues.push({
            type: 'insecure',
            package: pkg,
            message: 'HTTP dependency is insecure',
          });
        }
      }

      return { issues, warnings };
    },

    /**
     * Verify Docker image security (basic checks)
     */
    async verifyDockerImage(
      imageName: string,
      tag: string = 'latest',
      registry: 'dockerhub' | 'ghcr' = 'ghcr'
    ): Promise<{
      accessible: boolean;
      verified: boolean;
      issues: string[];
      labels?: Record<string, string>;
    }> {
      const client = registry === 'ghcr' ? ghcrClient : dockerHubClient;
      const issues: string[] = [];

      try {
        const info = await client.getImageInfo(imageName, tag);
        
        if (!info) {
          return {
            accessible: false,
            verified: false,
            issues: ['Image not found or inaccessible'],
          };
        }

        // Check for security-related labels
        const labels = info.labels || {};
        
        if (!labels['org.opencontainers.image.source']) {
          issues.push('Missing source label (org.opencontainers.image.source)');
        }

        if (!labels['org.opencontainers.image.version']) {
          issues.push('Missing version label');
        }

        // Size check (warn if >1GB)
        if (info.size > 1024 * 1024 * 1024) {
          issues.push(`Image is large (${formatBytes(info.size)})`);
        }

        return {
          accessible: true,
          verified: issues.length === 0,
          issues,
          labels,
        };
      } catch (error) {
        return {
          accessible: false,
          verified: false,
          issues: [error instanceof Error ? error.message : 'Unknown error'],
        };
      }
    },

    /**
     * Run full security scan for publishing
     */
    async runPrePublishScan(options: {
      packageJson?: object;
      npmAuditJson?: object;
      dockerImage?: { name: string; tag: string; registry?: 'dockerhub' | 'ghcr' };
    }): Promise<{
      passed: boolean;
      results: {
        packageJson?: { issues: Array<{ type: string; package: string; message: string }>; warnings: Array<{ type: string; package: string; message: string }> };
        npmAudit?: SecurityScanResult;
        docker?: { accessible: boolean; verified: boolean; issues: string[]; labels?: Record<string, string> };
      };
      summary: string;
    }> {
      const results: {
        packageJson?: { issues: Array<{ type: string; package: string; message: string }>; warnings: Array<{ type: string; package: string; message: string }> };
        npmAudit?: SecurityScanResult;
        docker?: { accessible: boolean; verified: boolean; issues: string[]; labels?: Record<string, string> };
      } = {};

      let passed = true;

      // Package.json analysis
      if (options.packageJson) {
        results.packageJson = this.analyzePackageJson(
          options.packageJson as { dependencies?: Record<string, string> }
        );
        if (results.packageJson.issues.length > 0) {
          passed = false;
        }
      }

      // npm audit analysis
      if (options.npmAuditJson) {
        results.npmAudit = this.analyzeNpmAudit(options.npmAuditJson);
        if (!results.npmAudit.passed) {
          passed = false;
        }
      }

      // Docker image verification
      if (options.dockerImage) {
        results.docker = await this.verifyDockerImage(
          options.dockerImage.name,
          options.dockerImage.tag,
          options.dockerImage.registry
        );
        if (!results.docker.verified) {
          // Docker issues are warnings, not blocking
        }
      }

      // Generate summary
      const summaryParts: string[] = [];
      
      if (results.npmAudit) {
        const v = results.npmAudit.vulnerabilities;
        if (v.total > 0) {
          summaryParts.push(
            `${v.total} vulnerabilities (${v.critical} critical, ${v.high} high)`
          );
        } else {
          summaryParts.push('No npm vulnerabilities');
        }
      }

      if (results.packageJson?.issues.length) {
        summaryParts.push(`${results.packageJson.issues.length} package issues`);
      }

      if (results.docker && !results.docker.verified) {
        summaryParts.push(`Docker: ${results.docker.issues.length} issues`);
      }

      return {
        passed,
        results,
        summary: summaryParts.join(', ') || 'No issues found',
      };
    },
  };
}

/**
 * Map npm severity to our severity levels
 */
function mapSeverity(severity: string): 'critical' | 'high' | 'medium' | 'low' {
  switch (severity) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'moderate':
      return 'medium';
    default:
      return 'low';
  }
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Export singleton
export const securityScanner = createSecurityScanner();
