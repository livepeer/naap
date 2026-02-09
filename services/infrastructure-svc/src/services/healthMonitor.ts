/**
 * Health Monitor
 * Monitors the health of plugin containers and services
 */

import { ContainerOrchestrator, ContainerStatus } from './containerOrchestrator.js';

export interface HealthCheck {
  pluginName: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  lastCheck: Date;
  responseTime?: number;
  error?: string;
  consecutiveFailures: number;
}

export interface HealthMonitorConfig {
  checkInterval: number; // ms
  timeout: number; // ms
  unhealthyThreshold: number;
}

export class HealthMonitor {
  private checks = new Map<string, HealthCheck>();
  private intervalId: NodeJS.Timeout | null = null;
  private containerOrchestrator: ContainerOrchestrator | null = null;
  
  private config: HealthMonitorConfig = {
    checkInterval: 30000, // 30 seconds
    timeout: 5000, // 5 seconds
    unhealthyThreshold: 3,
  };

  private listeners: ((checks: HealthCheck[]) => void)[] = [];

  constructor(config?: Partial<HealthMonitorConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  setContainerOrchestrator(orchestrator: ContainerOrchestrator): void {
    this.containerOrchestrator = orchestrator;
  }

  /**
   * Start health monitoring
   */
  start(): void {
    if (this.intervalId) {
      return;
    }

    // Run immediately
    this.runChecks();

    // Schedule periodic checks
    this.intervalId = setInterval(() => {
      this.runChecks();
    }, this.config.checkInterval);
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Add a plugin to monitor
   */
  addPlugin(pluginName: string, healthEndpoint: string): void {
    this.checks.set(pluginName, {
      pluginName,
      status: 'unknown',
      lastCheck: new Date(),
      consecutiveFailures: 0,
    });

    // Store endpoint for checking
    (this.checks.get(pluginName) as HealthCheck & { endpoint?: string }).endpoint = healthEndpoint;
  }

  /**
   * Remove a plugin from monitoring
   */
  removePlugin(pluginName: string): void {
    this.checks.delete(pluginName);
  }

  /**
   * Get health status for a plugin
   */
  getHealth(pluginName: string): HealthCheck | undefined {
    return this.checks.get(pluginName);
  }

  /**
   * Get all health checks
   */
  getAllHealth(): HealthCheck[] {
    return Array.from(this.checks.values());
  }

  /**
   * Subscribe to health updates
   */
  onUpdate(callback: (checks: HealthCheck[]) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  /**
   * Run health checks for all plugins
   */
  private async runChecks(): Promise<void> {
    const checkPromises = Array.from(this.checks.entries()).map(async ([name, check]) => {
      const checkWithEndpoint = check as HealthCheck & { endpoint?: string };
      if (!checkWithEndpoint.endpoint) return;

      try {
        const startTime = Date.now();
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
        
        const response = await fetch(checkWithEndpoint.endpoint, {
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        const responseTime = Date.now() - startTime;

        if (response.ok) {
          this.checks.set(name, {
            ...check,
            status: 'healthy',
            lastCheck: new Date(),
            responseTime,
            consecutiveFailures: 0,
            error: undefined,
          });
        } else {
          this.handleFailure(name, `HTTP ${response.status}`);
        }
      } catch (error) {
        this.handleFailure(name, error instanceof Error ? error.message : 'Unknown error');
      }
    });

    await Promise.all(checkPromises);

    // Also check container status if orchestrator is available
    if (this.containerOrchestrator) {
      try {
        const containers = await this.containerOrchestrator.listPluginContainers();
        this.updateFromContainerStatus(containers);
      } catch (error) {
        console.warn('Failed to get container status:', error);
      }
    }

    // Notify listeners
    this.notifyListeners();
  }

  private handleFailure(pluginName: string, error: string): void {
    const check = this.checks.get(pluginName);
    if (!check) return;

    const consecutiveFailures = check.consecutiveFailures + 1;
    const status = consecutiveFailures >= this.config.unhealthyThreshold 
      ? 'unhealthy' 
      : check.status;

    this.checks.set(pluginName, {
      ...check,
      status,
      lastCheck: new Date(),
      error,
      consecutiveFailures,
    });
  }

  private updateFromContainerStatus(containers: ContainerStatus[]): void {
    for (const container of containers) {
      const check = this.checks.get(container.name);
      if (check) {
        // Update container-level health
        if (container.status === 'stopped' || container.status === 'error') {
          this.checks.set(container.name, {
            ...check,
            status: 'unhealthy',
            error: container.error || 'Container not running',
            lastCheck: new Date(),
          });
        }
      }
    }
  }

  private notifyListeners(): void {
    const checks = this.getAllHealth();
    for (const listener of this.listeners) {
      try {
        listener(checks);
      } catch (error) {
        console.warn('Health monitor listener error:', error);
      }
    }
  }
}
