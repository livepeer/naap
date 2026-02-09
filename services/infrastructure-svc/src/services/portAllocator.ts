/**
 * Port Allocator
 * Dynamically allocates ports for plugin services
 */

import { createServer } from 'net';

export interface PortAllocation {
  pluginName: string;
  frontendPort: number;
  backendPort: number;
  allocatedAt: Date;
}

export class PortAllocator {
  private allocations = new Map<string, PortAllocation>();
  
  // Port ranges
  private readonly FRONTEND_PORT_START = 3100;
  private readonly FRONTEND_PORT_END = 3199;
  private readonly BACKEND_PORT_START = 4100;
  private readonly BACKEND_PORT_END = 4199;

  /**
   * Allocate ports for a plugin
   */
  async allocatePorts(pluginName: string): Promise<PortAllocation> {
    // Check if already allocated
    const existing = this.allocations.get(pluginName);
    if (existing) {
      return existing;
    }

    // Find available ports
    const frontendPort = await this.findAvailablePort(
      this.FRONTEND_PORT_START,
      this.FRONTEND_PORT_END
    );
    
    const backendPort = await this.findAvailablePort(
      this.BACKEND_PORT_START,
      this.BACKEND_PORT_END
    );

    const allocation: PortAllocation = {
      pluginName,
      frontendPort,
      backendPort,
      allocatedAt: new Date(),
    };

    this.allocations.set(pluginName, allocation);
    return allocation;
  }

  /**
   * Release ports for a plugin
   */
  releasePorts(pluginName: string): void {
    this.allocations.delete(pluginName);
  }

  /**
   * Get allocation for a plugin
   */
  getAllocation(pluginName: string): PortAllocation | undefined {
    return this.allocations.get(pluginName);
  }

  /**
   * Get all allocations
   */
  getAllAllocations(): PortAllocation[] {
    return Array.from(this.allocations.values());
  }

  /**
   * Check if a port is available
   */
  async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();
      
      server.once('error', () => {
        resolve(false);
      });
      
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      
      server.listen(port);
    });
  }

  /**
   * Find an available port in range
   */
  private async findAvailablePort(start: number, end: number): Promise<number> {
    // Get already allocated ports
    const allocatedPorts = new Set<number>();
    for (const allocation of this.allocations.values()) {
      allocatedPorts.add(allocation.frontendPort);
      allocatedPorts.add(allocation.backendPort);
    }

    for (let port = start; port <= end; port++) {
      if (allocatedPorts.has(port)) {
        continue;
      }
      
      const available = await this.isPortAvailable(port);
      if (available) {
        return port;
      }
    }

    throw new Error(`No available ports in range ${start}-${end}`);
  }
}
