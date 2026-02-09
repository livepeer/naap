/**
 * Shared types for deployment-related services
 * Used by: deploymentManager, trafficRouter, healthMonitor, alertEngine
 */

// =============================================================================
// Common Types
// =============================================================================

export type SlotName = 'blue' | 'green';
export type SlotStatus = 'active' | 'inactive' | 'deploying' | 'failed' | 'draining';
export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown';

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate deployment ID format
 * Must be a valid UUID
 */
export function isValidDeploymentId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Validate version string format
 * Supports semver and semver with pre-release tags
 */
export function isValidVersion(version: string): boolean {
  if (!version || typeof version !== 'string') return false;
  const semverRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
  return semverRegex.test(version);
}

/**
 * Validate slot name
 */
export function isValidSlotName(slot: string): slot is SlotName {
  return slot === 'blue' || slot === 'green';
}

/**
 * Validate traffic percentage
 */
export function isValidTrafficPercent(percent: number): boolean {
  return typeof percent === 'number' && percent >= 0 && percent <= 100 && Number.isInteger(percent);
}

/**
 * Create a safe buffer key that handles deploymentId containing special characters
 * Uses URL-safe base64 encoding for the deploymentId portion
 */
export function createBufferKey(deploymentId: string, slot?: string): string {
  // Use a delimiter that won't appear in base64: ||
  const safeId = Buffer.from(deploymentId).toString('base64url');
  return slot ? `${safeId}||${slot}` : safeId;
}

/**
 * Parse a buffer key back to deploymentId and slot
 */
export function parseBufferKey(key: string): { deploymentId: string; slot?: string } {
  const parts = key.split('||');
  const deploymentId = Buffer.from(parts[0], 'base64url').toString('utf-8');
  return {
    deploymentId,
    slot: parts[1],
  };
}

// =============================================================================
// Error Classes
// =============================================================================

export class DeploymentNotFoundError extends Error {
  constructor(deploymentId: string) {
    super(`Deployment not found: ${deploymentId}`);
    this.name = 'DeploymentNotFoundError';
  }
}

export class InvalidDeploymentIdError extends Error {
  constructor(deploymentId: string) {
    super(`Invalid deployment ID format: ${deploymentId}`);
    this.name = 'InvalidDeploymentIdError';
  }
}

export class SlotNotFoundError extends Error {
  constructor(deploymentId: string, slot: SlotName) {
    super(`Slot '${slot}' not found for deployment: ${deploymentId}`);
    this.name = 'SlotNotFoundError';
  }
}

export class NoActiveSlotError extends Error {
  constructor(deploymentId: string) {
    super(`No active slots available for deployment: ${deploymentId}`);
    this.name = 'NoActiveSlotError';
  }
}

export class ConcurrentDeploymentError extends Error {
  constructor(deploymentId: string) {
    super(`Deployment already in progress for: ${deploymentId}`);
    this.name = 'ConcurrentDeploymentError';
  }
}

export class InvalidTrafficPercentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTrafficPercentError';
  }
}
