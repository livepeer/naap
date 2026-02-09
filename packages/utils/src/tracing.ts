/**
 * OpenTelemetry Tracing Infrastructure
 * 
 * Phase 3: Provides distributed tracing for observability across all services.
 * 
 * Usage:
 * ```typescript
 * import { initTracing, createSpan, withSpan } from '@naap/utils';
 * 
 * // Initialize at service startup
 * initTracing({ serviceName: 'base-svc' });
 * 
 * // Create spans for operations
 * const span = createSpan('load-plugin', { pluginName: 'my-plugin' });
 * try {
 *   await loadPlugin();
 *   span.setStatus({ code: SpanStatusCode.OK });
 * } finally {
 *   span.end();
 * }
 * 
 * // Or use the wrapper
 * await withSpan('fetch-data', async (span) => {
 *   const data = await fetchData();
 *   span.setAttribute('data.count', data.length);
 *   return data;
 * });
 * ```
 */

// Note: This is a lightweight implementation that can be enhanced with
// actual OpenTelemetry SDK when dependencies are added

// ============================================
// Types
// ============================================

export interface TracingConfig {
  /** Service name for trace identification */
  serviceName: string;
  /** Service version */
  serviceVersion?: string;
  /** Exporter endpoint (e.g., Jaeger, Zipkin, OTLP) */
  exporterEndpoint?: string;
  /** Whether tracing is enabled */
  enabled?: boolean;
  /** Sample rate (0-1) */
  sampleRate?: number;
  /** Additional resource attributes */
  resourceAttributes?: Record<string, string>;
}

export interface Span {
  /** Span ID */
  spanId: string;
  /** Trace ID */
  traceId: string;
  /** Parent span ID */
  parentSpanId?: string;
  /** Operation name */
  name: string;
  /** Start time */
  startTime: number;
  /** End time */
  endTime?: number;
  /** Attributes */
  attributes: Record<string, unknown>;
  /** Status */
  status: SpanStatus;
  /** Events */
  events: SpanEvent[];
  
  /** Set an attribute */
  setAttribute(key: string, value: unknown): Span;
  /** Add an event */
  addEvent(name: string, attributes?: Record<string, unknown>): Span;
  /** Set status */
  setStatus(status: SpanStatus): Span;
  /** Record exception */
  recordException(error: Error): Span;
  /** End the span */
  end(): void;
}

export interface SpanStatus {
  code: SpanStatusCode;
  message?: string;
}

export enum SpanStatusCode {
  UNSET = 0,
  OK = 1,
  ERROR = 2,
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}

// ============================================
// State
// ============================================

let tracingConfig: TracingConfig | null = null;
let isInitialized = false;

// In-memory span storage (for development/testing)
const activeSpans = new Map<string, InternalSpan>();
const completedSpans: InternalSpan[] = [];
const MAX_COMPLETED_SPANS = 1000;

// Context for span hierarchy
const spanStack: string[] = [];

// ============================================
// Internal Span Implementation
// ============================================

class InternalSpan implements Span {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, unknown> = {};
  status: SpanStatus = { code: SpanStatusCode.UNSET };
  events: SpanEvent[] = [];
  
  private ended = false;

  constructor(name: string, parentSpanId?: string, traceId?: string) {
    this.spanId = generateId();
    this.traceId = traceId || generateId();
    this.parentSpanId = parentSpanId;
    this.name = name;
    this.startTime = Date.now();
    
    // Add default attributes
    if (tracingConfig) {
      this.attributes['service.name'] = tracingConfig.serviceName;
      if (tracingConfig.serviceVersion) {
        this.attributes['service.version'] = tracingConfig.serviceVersion;
      }
    }
  }

  setAttribute(key: string, value: unknown): Span {
    if (!this.ended) {
      this.attributes[key] = value;
    }
    return this;
  }

  addEvent(name: string, attributes?: Record<string, unknown>): Span {
    if (!this.ended) {
      this.events.push({
        name,
        timestamp: Date.now(),
        attributes,
      });
    }
    return this;
  }

  setStatus(status: SpanStatus): Span {
    if (!this.ended) {
      this.status = status;
    }
    return this;
  }

  recordException(error: Error): Span {
    if (!this.ended) {
      this.addEvent('exception', {
        'exception.type': error.name,
        'exception.message': error.message,
        'exception.stacktrace': error.stack,
      });
      this.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    }
    return this;
  }

  end(): void {
    if (this.ended) return;
    
    this.ended = true;
    this.endTime = Date.now();
    
    // Remove from active spans
    activeSpans.delete(this.spanId);
    
    // Pop from span stack if this is the current span
    const stackIndex = spanStack.indexOf(this.spanId);
    if (stackIndex !== -1) {
      spanStack.splice(stackIndex, 1);
    }
    
    // Add to completed spans (with limit)
    completedSpans.push(this);
    if (completedSpans.length > MAX_COMPLETED_SPANS) {
      completedSpans.shift();
    }
    
    // Export span (would send to collector in production)
    exportSpan(this);
  }
}

// ============================================
// Public API
// ============================================

/**
 * Initialize tracing for a service
 */
export function initTracing(config: TracingConfig): void {
  tracingConfig = {
    enabled: true,
    sampleRate: 1.0,
    ...config,
  };
  isInitialized = true;
  
  console.log(`[Tracing] Initialized for service: ${config.serviceName}`);
}

/**
 * Check if tracing is enabled
 */
export function isTracingEnabled(): boolean {
  return isInitialized && (tracingConfig?.enabled ?? false);
}

/**
 * Create a new span
 */
export function createSpan(name: string, attributes?: Record<string, unknown>): Span {
  // Get parent span from stack
  const parentSpanId = spanStack[spanStack.length - 1];
  const parentSpan = parentSpanId ? activeSpans.get(parentSpanId) : undefined;
  
  // Create span (inherit trace ID from parent)
  const span = new InternalSpan(name, parentSpanId, parentSpan?.traceId);
  
  // Add initial attributes
  if (attributes) {
    Object.entries(attributes).forEach(([key, value]) => {
      span.setAttribute(key, value);
    });
  }
  
  // Store and push to stack
  activeSpans.set(span.spanId, span);
  spanStack.push(span.spanId);
  
  return span;
}

/**
 * Execute a function within a span context
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, unknown>
): Promise<T> {
  const span = createSpan(name, attributes);
  
  try {
    const result = await fn(span);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Execute a sync function within a span context
 */
export function withSpanSync<T>(
  name: string,
  fn: (span: Span) => T,
  attributes?: Record<string, unknown>
): T {
  const span = createSpan(name, attributes);
  
  try {
    const result = fn(span);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Get current span context for propagation
 */
export function getCurrentSpanContext(): { traceId: string; spanId: string } | null {
  const currentSpanId = spanStack[spanStack.length - 1];
  if (!currentSpanId) return null;
  
  const span = activeSpans.get(currentSpanId);
  if (!span) return null;
  
  return {
    traceId: span.traceId,
    spanId: span.spanId,
  };
}

/**
 * Inject trace context into headers for propagation
 */
export function injectTraceContext(headers: Record<string, string>): Record<string, string> {
  const context = getCurrentSpanContext();
  if (context) {
    // W3C Trace Context format
    headers['traceparent'] = `00-${context.traceId}-${context.spanId}-01`;
  }
  return headers;
}

/**
 * Extract trace context from headers
 */
export function extractTraceContext(headers: Record<string, string | string[] | undefined>): {
  traceId: string;
  parentSpanId: string;
} | null {
  const traceparent = headers['traceparent'];
  if (!traceparent || typeof traceparent !== 'string') return null;
  
  // Parse W3C Trace Context: 00-traceId-spanId-flags
  const parts = traceparent.split('-');
  if (parts.length >= 3) {
    return {
      traceId: parts[1],
      parentSpanId: parts[2],
    };
  }
  
  return null;
}

/**
 * Get completed spans (for testing/debugging)
 */
export function getCompletedSpans(): readonly InternalSpan[] {
  return completedSpans;
}

/**
 * Clear completed spans (for testing)
 */
export function clearCompletedSpans(): void {
  completedSpans.length = 0;
}

// ============================================
// Express Middleware
// ============================================

/**
 * Express middleware for automatic request tracing
 */
export function tracingMiddleware() {
  return (req: any, res: any, next: any) => {
    if (!isTracingEnabled()) {
      return next();
    }
    
    // Extract parent context from headers
    const parentContext = extractTraceContext(req.headers);
    
    // Create span for the request
    const span = new InternalSpan(
      `${req.method} ${req.path}`,
      parentContext?.parentSpanId,
      parentContext?.traceId
    );
    
    // Add request attributes
    span.setAttribute('http.method', req.method);
    span.setAttribute('http.url', req.url);
    span.setAttribute('http.route', req.route?.path || req.path);
    span.setAttribute('http.user_agent', req.headers['user-agent']);
    
    if (req.user?.id) {
      span.setAttribute('user.id', req.user.id);
    }
    if (req.tenant?.tenantId) {
      span.setAttribute('tenant.id', req.tenant.tenantId);
    }
    
    // Store span on request
    req.span = span;
    activeSpans.set(span.spanId, span);
    spanStack.push(span.spanId);
    
    // Add trace headers to response
    res.setHeader('x-trace-id', span.traceId);
    
    // End span on response finish
    res.on('finish', () => {
      span.setAttribute('http.status_code', res.statusCode);
      span.setStatus({
        code: res.statusCode >= 400 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
      });
      span.end();
    });
    
    next();
  };
}

// ============================================
// Helpers
// ============================================

function generateId(): string {
  return [...Array(16)]
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join('');
}

function exportSpan(span: InternalSpan): void {
  // In development, log to console
  if (process.env.NODE_ENV !== 'production' && process.env.TRACE_DEBUG) {
    const duration = span.endTime ? span.endTime - span.startTime : 0;
    console.log(`[Trace] ${span.name} (${duration}ms)`, {
      traceId: span.traceId,
      spanId: span.spanId,
      status: span.status.code === SpanStatusCode.OK ? 'OK' : 'ERROR',
      attributes: span.attributes,
    });
  }
  
  // In production, would send to OTLP collector
  // if (tracingConfig?.exporterEndpoint) {
  //   sendToCollector(span);
  // }
}
