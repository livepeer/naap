/**
 * Ably Real-time Integration
 *
 * Provides real-time messaging capabilities using Ably as a managed service.
 * Replaces WebSocket implementation for serverless compatibility.
 */

import Ably from 'ably';

// Types matching the existing WebSocket message format
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSource = 'backend' | 'frontend' | 'console' | 'system';

export interface LogEntry {
  id: string;
  timestamp: Date | string;
  level: LogLevel;
  plugin: string;
  message: string;
  metadata?: Record<string, unknown>;
  source: LogSource;
  stack?: string;
}

export interface PluginHealthUpdate {
  plugin: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  uptime?: number;
  lastError?: string;
  lastErrorTime?: string;
  metrics?: {
    requestsPerMinute?: number;
    errorRate?: number;
    avgResponseTime?: number;
  };
}

export interface RealtimeMessage {
  type: string;
  payload: unknown;
  timestamp: string;
  targetRoles?: string[];
  targetUsers?: string[];
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'suspended' | 'failed';

export interface AblyConfig {
  apiKey?: string;
  authUrl?: string;
  clientId?: string;
}

/**
 * Ably Real-time Client
 *
 * Provides a unified interface for real-time messaging that can work with
 * either Ably or fall back to polling for environments without Ably.
 */
export class AblyRealtimeClient {
  private client: Ably.Realtime | null = null;
  private channels: Map<string, Ably.RealtimeChannel> = new Map();
  private subscriptions: Map<string, Set<(message: RealtimeMessage) => void>> = new Map();
  private statusListeners: Set<(status: ConnectionStatus) => void> = new Set();
  private _status: ConnectionStatus = 'disconnected';
  private userId?: string;
  private roles: string[] = [];

  constructor(private config: AblyConfig) {}

  /**
   * Get current connection status
   */
  get status(): ConnectionStatus {
    return this._status;
  }

  /**
   * Connect to Ably with authentication
   */
  async connect(userId: string, roles: string[] = []): Promise<void> {
    this.userId = userId;
    this.roles = roles;

    // If no Ably API key or auth URL, use mock mode
    if (!this.config.apiKey && !this.config.authUrl) {
      console.log('[Ably] No API key configured, using mock mode');
      this.setStatus('connected');
      return;
    }

    try {
      this.setStatus('connecting');

      // Initialize Ably client
      const options: Ably.ClientOptions = {
        clientId: this.config.clientId || userId,
        ...(this.config.apiKey
          ? { key: this.config.apiKey }
          : { authUrl: this.config.authUrl }),
        autoConnect: true,
        echoMessages: false,
      };

      this.client = new Ably.Realtime(options);

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);

        this.client!.connection.on('connected', () => {
          clearTimeout(timeoutId);
          this.setStatus('connected');
          resolve();
        });

        this.client!.connection.on('failed', (stateChange) => {
          clearTimeout(timeoutId);
          this.setStatus('failed');
          reject(new Error(stateChange.reason?.message || 'Connection failed'));
        });

        this.client!.connection.on('suspended', () => {
          this.setStatus('suspended');
        });

        this.client!.connection.on('disconnected', () => {
          this.setStatus('disconnected');
        });
      });
    } catch (error) {
      this.setStatus('failed');
      throw error;
    }
  }

  /**
   * Disconnect from Ably
   */
  disconnect(): void {
    if (this.client) {
      // Unsubscribe from all channels
      this.channels.forEach((channel, name) => {
        channel.unsubscribe();
        this.client?.channels.release(name);
      });
      this.channels.clear();

      // Close connection
      this.client.close();
      this.client = null;
    }

    this.setStatus('disconnected');
  }

  /**
   * Subscribe to a channel
   */
  async subscribe(
    channelName: string,
    callback: (message: RealtimeMessage) => void
  ): Promise<() => void> {
    // Track subscription
    if (!this.subscriptions.has(channelName)) {
      this.subscriptions.set(channelName, new Set());
    }
    this.subscriptions.get(channelName)!.add(callback);

    // If connected to Ably, set up channel subscription
    if (this.client && this.status === 'connected') {
      let channel = this.channels.get(channelName);

      if (!channel) {
        channel = this.client.channels.get(channelName);
        this.channels.set(channelName, channel);

        // Subscribe to messages
        channel.subscribe((message: Ably.Message) => {
          const realtimeMessage = this.parseMessage(message);
          if (this.shouldReceiveMessage(realtimeMessage)) {
            this.notifySubscribers(channelName, realtimeMessage);
          }
        });
      }
    }

    // Return unsubscribe function
    return () => {
      this.unsubscribe(channelName, callback);
    };
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channelName: string, callback?: (message: RealtimeMessage) => void): void {
    const subscribers = this.subscriptions.get(channelName);

    if (subscribers) {
      if (callback) {
        subscribers.delete(callback);
      } else {
        subscribers.clear();
      }

      // If no more subscribers, release channel
      if (subscribers.size === 0) {
        this.subscriptions.delete(channelName);

        const channel = this.channels.get(channelName);
        if (channel && this.client) {
          channel.unsubscribe();
          this.client.channels.release(channelName);
          this.channels.delete(channelName);
        }
      }
    }
  }

  /**
   * Publish a message to a channel
   */
  async publish(channelName: string, message: RealtimeMessage): Promise<void> {
    if (this.client && this.status === 'connected') {
      let channel = this.channels.get(channelName);

      if (!channel) {
        channel = this.client.channels.get(channelName);
        this.channels.set(channelName, channel);
      }

      await channel.publish(message.type, message);
    } else {
      // In mock mode, just notify local subscribers
      this.notifySubscribers(channelName, message);
    }
  }

  /**
   * Subscribe to connection status changes
   */
  onStatusChange(callback: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  /**
   * Check if client should receive a message based on role/user targeting
   */
  private shouldReceiveMessage(message: RealtimeMessage): boolean {
    // If no targeting, receive message
    if (!message.targetRoles && !message.targetUsers) {
      return true;
    }

    // Check user targeting
    if (message.targetUsers && this.userId) {
      if (message.targetUsers.includes(this.userId)) {
        return true;
      }
    }

    // Check role targeting
    if (message.targetRoles && this.roles.length > 0) {
      if (message.targetRoles.some(role => this.roles.includes(role))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Parse Ably message to RealtimeMessage
   */
  private parseMessage(message: Ably.Message): RealtimeMessage {
    const data = message.data as RealtimeMessage;
    return {
      type: message.name || data.type || 'message',
      payload: data.payload ?? data,
      timestamp: data.timestamp || new Date().toISOString(),
      targetRoles: data.targetRoles,
      targetUsers: data.targetUsers,
    };
  }

  /**
   * Notify subscribers of a message
   */
  private notifySubscribers(channelName: string, message: RealtimeMessage): void {
    const subscribers = this.subscriptions.get(channelName);
    if (subscribers) {
      subscribers.forEach(callback => {
        try {
          callback(message);
        } catch (error) {
          console.error('[Ably] Subscriber error:', error);
        }
      });
    }
  }

  /**
   * Set connection status and notify listeners
   */
  private setStatus(status: ConnectionStatus): void {
    this._status = status;
    this.statusListeners.forEach(callback => {
      try {
        callback(status);
      } catch (error) {
        console.error('[Ably] Status listener error:', error);
      }
    });
  }
}

/**
 * Channel name generators for different features
 */
export const Channels = {
  // Global notifications channel
  notifications: () => 'naap:notifications',

  // User-specific channel
  user: (userId: string) => `naap:user:${userId}`,

  // Plugin debug logs channel
  pluginLogs: (pluginName: string) => `naap:debug:${pluginName}`,

  // Plugin health updates channel
  pluginHealth: () => 'naap:plugin:health',

  // System events channel
  system: () => 'naap:system',

  // Team-specific channel
  team: (teamId: string) => `naap:team:${teamId}`,
};

/**
 * Create Ably client with default configuration
 */
export function createAblyClient(): AblyRealtimeClient {
  return new AblyRealtimeClient({
    apiKey: process.env.NEXT_PUBLIC_ABLY_API_KEY,
    authUrl: process.env.NEXT_PUBLIC_ABLY_AUTH_URL || '/api/v1/realtime/token',
    clientId: undefined, // Will be set on connect
  });
}

// Singleton instance for client-side use
let clientInstance: AblyRealtimeClient | null = null;

export function getAblyClient(): AblyRealtimeClient {
  if (!clientInstance) {
    clientInstance = createAblyClient();
  }
  return clientInstance;
}
