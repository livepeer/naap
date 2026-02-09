/**
 * Port Allocator Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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

  it('should skip reserved ports', async () => {
    const { allocatePort, releasePort } = await getPortAllocator();

    // Allocate many ports to ensure we don't get reserved ones
    const ports: number[] = [];
    for (let i = 0; i < 5; i++) {
      ports.push(await allocatePort(`plugin-${i}`));
    }

    const reservedPorts = [4000, 4001, 4002, 4003, 4004, 4005, 4006, 4007, 4008, 4009, 4010];
    
    for (const port of ports) {
      expect(reservedPorts).not.toContain(port);
    }

    // Cleanup
    for (let i = 0; i < 5; i++) {
      releasePort(`plugin-${i}`);
    }
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
