/**
 * Log Aggregator Service
 *
 * Collects and buffers logs from all plugins for the debug console.
 * Supports real-time streaming via WebSocket.
 */

import type { LogEntry, PluginHealthUpdate } from '@naap/types';

export interface LogBuffer {
  plugin: string;
  logs: LogEntry[];
  maxSize: number;
}

export interface PluginHealth {
  plugin: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  lastUpdate: Date;
  uptime: number;
  lastError?: string;
  lastErrorTime?: Date;
  metrics: {
    requestsPerMinute: number;
    errorRate: number;
    avgResponseTime: number;
  };
}

type LogListener = (plugin: string, log: LogEntry) => void;
type HealthListener = (plugin: string, health: PluginHealthUpdate) => void;

export function createLogAggregator(maxLogsPerPlugin = 1000) {
  const buffers = new Map<string, LogBuffer>();
  const health = new Map<string, PluginHealth>();
  const logListeners = new Set<LogListener>();
  const healthListeners = new Set<HealthListener>();

  // Track plugin start times for uptime calculation
  const startTimes = new Map<string, Date>();

  /**
   * Create or get a buffer for a plugin
   */
  function getBuffer(plugin: string): LogBuffer {
    let buffer = buffers.get(plugin);
    if (!buffer) {
      buffer = {
        plugin,
        logs: [],
        maxSize: maxLogsPerPlugin,
      };
      buffers.set(plugin, buffer);
    }
    return buffer;
  }

  /**
   * Add a log entry for a plugin
   */
  function addLog(plugin: string, log: LogEntry): void {
    const buffer = getBuffer(plugin);

    // Add log
    buffer.logs.push(log);

    // Trim if over limit
    if (buffer.logs.length > buffer.maxSize) {
      buffer.logs.splice(0, buffer.logs.length - buffer.maxSize);
    }

    // Notify listeners
    logListeners.forEach(listener => {
      try {
        listener(plugin, log);
      } catch (e) {
        console.error('Log listener error:', e);
      }
    });

    // Update health on errors
    if (log.level === 'error') {
      updateHealthFromError(plugin, log);
    }
  }

  /**
   * Create a log entry from plugin stdout/stderr
   */
  function logFromOutput(
    plugin: string,
    message: string,
    level: 'debug' | 'info' | 'warn' | 'error' = 'info',
    source: 'backend' | 'frontend' | 'console' | 'system' = 'backend'
  ): void {
    const log: LogEntry = {
      id: `${plugin}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      level,
      plugin,
      message,
      source,
    };

    addLog(plugin, log);
  }

  /**
   * Parse log level from message
   */
  function parseLogLevel(message: string): 'debug' | 'info' | 'warn' | 'error' {
    const lower = message.toLowerCase();
    if (lower.includes('error') || lower.includes('exception') || lower.includes('failed')) {
      return 'error';
    }
    if (lower.includes('warn')) {
      return 'warn';
    }
    if (lower.includes('debug')) {
      return 'debug';
    }
    return 'info';
  }

  /**
   * Log from plugin process output (auto-detect level)
   */
  function logFromProcess(plugin: string, message: string, isStderr = false): void {
    const level = isStderr ? 'error' : parseLogLevel(message);
    logFromOutput(plugin, message.trim(), level, 'backend');
  }

  /**
   * Update health status from an error
   */
  function updateHealthFromError(plugin: string, log: LogEntry): void {
    let h = health.get(plugin);
    if (!h) {
      h = createDefaultHealth(plugin);
      health.set(plugin, h);
    }

    h.lastError = log.message;
    h.lastErrorTime = new Date(log.timestamp);
    h.metrics.errorRate = calculateErrorRate(plugin);
    h.status = h.metrics.errorRate > 10 ? 'unhealthy' : h.metrics.errorRate > 5 ? 'degraded' : 'healthy';
    h.lastUpdate = new Date();

    notifyHealthListeners(plugin);
  }

  /**
   * Calculate error rate for a plugin (errors per 100 logs)
   */
  function calculateErrorRate(plugin: string): number {
    const buffer = buffers.get(plugin);
    if (!buffer || buffer.logs.length === 0) return 0;

    // Consider last 100 logs
    const recentLogs = buffer.logs.slice(-100);
    const errorCount = recentLogs.filter(l => l.level === 'error').length;
    return (errorCount / recentLogs.length) * 100;
  }

  /**
   * Create default health object
   */
  function createDefaultHealth(plugin: string): PluginHealth {
    return {
      plugin,
      status: 'unknown',
      lastUpdate: new Date(),
      uptime: 0,
      metrics: {
        requestsPerMinute: 0,
        errorRate: 0,
        avgResponseTime: 0,
      },
    };
  }

  /**
   * Register plugin start
   */
  function registerPluginStart(plugin: string): void {
    startTimes.set(plugin, new Date());

    let h = health.get(plugin);
    if (!h) {
      h = createDefaultHealth(plugin);
      health.set(plugin, h);
    }

    h.status = 'healthy';
    h.lastUpdate = new Date();

    logFromOutput(plugin, `Plugin ${plugin} started`, 'info', 'system');
    notifyHealthListeners(plugin);
  }

  /**
   * Register plugin stop
   */
  function registerPluginStop(plugin: string, error?: string): void {
    startTimes.delete(plugin);

    let h = health.get(plugin);
    if (!h) {
      h = createDefaultHealth(plugin);
      health.set(plugin, h);
    }

    h.status = 'unhealthy';
    h.uptime = 0;
    if (error) {
      h.lastError = error;
      h.lastErrorTime = new Date();
    }
    h.lastUpdate = new Date();

    logFromOutput(plugin, `Plugin ${plugin} stopped${error ? `: ${error}` : ''}`, error ? 'error' : 'info', 'system');
    notifyHealthListeners(plugin);
  }

  /**
   * Update health metrics for a plugin
   */
  function updateMetrics(
    plugin: string,
    metrics: Partial<PluginHealth['metrics']>
  ): void {
    let h = health.get(plugin);
    if (!h) {
      h = createDefaultHealth(plugin);
      health.set(plugin, h);
    }

    Object.assign(h.metrics, metrics);
    h.lastUpdate = new Date();

    // Calculate uptime
    const startTime = startTimes.get(plugin);
    if (startTime) {
      h.uptime = Math.floor((Date.now() - startTime.getTime()) / 1000);
    }

    notifyHealthListeners(plugin);
  }

  /**
   * Notify health listeners
   */
  function notifyHealthListeners(plugin: string): void {
    const h = health.get(plugin);
    if (!h) return;

    const update: PluginHealthUpdate = {
      plugin: h.plugin,
      status: h.status,
      uptime: h.uptime,
      lastError: h.lastError,
      lastErrorTime: h.lastErrorTime?.toISOString(),
      metrics: h.metrics,
    };

    healthListeners.forEach(listener => {
      try {
        listener(plugin, update);
      } catch (e) {
        console.error('Health listener error:', e);
      }
    });
  }

  /**
   * Get logs for a plugin
   */
  function getLogs(plugin: string, limit?: number): LogEntry[] {
    const buffer = buffers.get(plugin);
    if (!buffer) return [];

    if (limit && limit < buffer.logs.length) {
      return buffer.logs.slice(-limit);
    }
    return [...buffer.logs];
  }

  /**
   * Get health for a plugin
   */
  function getHealth(plugin: string): PluginHealth | undefined {
    return health.get(plugin);
  }

  /**
   * Get health for all plugins
   */
  function getAllHealth(): PluginHealth[] {
    return Array.from(health.values());
  }

  /**
   * Clear logs for a plugin
   */
  function clearLogs(plugin: string): void {
    const buffer = buffers.get(plugin);
    if (buffer) {
      buffer.logs = [];
    }
  }

  /**
   * Subscribe to log events
   */
  function onLog(listener: LogListener): () => void {
    logListeners.add(listener);
    return () => logListeners.delete(listener);
  }

  /**
   * Subscribe to health events
   */
  function onHealth(listener: HealthListener): () => void {
    healthListeners.add(listener);
    return () => healthListeners.delete(listener);
  }

  /**
   * Get all known plugins
   */
  function getPlugins(): string[] {
    return Array.from(buffers.keys());
  }

  return {
    addLog,
    logFromOutput,
    logFromProcess,
    registerPluginStart,
    registerPluginStop,
    updateMetrics,
    getLogs,
    getHealth,
    getAllHealth,
    clearLogs,
    onLog,
    onHealth,
    getPlugins,
  };
}

export type LogAggregator = ReturnType<typeof createLogAggregator>;

// Singleton instance for use across the service
let _instance: LogAggregator | null = null;

export function getLogAggregator(): LogAggregator {
  if (!_instance) {
    _instance = createLogAggregator(1000);
  }
  return _instance;
}
