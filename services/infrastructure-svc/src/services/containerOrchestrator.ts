/**
 * Container Orchestrator
 * Manages Docker containers for plugin backends
 */

import Docker from 'dockerode';

export interface ContainerConfig {
  name: string;
  image: string;
  port: number;
  env?: Record<string, string>;
  volumes?: Record<string, string>;
  labels?: Record<string, string>;
  resources?: {
    memory?: string;
    cpu?: string;
  };
}

export interface ContainerStatus {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'starting' | 'error';
  port?: number;
  health?: 'healthy' | 'unhealthy' | 'unknown';
  startedAt?: string;
  error?: string;
}

export class ContainerOrchestrator {
  private docker: Docker;
  private connected = false;

  constructor() {
    this.docker = new Docker();
  }

  async connect(): Promise<void> {
    try {
      await this.docker.ping();
      this.connected = true;
    } catch (error) {
      this.connected = false;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async isConnected(): Promise<boolean> {
    if (!this.connected) return false;
    try {
      await this.docker.ping();
      return true;
    } catch {
      this.connected = false;
      return false;
    }
  }

  /**
   * Pull a Docker image
   */
  async pullImage(image: string, onProgress?: (progress: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) {
          reject(err);
          return;
        }

        this.docker.modem.followProgress(
          stream,
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          },
          (event: { status?: string; progress?: string }) => {
            if (onProgress && event.status) {
              onProgress(`${event.status}${event.progress ? `: ${event.progress}` : ''}`);
            }
          }
        );
      });
    });
  }

  /**
   * Create and start a container
   */
  async createContainer(config: ContainerConfig): Promise<string> {
    const containerName = `naap-plugin-${config.name}`;
    
    // Check if container already exists
    const existing = await this.getContainer(config.name);
    if (existing) {
      // Remove existing container
      await this.removeContainer(config.name);
    }

    // Build environment variables
    const Env = Object.entries(config.env || {}).map(([k, v]) => `${k}=${v}`);

    // Build volume bindings
    const Binds = Object.entries(config.volumes || {}).map(([host, container]) => `${host}:${container}`);

    // Build labels
    const Labels: Record<string, string> = {
      'naap.plugin': config.name,
      'naap.managed': 'true',
      ...config.labels,
    };

    // Create container
    const container = await this.docker.createContainer({
      name: containerName,
      Image: config.image,
      Env,
      Labels,
      ExposedPorts: {
        [`${config.port}/tcp`]: {},
      },
      HostConfig: {
        PortBindings: {
          [`${config.port}/tcp`]: [{ HostPort: String(config.port) }],
        },
        Binds: Binds.length > 0 ? Binds : undefined,
        RestartPolicy: { Name: 'unless-stopped' },
        Memory: config.resources?.memory ? this.parseMemory(config.resources.memory) : undefined,
        NanoCpus: config.resources?.cpu ? this.parseCpu(config.resources.cpu) : undefined,
        NetworkMode: 'naap-network',
      },
    });

    // Start container
    await container.start();

    return container.id;
  }

  /**
   * Get container status
   */
  async getContainerStatus(name: string): Promise<ContainerStatus | null> {
    const container = await this.getContainer(name);
    if (!container) return null;

    try {
      const info = await container.inspect();
      
      return {
        id: info.Id,
        name: name,
        status: info.State.Running ? 'running' : 'stopped',
        port: info.NetworkSettings.Ports?.[Object.keys(info.NetworkSettings.Ports)[0]]?.[0]?.HostPort 
          ? parseInt(info.NetworkSettings.Ports[Object.keys(info.NetworkSettings.Ports)[0]][0].HostPort)
          : undefined,
        health: info.State.Health?.Status as 'healthy' | 'unhealthy' | undefined || 'unknown',
        startedAt: info.State.StartedAt,
      };
    } catch (error) {
      return {
        id: '',
        name,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Stop a container
   */
  async stopContainer(name: string): Promise<void> {
    const container = await this.getContainer(name);
    if (container) {
      await container.stop().catch(() => {}); // Ignore if already stopped
    }
  }

  /**
   * Remove a container
   */
  async removeContainer(name: string): Promise<void> {
    const container = await this.getContainer(name);
    if (container) {
      await container.stop().catch(() => {});
      await container.remove({ force: true });
    }
  }

  /**
   * Get container logs
   */
  async getContainerLogs(name: string, tail = 100): Promise<string> {
    const container = await this.getContainer(name);
    if (!container) return '';

    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
    });

    return logs.toString();
  }

  /**
   * Restart a container
   */
  async restartContainer(name: string): Promise<void> {
    const container = await this.getContainer(name);
    if (container) {
      await container.restart();
    }
  }

  /**
   * List all plugin containers
   */
  async listPluginContainers(): Promise<ContainerStatus[]> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: {
        label: ['naap.managed=true'],
      },
    });

    return containers.map(c => ({
      id: c.Id,
      name: c.Labels['naap.plugin'] || c.Names[0]?.replace('/', '') || 'unknown',
      status: c.State === 'running' ? 'running' : 'stopped',
      port: c.Ports[0]?.PublicPort,
    }));
  }

  /**
   * Create the NAAP network if it doesn't exist
   */
  async ensureNetwork(): Promise<void> {
    const networks = await this.docker.listNetworks({
      filters: { name: ['naap-network'] },
    });

    if (networks.length === 0) {
      await this.docker.createNetwork({
        Name: 'naap-network',
        Driver: 'bridge',
      });
    }
  }

  private async getContainer(name: string): Promise<Docker.Container | null> {
    const containerName = name.startsWith('naap-plugin-') ? name : `naap-plugin-${name}`;
    
    try {
      const container = this.docker.getContainer(containerName);
      await container.inspect();
      return container;
    } catch {
      return null;
    }
  }

  private parseMemory(memory: string): number {
    const match = memory.match(/^(\d+)(Mi|Gi|M|G)$/i);
    if (!match) return 256 * 1024 * 1024; // Default 256Mi
    
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    
    if (unit === 'gi' || unit === 'g') {
      return value * 1024 * 1024 * 1024;
    }
    return value * 1024 * 1024; // Mi or M
  }

  private parseCpu(cpu: string): number {
    const value = parseFloat(cpu);
    return Math.floor(value * 1e9); // Convert to nanoseconds
  }
}
