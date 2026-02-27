import { describe, it, expect, beforeAll } from 'vitest';
import { registry } from '../../transforms';

describe('TransformRegistry', () => {
  beforeAll(() => {
    // Bootstrap runs on import — strategies already registered
  });

  describe('body transforms', () => {
    it('lists all registered body transforms', () => {
      const names = registry.listBody();
      expect(names).toContain('passthrough');
      expect(names).toContain('static');
      expect(names).toContain('template');
      expect(names).toContain('extract');
      expect(names).toContain('binary');
      expect(names).toContain('form-encode');
    });

    it('returns passthrough by name', () => {
      const s = registry.getBody('passthrough');
      expect(s.name).toBe('passthrough');
    });

    it('resolves extract:* prefix to extract strategy', () => {
      const s = registry.getBody('extract:data.query');
      expect(s.name).toBe('extract');
    });

    it('falls back to passthrough for unknown body transform', () => {
      const s = registry.getBody('unknown-type');
      expect(s.name).toBe('passthrough');
    });
  });

  describe('auth strategies', () => {
    it('lists all registered auth strategies', () => {
      const names = registry.listAuth();
      expect(names).toContain('bearer');
      expect(names).toContain('header');
      expect(names).toContain('basic');
      expect(names).toContain('query');
      expect(names).toContain('aws-s3');
      expect(names).toContain('none');
    });

    it('returns bearer by name', () => {
      const s = registry.getAuth('bearer');
      expect(s.name).toBe('bearer');
    });

    it('falls back to none for unknown auth type', () => {
      const s = registry.getAuth('unknown-auth');
      expect(s.name).toBe('none');
    });
  });

  describe('response transforms', () => {
    it('lists all registered response transforms', () => {
      const names = registry.listResponse();
      expect(names).toContain('envelope');
      expect(names).toContain('raw');
      expect(names).toContain('streaming');
      expect(names).toContain('field-map');
    });

    it('returns envelope by name', () => {
      const s = registry.getResponse('envelope');
      expect(s.name).toBe('envelope');
    });

    it('throws for unknown response transform', () => {
      expect(() => registry.getResponse('unknown-response')).toThrow();
    });
  });
});
