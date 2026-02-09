/**
 * Service registry for managing extensible backend services
 */

import type { Service, ServiceHealth } from './types';

export class ServiceRegistry {
  private services: Map<string, Service> = new Map();
  private healthChecks: Map<string, ServiceHealth> = new Map();

  /**
   * Register a service
   */
  register(service: Service): void {
    if (this.services.has(service.name)) {
      throw new Error(`Service ${service.name} is already registered`);
    }

    this.services.set(service.name, service);
    this.healthChecks.set(service.name, {
      name: service.name,
      type: service.type,
      status: 'starting',
    });

    console.log(`📦 Registered service: ${service.name} (${service.type})`);
  }

  /**
   * Unregister a service
   */
  unregister(name: string): void {
    const service = this.services.get(name);
    if (service) {
      this.services.delete(name);
      this.healthChecks.delete(name);
      console.log(`🗑️  Unregistered service: ${name}`);
    }
  }

  /**
   * Get a service by name
   */
  get(name: string): Service | undefined {
    return this.services.get(name);
  }

  /**
   * Get all registered services
   */
  getAll(): Service[] {
    return Array.from(this.services.values());
  }

  /**
   * Start a specific service
   */
  async start(name: string): Promise<void> {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service ${name} not found`);
    }

    const health = this.healthChecks.get(name);
    if (health) {
      health.status = 'starting';
    }

    try {
      await service.start();
      if (health) {
        health.status = 'healthy';
        health.lastCheck = new Date();
      }
      console.log(`✅ Started service: ${name}`);
    } catch (error) {
      if (health) {
        health.status = 'unhealthy';
        health.error = error instanceof Error ? error.message : 'Unknown error';
      }
      console.error(`❌ Failed to start service ${name}:`, error);
      throw error;
    }
  }

  /**
   * Stop a specific service
   */
  async stop(name: string): Promise<void> {
    const service = this.services.get(name);
    if (!service) {
      return;
    }

    const health = this.healthChecks.get(name);
    if (health) {
      health.status = 'stopping';
    }

    try {
      await service.stop();
      if (health) {
        health.status = 'unhealthy';
      }
      console.log(`🛑 Stopped service: ${name}`);
    } catch (error) {
      console.error(`❌ Failed to stop service ${name}:`, error);
      throw error;
    }
  }

  /**
   * Start all registered services
   */
  async startAll(): Promise<void> {
    const services = Array.from(this.services.values());
    const startPromises = services.map((service) =>
      this.start(service.name).catch((error) => {
        console.error(`Failed to start ${service.name}:`, error);
        return null;
      })
    );

    await Promise.all(startPromises);
    console.log(`✅ Started ${services.length} services`);
  }

  /**
   * Stop all registered services
   */
  async stopAll(): Promise<void> {
    const services = Array.from(this.services.values());
    const stopPromises = services.map((service) =>
      this.stop(service.name).catch((error) => {
        console.error(`Failed to stop ${service.name}:`, error);
        return null;
      })
    );

    await Promise.all(stopPromises);
    console.log(`🛑 Stopped ${services.length} services`);
  }

  /**
   * Check health of a service
   */
  async checkHealth(name: string): Promise<ServiceHealth> {
    const service = this.services.get(name);
    if (!service) {
      return {
        name,
        type: 'custom',
        status: 'unhealthy',
        error: 'Service not found',
      };
    }

    const health = this.healthChecks.get(name) || {
      name,
      type: service.type,
      status: 'unhealthy' as const,
    };

    try {
      const isHealthy = await service.health();
      health.status = isHealthy ? 'healthy' : 'unhealthy';
      health.lastCheck = new Date();
      health.error = undefined;
    } catch (error) {
      health.status = 'unhealthy';
      health.error = error instanceof Error ? error.message : 'Unknown error';
    }

    this.healthChecks.set(name, health);
    return health;
  }

  /**
   * Check health of all services
   */
  async checkAllHealth(): Promise<Record<string, ServiceHealth>> {
    const services = Array.from(this.services.keys());
    const healthChecks = await Promise.all(
      services.map(async (name) => [name, await this.checkHealth(name)])
    );

    return Object.fromEntries(healthChecks);
  }

  /**
   * Get health status of all services
   */
  getHealthStatus(): Record<string, ServiceHealth> {
    return Object.fromEntries(this.healthChecks.entries());
  }
}

// Singleton instance
let registryInstance: ServiceRegistry | null = null;

export function getServiceRegistry(): ServiceRegistry {
  if (!registryInstance) {
    registryInstance = new ServiceRegistry();
  }
  return registryInstance;
}
