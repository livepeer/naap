/**
 * Deployment Types Tests
 * Tests for shared validation helpers and error classes
 */

import { describe, it, expect } from 'vitest';
import {
  isValidDeploymentId,
  isValidVersion,
  isValidSlotName,
  isValidTrafficPercent,
  createBufferKey,
  parseBufferKey,
  DeploymentNotFoundError,
  InvalidDeploymentIdError,
  SlotNotFoundError,
  NoActiveSlotError,
  ConcurrentDeploymentError,
  InvalidTrafficPercentError,
} from '../deploymentTypes.js';

describe('isValidDeploymentId', () => {
  it('should accept valid UUID', () => {
    expect(isValidDeploymentId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isValidDeploymentId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
  });

  it('should reject invalid UUIDs', () => {
    expect(isValidDeploymentId('not-a-uuid')).toBe(false);
    expect(isValidDeploymentId('550e8400-e29b-41d4-a716')).toBe(false);
    expect(isValidDeploymentId('')).toBe(false);
    expect(isValidDeploymentId('550e8400-e29b-41d4-a716-44665544000g')).toBe(false);
  });

  it('should reject null and undefined', () => {
    expect(isValidDeploymentId(null as unknown as string)).toBe(false);
    expect(isValidDeploymentId(undefined as unknown as string)).toBe(false);
  });
});

describe('isValidVersion', () => {
  it('should accept valid semver versions', () => {
    expect(isValidVersion('1.0.0')).toBe(true);
    expect(isValidVersion('0.0.1')).toBe(true);
    expect(isValidVersion('10.20.30')).toBe(true);
    expect(isValidVersion('1.2.3-alpha')).toBe(true);
    expect(isValidVersion('1.2.3-beta.1')).toBe(true);
    expect(isValidVersion('1.2.3+build')).toBe(true);
  });

  it('should reject invalid versions', () => {
    expect(isValidVersion('1.0')).toBe(false);
    expect(isValidVersion('v1.0.0')).toBe(false);
    expect(isValidVersion('1.0.0.0')).toBe(false);
    expect(isValidVersion('latest')).toBe(false);
    expect(isValidVersion('')).toBe(false);
  });
});

describe('isValidSlotName', () => {
  it('should accept blue and green', () => {
    expect(isValidSlotName('blue')).toBe(true);
    expect(isValidSlotName('green')).toBe(true);
  });

  it('should reject other values', () => {
    expect(isValidSlotName('red')).toBe(false);
    expect(isValidSlotName('BLUE')).toBe(false);
    expect(isValidSlotName('')).toBe(false);
  });
});

describe('isValidTrafficPercent', () => {
  it('should accept valid percentages', () => {
    expect(isValidTrafficPercent(0)).toBe(true);
    expect(isValidTrafficPercent(50)).toBe(true);
    expect(isValidTrafficPercent(100)).toBe(true);
  });

  it('should reject invalid percentages', () => {
    expect(isValidTrafficPercent(-1)).toBe(false);
    expect(isValidTrafficPercent(101)).toBe(false);
    expect(isValidTrafficPercent(50.5)).toBe(false);
    expect(isValidTrafficPercent(NaN)).toBe(false);
  });
});

describe('createBufferKey and parseBufferKey', () => {
  it('should handle simple deploymentId', () => {
    const key = createBufferKey('abc123');
    const parsed = parseBufferKey(key);
    expect(parsed.deploymentId).toBe('abc123');
    expect(parsed.slot).toBeUndefined();
  });

  it('should handle deploymentId with slot', () => {
    const key = createBufferKey('abc123', 'blue');
    const parsed = parseBufferKey(key);
    expect(parsed.deploymentId).toBe('abc123');
    expect(parsed.slot).toBe('blue');
  });

  it('should handle deploymentId with special characters', () => {
    const specialId = 'deploy:with:colons';
    const key = createBufferKey(specialId, 'green');
    const parsed = parseBufferKey(key);
    expect(parsed.deploymentId).toBe(specialId);
    expect(parsed.slot).toBe('green');
  });

  it('should handle UUID deploymentId', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const key = createBufferKey(uuid, 'blue');
    const parsed = parseBufferKey(key);
    expect(parsed.deploymentId).toBe(uuid);
    expect(parsed.slot).toBe('blue');
  });
});

describe('Error Classes', () => {
  it('DeploymentNotFoundError should have correct message', () => {
    const error = new DeploymentNotFoundError('deploy-123');
    expect(error.message).toBe('Deployment not found: deploy-123');
    expect(error.name).toBe('DeploymentNotFoundError');
  });

  it('InvalidDeploymentIdError should have correct message', () => {
    const error = new InvalidDeploymentIdError('bad-id');
    expect(error.message).toBe('Invalid deployment ID format: bad-id');
    expect(error.name).toBe('InvalidDeploymentIdError');
  });

  it('SlotNotFoundError should have correct message', () => {
    const error = new SlotNotFoundError('deploy-123', 'blue');
    expect(error.message).toBe("Slot 'blue' not found for deployment: deploy-123");
    expect(error.name).toBe('SlotNotFoundError');
  });

  it('NoActiveSlotError should have correct message', () => {
    const error = new NoActiveSlotError('deploy-123');
    expect(error.message).toBe('No active slots available for deployment: deploy-123');
    expect(error.name).toBe('NoActiveSlotError');
  });

  it('ConcurrentDeploymentError should have correct message', () => {
    const error = new ConcurrentDeploymentError('deploy-123');
    expect(error.message).toBe('Deployment already in progress for: deploy-123');
    expect(error.name).toBe('ConcurrentDeploymentError');
  });

  it('InvalidTrafficPercentError should have correct message', () => {
    const error = new InvalidTrafficPercentError('Invalid percentage');
    expect(error.message).toBe('Invalid percentage');
    expect(error.name).toBe('InvalidTrafficPercentError');
  });
});
