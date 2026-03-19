/**
 * Plugin Ports Configuration Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  extractPortFromUrl,
  getPluginPortFromEnv,
  getPluginUrl,
  getReservedPortsFromEnv,
  CANONICAL_PORTS,
  PLUGIN_ENV_MAP,
} from '../pluginPorts';

describe('pluginPorts', () => {
  describe('extractPortFromUrl', () => {
    it('should extract port from localhost URL', () => {
      expect(extractPortFromUrl('http://localhost:4006')).toBe(4006);
    });

    it('should extract port from domain URL', () => {
      expect(extractPortFromUrl('https://api.example.com:4007')).toBe(4007);
    });

    it('should extract port from URL with path', () => {
      expect(extractPortFromUrl('http://localhost:4008/api/v1')).toBe(4008);
    });

    it('should return undefined for URL without explicit port', () => {
      expect(extractPortFromUrl('https://api.example.com')).toBeUndefined();
      expect(extractPortFromUrl('https://api.example.com/path')).toBeUndefined();
    });

    it('should return undefined for invalid URL', () => {
      expect(extractPortFromUrl('invalid')).toBeUndefined();
      expect(extractPortFromUrl('')).toBeUndefined();
    });

    it('should return undefined for null/undefined input', () => {
      expect(extractPortFromUrl(null as unknown as string)).toBeUndefined();
      expect(extractPortFromUrl(undefined as unknown as string)).toBeUndefined();
    });

    it('should handle edge case ports', () => {
      expect(extractPortFromUrl('http://localhost:1')).toBe(1);
      expect(extractPortFromUrl('http://localhost:65535')).toBe(65535);
    });
  });

  describe('getPluginPortFromEnv', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return canonical port when env not set', () => {
      delete process.env.COMMUNITY_URL;
      expect(getPluginPortFromEnv('community')).toBe(4006);
    });

    it('should return port from env URL when set', () => {
      process.env.COMMUNITY_URL = 'http://localhost:9999';
      expect(getPluginPortFromEnv('community')).toBe(9999);
    });

    it('should fallback to canonical port when env URL has no port', () => {
      process.env.COMMUNITY_URL = 'https://api.example.com';
      expect(getPluginPortFromEnv('community')).toBe(4006);
    });

    it('should return default port for unknown plugin', () => {
      expect(getPluginPortFromEnv('unknown-plugin')).toBe(4000);
    });

    it('should handle all canonical plugins', () => {
      for (const [name, port] of Object.entries(CANONICAL_PORTS)) {
        expect(getPluginPortFromEnv(name)).toBe(port);
      }
    });
  });

  describe('getPluginUrl', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return env URL when set', () => {
      process.env.COMMUNITY_URL = 'https://api.example.com:9999';
      expect(getPluginUrl('community')).toBe('https://api.example.com:9999');
    });

    it('should return localhost URL with canonical port when env not set', () => {
      delete process.env.COMMUNITY_URL;
      expect(getPluginUrl('community')).toBe('http://localhost:4006');
    });

    it('should return localhost with default port for unknown plugin', () => {
      expect(getPluginUrl('unknown-plugin')).toBe('http://localhost:4000');
    });
  });

  describe('getReservedPortsFromEnv', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return all canonical ports when no env overrides', () => {
      // Clear all plugin env vars
      for (const envKey of Object.values(PLUGIN_ENV_MAP)) {
        delete process.env[envKey];
      }

      const ports = getReservedPortsFromEnv();

      // Should include all canonical ports
      expect(ports).toContain(4000); // base
      expect(ports).toContain(3100); // plugin-server
      expect(ports).toContain(4003); // capacity-planner
      expect(ports).toContain(4005); // marketplace
      expect(ports).toContain(4006); // community
      expect(ports).toContain(4007); // developer-api
      expect(ports).toContain(4008); // my-wallet
      expect(ports).toContain(4009); // my-dashboard
      expect(ports).toContain(4010); // plugin-publisher
      expect(ports).toContain(4111); // daydream-video
    });

    it('should use env port when specified', () => {
      process.env.COMMUNITY_URL = 'http://localhost:9999';
      const ports = getReservedPortsFromEnv();

      expect(ports).toContain(9999);
      expect(ports).not.toContain(4006); // Original community port replaced
    });

    it('should return sorted unique ports', () => {
      const ports = getReservedPortsFromEnv();

      // Check sorted
      for (let i = 1; i < ports.length; i++) {
        expect(ports[i]).toBeGreaterThan(ports[i - 1]);
      }

      // Check unique
      const unique = [...new Set(ports)];
      expect(ports.length).toBe(unique.length);
    });

    it('should deduplicate when multiple plugins use same port via env', () => {
      process.env.COMMUNITY_URL = 'http://localhost:5000';
      process.env.WALLET_URL = 'http://localhost:5000';

      const ports = getReservedPortsFromEnv();
      const count5000 = ports.filter(p => p === 5000).length;

      expect(count5000).toBe(1);
    });
  });

  describe('CANONICAL_PORTS', () => {
    it('should have all expected plugins', () => {
      const expectedPlugins = [
        'base',
        'plugin-server',
        'capacity-planner',
        'marketplace',
        'community',
        'developer-api',
        'my-wallet',
        'my-dashboard',
        'plugin-publisher',
        'daydream-video',
      ];

      for (const plugin of expectedPlugins) {
        expect(CANONICAL_PORTS).toHaveProperty(plugin);
      }
    });

    it('should have correct port values', () => {
      expect(CANONICAL_PORTS['base']).toBe(4000);
      expect(CANONICAL_PORTS['plugin-server']).toBe(3100);
      expect(CANONICAL_PORTS['capacity-planner']).toBe(4003);
      expect(CANONICAL_PORTS['marketplace']).toBe(4005);
      expect(CANONICAL_PORTS['community']).toBe(4006);
      expect(CANONICAL_PORTS['developer-api']).toBe(4007);
      expect(CANONICAL_PORTS['my-wallet']).toBe(4008);
      expect(CANONICAL_PORTS['my-dashboard']).toBe(4009);
      expect(CANONICAL_PORTS['plugin-publisher']).toBe(4010);
      expect(CANONICAL_PORTS['daydream-video']).toBe(4111);
    });
  });

  describe('PLUGIN_ENV_MAP', () => {
    it('should map plugins to correct env var names', () => {
      expect(PLUGIN_ENV_MAP['base']).toBe('BASE_SVC_URL');
      expect(PLUGIN_ENV_MAP['plugin-server']).toBe('PLUGIN_SERVER_URL');
      expect(PLUGIN_ENV_MAP['capacity-planner']).toBe('CAPACITY_PLANNER_URL');
      expect(PLUGIN_ENV_MAP['marketplace']).toBe('MARKETPLACE_URL');
      expect(PLUGIN_ENV_MAP['community']).toBe('COMMUNITY_URL');
      expect(PLUGIN_ENV_MAP['developer-api']).toBe('DEVELOPER_API_URL');
      expect(PLUGIN_ENV_MAP['my-wallet']).toBe('WALLET_URL');
      expect(PLUGIN_ENV_MAP['my-dashboard']).toBe('DASHBOARD_URL');
      expect(PLUGIN_ENV_MAP['plugin-publisher']).toBe('PLUGIN_PUBLISHER_URL');
      expect(PLUGIN_ENV_MAP['daydream-video']).toBe('DAYDREAM_VIDEO_URL');
    });
  });
});
