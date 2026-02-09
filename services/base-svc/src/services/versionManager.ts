/**
 * Version Manager Service
 * Handles semver validation, version conflicts, and rollback
 */

import * as semver from 'semver';
import { db } from '../db/client';

export interface VersionInfo {
  version: string;
  prerelease: boolean;
  major: number;
  minor: number;
  patch: number;
  tag?: string; // alpha, beta, rc
}

export interface VersionConflict {
  existingVersion: string;
  requestedVersion: string;
  reason: string;
}

/**
 * Parse a version string into its components
 */
export function parseVersion(version: string): VersionInfo | null {
  const parsed = semver.parse(version);
  
  if (!parsed) {
    return null;
  }

  const prerelease = parsed.prerelease.length > 0;
  const tag = prerelease && typeof parsed.prerelease[0] === 'string' 
    ? parsed.prerelease[0] 
    : undefined;

  return {
    version: parsed.version,
    prerelease,
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch,
    tag,
  };
}

/**
 * Validate a version string
 */
export function validateVersion(version: string): { valid: boolean; error?: string } {
  // Check for valid semver
  if (!semver.valid(version)) {
    return { 
      valid: false, 
      error: `Invalid version format: ${version}. Use semver (e.g., 1.0.0, 1.0.0-beta.1)` 
    };
  }

  // Check for reasonable version range
  const parsed = semver.parse(version);
  if (parsed && parsed.major > 100) {
    return { 
      valid: false, 
      error: 'Major version cannot exceed 100' 
    };
  }

  return { valid: true };
}

/**
 * Compare two versions
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  return semver.compare(a, b);
}

/**
 * Check if version A is greater than version B
 */
export function isNewerVersion(a: string, b: string): boolean {
  return semver.gt(a, b);
}

/**
 * Get the next version based on release type
 */
export function getNextVersion(
  current: string,
  type: 'major' | 'minor' | 'patch' | 'prerelease',
  prereleaseTag?: string
): string | null {
  if (type === 'prerelease' && prereleaseTag) {
    return semver.inc(current, 'prerelease', prereleaseTag);
  }
  return semver.inc(current, type);
}

/**
 * Check for version conflicts before publishing
 */
export async function checkVersionConflict(
  packageId: string,
  newVersion: string
): Promise<VersionConflict | null> {
  // Get existing versions
  const existingVersions = await db.pluginVersion.findMany({
    where: { packageId },
    orderBy: { publishedAt: 'desc' },
    select: { version: true, deprecated: true },
  });

  // Check for exact match
  const exactMatch = existingVersions.find(v => v.version === newVersion);
  if (exactMatch) {
    if (exactMatch.deprecated) {
      return {
        existingVersion: newVersion,
        requestedVersion: newVersion,
        reason: 'Version exists but is deprecated. Consider using a new version number.',
      };
    }
    return {
      existingVersion: newVersion,
      requestedVersion: newVersion,
      reason: 'Version already exists. Increment the version number and try again.',
    };
  }

  // Check if new version is older than latest stable
  const latestStable = existingVersions.find(v => {
    const parsed = parseVersion(v.version);
    return parsed && !parsed.prerelease && !v.deprecated;
  });

  if (latestStable) {
    const newParsed = parseVersion(newVersion);
    
    // Allow prerelease versions to be "older" than stable
    if (newParsed && !newParsed.prerelease && !isNewerVersion(newVersion, latestStable.version)) {
      return {
        existingVersion: latestStable.version,
        requestedVersion: newVersion,
        reason: `New stable version must be greater than current stable (${latestStable.version})`,
      };
    }
  }

  return null; // No conflict
}

/**
 * Get version history for a package
 */
export async function getVersionHistory(packageId: string): Promise<Array<{
  version: string;
  publishedAt: Date;
  deprecated: boolean;
  deprecationMsg: string | null;
  downloads: number;
}>> {
  const versions = await db.pluginVersion.findMany({
    where: { packageId },
    orderBy: { publishedAt: 'desc' },
    select: {
      version: true,
      publishedAt: true,
      deprecated: true,
      deprecationMsg: true,
      downloads: true,
    },
  });

  return versions;
}

/**
 * Get latest version (optionally including prereleases)
 */
export async function getLatestVersion(
  packageId: string,
  includePrerelease = false
): Promise<string | null> {
  const versions = await db.pluginVersion.findMany({
    where: { 
      packageId, 
      deprecated: false,
    },
    select: { version: true },
  });

  if (versions.length === 0) {
    return null;
  }

  // Sort by semver
  const sorted = versions
    .filter(v => {
      if (includePrerelease) return true;
      const parsed = parseVersion(v.version);
      return parsed && !parsed.prerelease;
    })
    .sort((a, b) => -semver.compare(a.version, b.version));

  return sorted[0]?.version || null;
}

/**
 * Get version matching a semver range
 */
export function matchVersionRange(versions: string[], range: string): string | null {
  return semver.maxSatisfying(versions, range);
}

/**
 * Create version manager service instance
 */
export function createVersionManager() {
  return {
    parseVersion,
    validateVersion,
    compareVersions,
    isNewerVersion,
    getNextVersion,
    checkVersionConflict,
    getVersionHistory,
    getLatestVersion,
    matchVersionRange,

    /**
     * Deprecate a version with optional message
     */
    async deprecateVersion(
      packageId: string,
      version: string,
      message?: string
    ): Promise<boolean> {
      const result = await db.pluginVersion.updateMany({
        where: { packageId, version },
        data: { 
          deprecated: true, 
          deprecationMsg: message 
        },
      });
      return result.count > 0;
    },

    /**
     * Un-deprecate a version
     */
    async undeprecateVersion(packageId: string, version: string): Promise<boolean> {
      const result = await db.pluginVersion.updateMany({
        where: { packageId, version },
        data: { 
          deprecated: false, 
          deprecationMsg: null 
        },
      });
      return result.count > 0;
    },

    /**
     * Delete a version (unpublish)
     */
    async deleteVersion(packageId: string, version: string): Promise<boolean> {
      const result = await db.pluginVersion.deleteMany({
        where: { packageId, version },
      });
      return result.count > 0;
    },

    /**
     * Get rollback target (previous stable version)
     */
    async getRollbackTarget(
      packageId: string,
      currentVersion: string
    ): Promise<string | null> {
      const versions = await db.pluginVersion.findMany({
        where: { 
          packageId, 
          deprecated: false,
          version: { not: currentVersion },
        },
        select: { version: true },
      });

      // Find the latest version that's older than current
      const older = versions
        .filter(v => semver.lt(v.version, currentVersion))
        .sort((a, b) => -semver.compare(a.version, b.version));

      return older[0]?.version || null;
    },

    /**
     * Check if upgrade is available
     */
    async checkForUpgrade(
      packageId: string,
      currentVersion: string,
      includePrerelease = false
    ): Promise<{ available: boolean; latestVersion?: string }> {
      const latest = await getLatestVersion(packageId, includePrerelease);
      
      if (!latest) {
        return { available: false };
      }

      if (semver.gt(latest, currentVersion)) {
        return { available: true, latestVersion: latest };
      }

      return { available: false };
    },
  };
}

// Export singleton instance
export const versionManager = createVersionManager();
