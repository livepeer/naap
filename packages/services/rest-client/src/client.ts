/**
 * REST client factory with retry, rate limiting, and circuit breaker
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import type { RestClientConfig, RequestConfig, Response, CircuitBreakerConfig, CircuitBreakerState } from './types';

class CircuitBreaker {
  private state: CircuitBreakerState = {
    state: 'closed',
    failures: 0,
  };

  constructor(private config: CircuitBreakerConfig) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state.state === 'open') {
      if (this.state.nextAttemptTime && new Date() < this.state.nextAttemptTime) {
        throw new Error('Circuit breaker is open');
      }
      // Try half-open
      this.state.state = 'half-open';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.state.failures = 0;
    this.state.state = 'closed';
    this.state.lastFailureTime = undefined;
    this.state.nextAttemptTime = undefined;
  }

  private onFailure(): void {
    this.state.failures++;
    this.state.lastFailureTime = new Date();

    if (this.state.failures >= this.config.failureThreshold) {
      this.state.state = 'open';
      this.state.nextAttemptTime = new Date(
        Date.now() + this.config.resetTimeout
      );
    }
  }

  getState(): CircuitBreakerState {
    return { ...this.state };
  }
}

class RateLimiter {
  private requests: number[] = [];

  constructor(
    private maxRequests: number,
    private perMilliseconds: number
  ) {}

  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    this.requests = this.requests.filter(
      (time) => now - time < this.perMilliseconds
    );

    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.perMilliseconds - (now - oldestRequest);
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return this.waitIfNeeded();
      }
    }

    this.requests.push(now);
  }
}

/**
 * Create a REST client with configured options
 */
export function createRestClient(config: RestClientConfig): AxiosInstance {
  const axiosConfig: AxiosRequestConfig = {
    baseURL: config.baseURL,
    timeout: config.timeout ?? 30000,
    headers: {
      'Content-Type': 'application/json',
      ...config.headers,
    },
  };

  // Configure authentication
  if (config.auth) {
    if (config.auth.type === 'bearer' && config.auth.token) {
      axiosConfig.headers = {
        ...axiosConfig.headers,
        Authorization: `Bearer ${config.auth.token}`,
      };
    } else if (config.auth.type === 'basic') {
      axiosConfig.auth = {
        username: config.auth.username || '',
        password: config.auth.password || '',
      };
    } else if (config.auth.type === 'api-key' && config.auth.apiKey) {
      const headerName = config.auth.apiKeyHeader || 'X-API-Key';
      axiosConfig.headers = {
        ...axiosConfig.headers,
        [headerName]: config.auth.apiKey,
      };
    }
  }

  const client = axios.create(axiosConfig);

  // Add retry interceptor
  if (config.retry) {
    client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const config = error.config as any;
        if (!config || !config.retry) {
          return Promise.reject(error);
        }

        config.retryCount = config.retryCount || 0;

        if (config.retryCount >= config.retry.retries) {
          return Promise.reject(error);
        }

        config.retryCount += 1;

        const retryDelay = config.retry.retryDelay(config.retryCount);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));

        return client(config);
      }
    );
  }

  return client;
}

/**
 * Create a REST client with circuit breaker
 */
export function createRestClientWithCircuitBreaker(
  config: RestClientConfig,
  circuitBreakerConfig: CircuitBreakerConfig
): {
  client: AxiosInstance;
  circuitBreaker: CircuitBreaker;
  request: <T = any>(requestConfig: RequestConfig) => Promise<Response<T>>;
} {
  const client = createRestClient(config);
  const circuitBreaker = new CircuitBreaker(circuitBreakerConfig);
  const rateLimiter = config.rateLimit
    ? new RateLimiter(config.rateLimit.maxRequests, config.rateLimit.perMilliseconds)
    : null;

  const request = async <T = any>(
    requestConfig: RequestConfig
  ): Promise<Response<T>> => {
    if (rateLimiter) {
      await rateLimiter.waitIfNeeded();
    }

    return circuitBreaker.execute(async () => {
      const response = await client.request<T>({
        method: requestConfig.method,
        url: requestConfig.url,
        params: requestConfig.params,
        data: requestConfig.data,
        headers: requestConfig.headers,
        timeout: requestConfig.timeout,
      });

      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers as Record<string, string>,
      };
    });
  };

  return { client, circuitBreaker, request };
}

/**
 * Health check for REST endpoint
 */
export async function checkRestHealth(
  url: string,
  timeout: number = 5000
): Promise<boolean> {
  try {
    const response = await axios.get(url, { timeout });
    return response.status >= 200 && response.status < 300;
  } catch (error) {
    return false;
  }
}
