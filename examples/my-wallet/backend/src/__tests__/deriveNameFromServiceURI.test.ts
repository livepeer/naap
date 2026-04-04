import { describe, it, expect } from 'vitest';
import { deriveNameFromServiceURI } from '../lib/livepeer.js';

describe('deriveNameFromServiceURI', () => {
  it('extracts name from simple domain', () => {
    expect(deriveNameFromServiceURI('https://vin-node.com:8935')).toBe('Vin Node');
  });

  it('strips livepeer prefix from subdomain', () => {
    expect(deriveNameFromServiceURI('https://livepeer.flagshipnodes.com:8935')).toBe('Flagshipnodes');
  });

  it('handles complex subdomain paths', () => {
    const result = deriveNameFromServiceURI('https://livepeer-orchestrator.prod.dcg-labs.co:8935');
    expect(result).toBeTruthy();
  });

  it('returns null for raw IP addresses', () => {
    expect(deriveNameFromServiceURI('https://194.58.47.220:8935')).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(deriveNameFromServiceURI(null)).toBeNull();
    expect(deriveNameFromServiceURI(undefined)).toBeNull();
    expect(deriveNameFromServiceURI('')).toBeNull();
  });

  it('handles hyphenated domains', () => {
    expect(deriveNameFromServiceURI('https://grant-node.xyz:18935')).toBe('Grant Node');
  });

  it('handles domains with livepeer in the name', () => {
    const result = deriveNameFromServiceURI('https://livepeerservice.world:8935');
    expect(result).not.toContain('livepeer');
  });

  it('handles node prefix stripping', () => {
    const result = deriveNameFromServiceURI('https://node.livepeer-utopia.xyz:8937');
    expect(result).toBeTruthy();
  });
});
