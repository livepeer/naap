/** @vitest-environment node */

import { describe, it, expect } from 'vitest';

import {
  CAPABILITY_GATE_FLAG,
  enforceCapabilityGate,
  filterGrantedCapabilities,
  isCapabilityGranted,
} from './enforcement';

describe('NAAP-E enforcement — isCapabilityGranted', () => {
  it('allows an exact granted capability', () => {
    expect(isCapabilityGranted(['text-to-image:sdxl'], 'text-to-image:sdxl')).toBe(true);
  });
  it('denies a capability not in the grant set', () => {
    expect(isCapabilityGranted(['text-to-image:sdxl'], 'tool:ffmpeg-concat')).toBe(false);
  });
  it('a wildcard grant allows anything', () => {
    expect(isCapabilityGranted(['*'], 'tool:anything')).toBe(true);
  });
  it('an empty grant set denies everything (fail closed)', () => {
    expect(isCapabilityGranted([], 'tool:x')).toBe(false);
    expect(isCapabilityGranted(null, 'tool:x')).toBe(false);
    expect(isCapabilityGranted(undefined, 'tool:x')).toBe(false);
  });
  it('a malformed request is denied', () => {
    expect(isCapabilityGranted(['*'], 'not a cap!')).toBe(false);
  });
  it('requesting `*` is only satisfied by a `*` grant', () => {
    expect(isCapabilityGranted(['tool:a'], '*')).toBe(false);
    expect(isCapabilityGranted(['*'], '*')).toBe(true);
  });
});

describe('NAAP-E enforcement — enforceCapabilityGate', () => {
  it('exposes the flag name', () => {
    expect(CAPABILITY_GATE_FLAG).toBe('capability_gate');
  });

  it('flag OFF → pass-through regardless of grants', () => {
    expect(enforceCapabilityGate({ enabled: false, granted: [], requested: 'tool:x' })).toEqual({
      allowed: true,
      reason: 'flag_off',
    });
  });

  it('flag ON + no request → pass-through', () => {
    expect(enforceCapabilityGate({ enabled: true, granted: ['*'], requested: null })).toEqual({
      allowed: true,
      reason: 'no_request',
    });
    expect(enforceCapabilityGate({ enabled: true, granted: [], requested: '   ' }).reason).toBe(
      'no_request',
    );
  });

  it('flag ON + granted → allow', () => {
    expect(
      enforceCapabilityGate({ enabled: true, granted: ['tool:x'], requested: 'tool:x' }),
    ).toEqual({ allowed: true, reason: 'granted' });
  });

  it('flag ON + empty grants + request → deny (fail closed)', () => {
    expect(
      enforceCapabilityGate({ enabled: true, granted: [], requested: 'tool:x' }),
    ).toEqual({ allowed: false, reason: 'denied_empty' });
  });

  it('flag ON + ungranted request → deny', () => {
    expect(
      enforceCapabilityGate({ enabled: true, granted: ['tool:a'], requested: 'tool:b' }),
    ).toEqual({ allowed: false, reason: 'denied_not_granted' });
  });

  it('flag ON + malformed request → deny', () => {
    expect(
      enforceCapabilityGate({ enabled: true, granted: ['*'], requested: 'bad id!' }),
    ).toEqual({ allowed: false, reason: 'denied_malformed' });
  });
});

describe('NAAP-E enforcement — filterGrantedCapabilities', () => {
  it('flag OFF → returns requested unchanged (pass-through)', () => {
    expect(
      filterGrantedCapabilities({ enabled: false, granted: ['tool:a'], requested: ['tool:a', 'tool:b'] }),
    ).toEqual(['tool:a', 'tool:b']);
  });
  it('flag ON → keeps only granted', () => {
    expect(
      filterGrantedCapabilities({ enabled: true, granted: ['tool:a'], requested: ['tool:a', 'tool:b'] }),
    ).toEqual(['tool:a']);
  });
  it('flag ON + empty grants → empty result (fail closed)', () => {
    expect(
      filterGrantedCapabilities({ enabled: true, granted: [], requested: ['tool:a'] }),
    ).toEqual([]);
  });
});
