/**
 * Port Allocator Service
 * 
 * Manages dynamic allocation and release of ports for plugin backends.
 * Prevents port conflicts and enables scalable deployment.
 */

import { db } from '../db/client';

export interface PortAllocation {
  port: number;
  pluginName: string;
  allocatedAt: Date;
}

export interface PortAllocatorOptions {
  minPort?: number;
  maxPort?: number;
  reservedPorts?: number[];
}

const DEFAULT_MIN_PORT = 4100;
const DEFAULT_MAX_PORT = 4999;

// Well-known ports that should not be allocated
const RESERVED_PORTS = [
  4000, // base-svc
  4001, // gateway-manager
  4002, // marketplace
  4003, // orchestrator-manager
  4004, // network-analytics
  4005, // capacity-planner
  4006, // developer-api
  4007, // community
  4008, // my-wallet
  4009, // my-dashboard
  4010, // plugin-publisher
];

// In-memory tracking of allocated ports
const allocatedPorts = new Map<string, number>();
const portToPlugin = new Map<number, string>();

/**
 * Check if a port is available
 */
async function isPortAvailable(port: number): Promise<boolean> {
  // Check in-memory allocation
  if (portToPlugin.has(port)) {
    return false;
  }

  // Check database for existing installations using this port
  try {
    const installation = await db.pluginInstallation.findFirst({
      where: {
        status: 'installed',
        // containerPort is stored in metadata - this is a simplified check
      },
    });
    
    // For now, rely on in-memory + reserved ports
    return true;
  } catch {
    // DB query failed, rely on in-memory
    return true;
  }
}

/**
 * Allocate a port for a plugin
 */
export async function allocatePort(
  pluginName: string,
  options: PortAllocatorOptions = {}
): Promise<number> {
  const {
    minPort = DEFAULT_MIN_PORT,
    maxPort = DEFAULT_MAX_PORT,
    reservedPorts = RESERVED_PORTS,
  } = options;

  // Check if plugin already has a port allocated
  const existing = allocatedPorts.get(pluginName);
  if (existing) {
    console.log(`[portAllocator] Port ${existing} already allocated to ${pluginName}`);
    return existing;
  }

  // Find an available port
  for (let port = minPort; port <= maxPort; port++) {
    if (reservedPorts.includes(port)) {
      continue;
    }

    if (await isPortAvailable(port)) {
      // Allocate this port
      allocatedPorts.set(pluginName, port);
      portToPlugin.set(port, pluginName);
      
      console.log(`[portAllocator] Allocated port ${port} to ${pluginName}`);
      return port;
    }
  }

  throw new Error(`No available ports in range ${minPort}-${maxPort}`);
}

/**
 * Release a port allocation
 */
export function releasePort(pluginName: string): void {
  const port = allocatedPorts.get(pluginName);
  if (port) {
    allocatedPorts.delete(pluginName);
    portToPlugin.delete(port);
    console.log(`[portAllocator] Released port ${port} from ${pluginName}`);
  }
}

/**
 * Get port allocation for a plugin
 */
export function getPortAllocation(pluginName: string): number | undefined {
  return allocatedPorts.get(pluginName);
}

/**
 * Get all port allocations
 */
export function getAllAllocations(): PortAllocation[] {
  const allocations: PortAllocation[] = [];
  for (const [pluginName, port] of allocatedPorts.entries()) {
    allocations.push({
      port,
      pluginName,
      allocatedAt: new Date(), // Would track actual allocation time in production
    });
  }
  return allocations;
}

/**
 * Check if a specific port is allocated
 */
export function isPortAllocated(port: number): boolean {
  return portToPlugin.has(port) || RESERVED_PORTS.includes(port);
}

/**
 * Reserve a specific port for a plugin (if available)
 */
export async function reservePort(
  pluginName: string,
  port: number
): Promise<boolean> {
  if (RESERVED_PORTS.includes(port)) {
    return false;
  }

  if (portToPlugin.has(port)) {
    return false;
  }

  allocatedPorts.set(pluginName, port);
  portToPlugin.set(port, pluginName);
  console.log(`[portAllocator] Reserved port ${port} for ${pluginName}`);
  return true;
}

/**
 * Initialize port allocations from database
 */
export async function initializeFromDatabase(): Promise<void> {
  try {
    // Load existing installations and their ports
    const installations = await db.pluginInstallation.findMany({
      where: { status: 'installed' },
      include: { package: true },
    });

    for (const install of installations) {
      // In production, we'd have a containerPort field
      // For now, we'll use the manifest backend port if available
      const manifest = install.version?.manifest as { backend?: { port?: number } } | undefined;
      if (manifest?.backend?.port) {
        const port = manifest.backend.port;
        allocatedPorts.set(install.package.name, port);
        portToPlugin.set(port, install.package.name);
      }
    }

    console.log(`[portAllocator] Initialized ${allocatedPorts.size} port allocations from database`);
  } catch (error) {
    console.warn('[portAllocator] Failed to initialize from database:', error);
  }
}
