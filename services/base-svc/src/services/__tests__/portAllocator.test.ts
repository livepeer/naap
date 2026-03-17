/**
 * Port Allocator Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Canonical ports from config - must match pluginPorts.ts
const CANONICAL_PORTS = {
  'base': 4000,
  'plugin-server': 3100,
  'capacity-planner': 4003,
  'marketplace': 4005,
  'community': 4006,
  'developer-api': 4007,
  'my-wallet': 4008,
  'my-dashboard': 4009,
  'plugin-publisher': 4010,
  'daydream-video': 4111,
};

// Create fresh module for each test to reset state
async function getPortAllocator() {
  vi.resetModules();

  // Mock the db module
  vi.doMock('../../db/client.js', () => ({
    db: {
      pluginInstallation: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
  }));

  // Mock the pluginPorts config (uses canonical defaults, no env override)
  vi.doMock('../../config/pluginPorts.js', () => ({
    getReservedPortsFromEnv: () => Object.values(CANONICAL_PORTS),
  }));

  const module = await import('../portAllocator.js');
  return module;
}

// Helper to create portAllocator with custom env-overridden reserved ports
async function getPortAllocatorWithEnvOverrides(envPorts: number[]) {
  vi.resetModules();

  vi.doMock('../../db/client.js', () => ({
    db: {
      pluginInstallation: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
  }));

  vi.doMock('../../config/pluginPorts.js', () => ({
    getReservedPortsFromEnv: () => envPorts,
  }));

  const module = await import('../portAllocator.js');
  return module;
}

describe('Port Allocator', () => {
  it('should allocate ports sequentially', async () => {
    const { allocatePort, releasePort, getAllAllocations } = await getPortAllocator();

    const port1 = await allocatePort('plugin-1');
    const port2 = await allocatePort('plugin-2');

    expect(port1).toBe(4100);
    expect(port2).toBe(4101);
    
    // Cleanup
    releasePort('plugin-1');
    releasePort('plugin-2');
  });

  it('should return same port for same plugin', async () => {
    const { allocatePort, releasePort } = await getPortAllocator();

    const port1 = await allocatePort('plugin-1');
    const port2 = await allocatePort('plugin-1');

    expect(port1).toBe(port2);
    
    releasePort('plugin-1');
  });

  it('should release ports correctly', async () => {
    const { allocatePort, releasePort, getPortAllocation } = await getPortAllocator();

    await allocatePort('plugin-1');
    expect(getPortAllocation('plugin-1')).toBe(4100);

    releasePort('plugin-1');
    expect(getPortAllocation('plugin-1')).toBeUndefined();
  });

  it('should skip reserved ports (canonical defaults)', async () => {
    const { allocatePort, releasePort, getReservedPorts } = await getPortAllocator();

    // Allocate many ports to ensure we don't get reserved ones
    const ports: number[] = [];
    for (let i = 0; i < 5; i++) {
      ports.push(await allocatePort(`plugin-${i}`));
    }

    const reservedPorts = getReservedPorts();

    for (const port of ports) {
      expect(reservedPorts).not.toContain(port);
    }

    // Cleanup
    for (let i = 0; i < 5; i++) {
      releasePort(`plugin-${i}`);
    }
  });

  it('should return canonical ports from getReservedPorts', async () => {
    const { getReservedPorts } = await getPortAllocator();

    const reserved = getReservedPorts();

    // Should include all canonical ports
    expect(reserved).toContain(4000); // base
    expect(reserved).toContain(3100); // plugin-server
    expect(reserved).toContain(4003); // capacity-planner
    expect(reserved).toContain(4005); // marketplace
    expect(reserved).toContain(4006); // community
    expect(reserved).toContain(4007); // developer-api
    expect(reserved).toContain(4008); // my-wallet
    expect(reserved).toContain(4009); // my-dashboard
    expect(reserved).toContain(4010); // plugin-publisher
    expect(reserved).toContain(4111); // daydream-video
  });

  it('should use env-overridden reserved ports when available', async () => {
    // Simulate env override changing some ports
    const customPorts = [4000, 9001, 9002, 9003];
    const { getReservedPorts, reservePort } = await getPortAllocatorWithEnvOverrides(customPorts);

    const reserved = getReservedPorts();
    expect(reserved).toEqual(customPorts);

    // Should not allow reserving env-specified ports
    const canReserve4000 = await reservePort('test', 4000);
    expect(canReserve4000).toBe(false);

    const canReserve9001 = await reservePort('test', 9001);
    expect(canReserve9001).toBe(false);

    // But should allow reserving non-reserved ports
    const canReserve5000 = await reservePort('test', 5000);
    expect(canReserve5000).toBe(true);
  });

  it('should reserve specific port', async () => {
    const { reservePort, getPortAllocation, releasePort } = await getPortAllocator();

    const reserved = await reservePort('my-plugin', 4500);

    expect(reserved).toBe(true);
    expect(getPortAllocation('my-plugin')).toBe(4500);
    
    releasePort('my-plugin');
  });

  it('should not reserve already allocated port', async () => {
    const { allocatePort, reservePort, releasePort } = await getPortAllocator();

    await allocatePort('plugin-1'); // Gets 4100

    const reserved = await reservePort('plugin-2', 4100);

    expect(reserved).toBe(false);
    
    releasePort('plugin-1');
  });

  it('should not reserve system reserved port', async () => {
    const { reservePort } = await getPortAllocator();

    const reserved = await reservePort('my-plugin', 4000); // base-svc port

    expect(reserved).toBe(false);
  });

  it('should check if port is allocated', async () => {
    const { allocatePort, isPortAllocated, releasePort } = await getPortAllocator();

    await allocatePort('plugin-1');

    expect(isPortAllocated(4100)).toBe(true);
    expect(isPortAllocated(4200)).toBe(false);
    expect(isPortAllocated(4000)).toBe(true); // Reserved
    
    releasePort('plugin-1');
  });
});
