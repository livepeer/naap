/**
 * REST client service types and interfaces
 */

export interface RestClientConfig {
  baseURL: string;
  timeout?: number;
  headers?: Record<string, string>;
  auth?: {
    type: 'bearer' | 'basic' | 'api-key';
    token?: string;
    username?: string;
    password?: string;
    apiKey?: string;
    apiKeyHeader?: string;
  };
  retry?: {
    retries: number;
    retryDelay: (retryCount: number) => number;
    retryCondition?: (error: any) => boolean;
  };
  rateLimit?: {
    maxRequests: number;
    perMilliseconds: number;
  };
}

export interface RequestConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  params?: Record<string, any>;
  data?: any;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface Response<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
}

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailureTime?: Date;
  nextAttemptTime?: Date;
}
