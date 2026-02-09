/**
 * Redis Client
 *
 * Provides a singleton Redis connection with automatic reconnection
 * and graceful fallback when Redis is unavailable.
 */

import { Redis, type RedisOptions } from 'ioredis';

export interface RedisConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  maxRetriesPerRequest?: number;
  enableOfflineQueue?: boolean;
}

let redisInstance: Redis | null = null;
let isConnected = false;
let connectionError: Error | null = null;

/**
 * Get or create Redis client instance
 */
export function getRedis(config?: RedisConfig): Redis | null {
  if (redisInstance) {
    return isConnected ? redisInstance : null;
  }

  const redisUrl = config?.url || process.env.REDIS_URL;

  // If no Redis URL configured, return null (will use fallback)
  if (!redisUrl && !config?.host) {
    console.log('[Redis] No REDIS_URL configured, using in-memory fallback');
    return null;
  }

  try {
    const options: RedisOptions = {
      maxRetriesPerRequest: config?.maxRetriesPerRequest ?? 3,
      enableOfflineQueue: config?.enableOfflineQueue ?? false,
      lazyConnect: true,
      retryStrategy: (times: number) => {
        if (times > 3) {
          console.warn('[Redis] Max reconnection attempts reached');
          return null; // Stop retrying
        }
        return Math.min(times * 200, 2000);
      },
    };

    if (redisUrl) {
      redisInstance = new Redis(redisUrl, options);
    } else {
      redisInstance = new Redis({
        host: config?.host || 'localhost',
        port: config?.port || 6379,
        password: config?.password,
        db: config?.db || 0,
        keyPrefix: config?.keyPrefix,
        ...options,
      });
    }

    const client = redisInstance;

    client.on('connect', () => {
      console.log('[Redis] Connected');
      isConnected = true;
      connectionError = null;
    });

    client.on('error', (err: Error) => {
      console.error('[Redis] Connection error:', err.message);
      connectionError = err;
      isConnected = false;
    });

    client.on('close', () => {
      console.log('[Redis] Connection closed');
      isConnected = false;
    });

    // Try to connect
    client.connect().catch((err: Error) => {
      console.warn('[Redis] Initial connection failed:', err.message);
      isConnected = false;
    });

    return redisInstance;
  } catch (err) {
    console.error('[Redis] Failed to create client:', err);
    return null;
  }
}

/**
 * Check if Redis is currently connected
 */
export function isRedisConnected(): boolean {
  return isConnected && redisInstance !== null;
}

/**
 * Get the last connection error
 */
export function getRedisError(): Error | null {
  return connectionError;
}

/**
 * Gracefully close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    try {
      await redisInstance.quit();
      console.log('[Redis] Connection closed gracefully');
    } catch (err) {
      console.error('[Redis] Error closing connection:', err);
    } finally {
      redisInstance = null;
      isConnected = false;
    }
  }
}

/**
 * Reset Redis instance (for testing)
 */
export function resetRedis(): void {
  if (redisInstance) {
    redisInstance.disconnect();
    redisInstance = null;
  }
  isConnected = false;
  connectionError = null;
}
