/**
 * Prometheus Metrics Exporter
 * 
 * Phase 2: Provides Prometheus-compatible metrics export for monitoring.
 * 
 * Usage in Express:
 * ```typescript
 * import { createMetricsMiddleware, registerMetric, Counter, Gauge } from '@naap/utils';
 * 
 * // Create metrics endpoint
 * app.get('/metrics', createMetricsMiddleware());
 * 
 * // Register custom metrics
 * const requestCounter = registerMetric(new Counter({
 *   name: 'http_requests_total',
 *   help: 'Total HTTP requests',
 *   labels: ['method', 'path', 'status'],
 * }));
 * 
 * requestCounter.inc({ method: 'GET', path: '/api/users', status: '200' });
 * ```
 */

import type { Request, Response } from 'express';

// ============================================
// Types
// ============================================

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

export interface MetricLabels {
  [key: string]: string;
}

export interface MetricConfig {
  name: string;
  help: string;
  labels?: string[];
}

export interface HistogramConfig extends MetricConfig {
  buckets?: number[];
}

export interface SummaryConfig extends MetricConfig {
  quantiles?: number[];
  maxAgeSeconds?: number;
}

// ============================================
// Metric Classes
// ============================================

/**
 * Counter metric - only increases
 */
export class Counter {
  readonly type: MetricType = 'counter';
  readonly name: string;
  readonly help: string;
  readonly labelNames: string[];
  private values = new Map<string, number>();

  constructor(config: MetricConfig) {
    this.name = config.name;
    this.help = config.help;
    this.labelNames = config.labels || [];
  }

  inc(labels?: MetricLabels, value = 1): void {
    const key = this.getLabelKey(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + value);
  }

  reset(): void {
    this.values.clear();
  }

  export(): string[] {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ];

    for (const [labelKey, value] of this.values) {
      const labelStr = labelKey ? `{${labelKey}}` : '';
      lines.push(`${this.name}${labelStr} ${value}`);
    }

    return lines;
  }

  private getLabelKey(labels?: MetricLabels): string {
    if (!labels || this.labelNames.length === 0) return '';
    return this.labelNames
      .map(name => `${name}="${labels[name] || ''}"`)
      .join(',');
  }
}

/**
 * Gauge metric - can increase or decrease
 */
export class Gauge {
  readonly type: MetricType = 'gauge';
  readonly name: string;
  readonly help: string;
  readonly labelNames: string[];
  private values = new Map<string, number>();

  constructor(config: MetricConfig) {
    this.name = config.name;
    this.help = config.help;
    this.labelNames = config.labels || [];
  }

  set(labels: MetricLabels | undefined, value: number): void;
  set(value: number): void;
  set(labelsOrValue: MetricLabels | undefined | number, value?: number): void {
    if (typeof labelsOrValue === 'number') {
      this.values.set('', labelsOrValue);
    } else {
      const key = this.getLabelKey(labelsOrValue);
      this.values.set(key, value!);
    }
  }

  inc(labels?: MetricLabels, value = 1): void {
    const key = this.getLabelKey(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + value);
  }

  dec(labels?: MetricLabels, value = 1): void {
    const key = this.getLabelKey(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current - value);
  }

  reset(): void {
    this.values.clear();
  }

  export(): string[] {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
    ];

    for (const [labelKey, value] of this.values) {
      const labelStr = labelKey ? `{${labelKey}}` : '';
      lines.push(`${this.name}${labelStr} ${value}`);
    }

    return lines;
  }

  private getLabelKey(labels?: MetricLabels): string {
    if (!labels || this.labelNames.length === 0) return '';
    return this.labelNames
      .map(name => `${name}="${labels[name] || ''}"`)
      .join(',');
  }
}

/**
 * Histogram metric - tracks value distributions
 */
export class Histogram {
  readonly type: MetricType = 'histogram';
  readonly name: string;
  readonly help: string;
  readonly labelNames: string[];
  readonly buckets: number[];
  private bucketCounts = new Map<string, Map<number, number>>();
  private sums = new Map<string, number>();
  private counts = new Map<string, number>();

  constructor(config: HistogramConfig) {
    this.name = config.name;
    this.help = config.help;
    this.labelNames = config.labels || [];
    this.buckets = config.buckets || [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
  }

  observe(labels: MetricLabels | undefined, value: number): void;
  observe(value: number): void;
  observe(labelsOrValue: MetricLabels | undefined | number, value?: number): void {
    let labelKey: string;
    let observedValue: number;

    if (typeof labelsOrValue === 'number') {
      labelKey = '';
      observedValue = labelsOrValue;
    } else {
      labelKey = this.getLabelKey(labelsOrValue);
      observedValue = value!;
    }

    // Initialize bucket counts if needed
    if (!this.bucketCounts.has(labelKey)) {
      const buckets = new Map<number, number>();
      this.buckets.forEach(b => buckets.set(b, 0));
      buckets.set(Infinity, 0);
      this.bucketCounts.set(labelKey, buckets);
      this.sums.set(labelKey, 0);
      this.counts.set(labelKey, 0);
    }

    // Update bucket counts
    const buckets = this.bucketCounts.get(labelKey)!;
    for (const bucket of this.buckets) {
      if (observedValue <= bucket) {
        buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
      }
    }
    buckets.set(Infinity, (buckets.get(Infinity) || 0) + 1);

    // Update sum and count
    this.sums.set(labelKey, (this.sums.get(labelKey) || 0) + observedValue);
    this.counts.set(labelKey, (this.counts.get(labelKey) || 0) + 1);
  }

  reset(): void {
    this.bucketCounts.clear();
    this.sums.clear();
    this.counts.clear();
  }

  export(): string[] {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ];

    for (const [labelKey, buckets] of this.bucketCounts) {
      const baseLabels = labelKey ? `${labelKey},` : '';
      
      for (const bucket of [...this.buckets, Infinity]) {
        const le = bucket === Infinity ? '+Inf' : bucket.toString();
        lines.push(`${this.name}_bucket{${baseLabels}le="${le}"} ${buckets.get(bucket) || 0}`);
      }

      const labelStr = labelKey ? `{${labelKey}}` : '';
      lines.push(`${this.name}_sum${labelStr} ${this.sums.get(labelKey) || 0}`);
      lines.push(`${this.name}_count${labelStr} ${this.counts.get(labelKey) || 0}`);
    }

    return lines;
  }

  private getLabelKey(labels?: MetricLabels): string {
    if (!labels || this.labelNames.length === 0) return '';
    return this.labelNames
      .map(name => `${name}="${labels[name] || ''}"`)
      .join(',');
  }
}

// ============================================
// Registry
// ============================================

const registry = new Map<string, Counter | Gauge | Histogram>();

/**
 * Register a metric
 */
export function registerMetric<T extends Counter | Gauge | Histogram>(metric: T): T {
  registry.set(metric.name, metric);
  return metric;
}

/**
 * Get a registered metric
 */
export function getMetric(name: string): Counter | Gauge | Histogram | undefined {
  return registry.get(name);
}

/**
 * Export all metrics in Prometheus format
 */
export function exportMetrics(): string {
  const lines: string[] = [];
  
  for (const metric of registry.values()) {
    lines.push(...metric.export());
    lines.push(''); // Empty line between metrics
  }

  return lines.join('\n');
}

/**
 * Reset all metrics
 */
export function resetAllMetrics(): void {
  for (const metric of registry.values()) {
    metric.reset();
  }
}

// ============================================
// Express Middleware
// ============================================

/**
 * Create Express middleware for metrics endpoint
 */
export function createMetricsMiddleware() {
  return (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(exportMetrics());
  };
}

// ============================================
// Default Plugin Health Metrics
// ============================================

// Pre-register common plugin metrics
export const pluginMetrics = {
  loadTime: registerMetric(new Histogram({
    name: 'naap_plugin_load_time_seconds',
    help: 'Plugin load time in seconds',
    labels: ['plugin_name'],
    buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  })),

  loadTotal: registerMetric(new Counter({
    name: 'naap_plugin_load_total',
    help: 'Total plugin load attempts',
    labels: ['plugin_name', 'status'],
  })),

  errorTotal: registerMetric(new Counter({
    name: 'naap_plugin_error_total',
    help: 'Total plugin errors',
    labels: ['plugin_name', 'error_type'],
  })),

  activePlugins: registerMetric(new Gauge({
    name: 'naap_plugin_active',
    help: 'Number of active plugins',
  })),

  healthStatus: registerMetric(new Gauge({
    name: 'naap_plugin_health_status',
    help: 'Plugin health status (1=healthy, 0=unhealthy)',
    labels: ['plugin_name', 'status'],
  })),

  circuitBreaker: registerMetric(new Gauge({
    name: 'naap_plugin_circuit_breaker_state',
    help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
    labels: ['plugin_name'],
  })),
};

/**
 * Record plugin load metrics
 */
export function recordPluginLoad(pluginName: string, loadTimeMs: number, success: boolean): void {
  pluginMetrics.loadTime.observe({ plugin_name: pluginName }, loadTimeMs / 1000);
  pluginMetrics.loadTotal.inc({ plugin_name: pluginName, status: success ? 'success' : 'failure' });
  
  if (success) {
    pluginMetrics.healthStatus.set({ plugin_name: pluginName, status: 'healthy' }, 1);
    pluginMetrics.healthStatus.set({ plugin_name: pluginName, status: 'failed' }, 0);
  } else {
    pluginMetrics.healthStatus.set({ plugin_name: pluginName, status: 'healthy' }, 0);
    pluginMetrics.healthStatus.set({ plugin_name: pluginName, status: 'failed' }, 1);
  }
}

/**
 * Record plugin error
 */
export function recordPluginError(pluginName: string, errorType: string): void {
  pluginMetrics.errorTotal.inc({ plugin_name: pluginName, error_type: errorType });
}

/**
 * Update active plugin count
 */
export function setActivePluginCount(count: number): void {
  pluginMetrics.activePlugins.set(count);
}

/**
 * Update circuit breaker state
 */
export function setCircuitBreakerState(pluginName: string, state: 'closed' | 'open' | 'half-open'): void {
  const stateValue = state === 'closed' ? 0 : state === 'open' ? 1 : 2;
  pluginMetrics.circuitBreaker.set({ plugin_name: pluginName }, stateValue);
}
