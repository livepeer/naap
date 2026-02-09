/**
 * WebSocket Service
 *
 * Provides real-time event broadcasting to connected clients.
 * Supports authenticated connections, scoped messaging, and debug log streaming.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { PrismaClient } from '@naap/database';
import { getLogAggregator, type LogAggregator } from './logAggregator';
import type { LogEntry, PluginHealthUpdate } from '@naap/types';

export interface WebSocketClient {
  ws: WebSocket;
  userId?: string;
  roles: string[];
  subscribedEvents: Set<string>;
  subscribedPlugins: Set<string>; // For debug log streaming
  connectedAt: Date;
  lastPing: Date;
  debugEnabled: boolean; // Whether this client is subscribed to debug logs
}

export interface BroadcastEvent {
  type: string;
  payload: unknown;
  timestamp: string;
  targetRoles?: string[]; // If set, only send to users with these roles
  targetUsers?: string[]; // If set, only send to these users
}

export function createWebSocketService(prisma: PrismaClient) {
  let wss: WebSocketServer | null = null;
  const clients = new Map<WebSocket, WebSocketClient>();
  const logAggregator: LogAggregator = getLogAggregator();

  // Heartbeat interval (30 seconds)
  const HEARTBEAT_INTERVAL = 30000;
  const CONNECTION_TIMEOUT = 60000;

  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let logUnsubscribe: (() => void) | null = null;
  let healthUnsubscribe: (() => void) | null = null;
  
  /**
   * Validate session token and return user info
   */
  async function validateToken(token: string): Promise<{
    userId: string;
    roles: string[];
  } | null> {
    try {
      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: true },
      });
      
      if (!session || new Date(session.expiresAt) < new Date()) {
        return null;
      }
      
      // Get user roles
      const userRoles = await prisma.userRole.findMany({
        where: { userId: session.userId },
        include: { role: true },
      });
      
      const roles = userRoles.map(ur => ur.role.name);
      
      return {
        userId: session.userId,
        roles,
      };
    } catch (error) {
      console.error('WebSocket token validation error:', error);
      return null;
    }
  }
  
  /**
   * Initialize WebSocket server
   */
  function initialize(server: Server, path: string = '/ws'): void {
    wss = new WebSocketServer({ 
      server,
      path,
    });
    
    wss.on('connection', async (ws: WebSocket, req) => {
      // Extract token from query string
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      
      let client: WebSocketClient = {
        ws,
        roles: [],
        subscribedEvents: new Set(['*']), // Subscribe to all by default
        subscribedPlugins: new Set(),
        connectedAt: new Date(),
        lastPing: new Date(),
        debugEnabled: false,
      };
      
      // Authenticate if token provided
      if (token) {
        const auth = await validateToken(token);
        if (auth) {
          client.userId = auth.userId;
          client.roles = auth.roles;
          console.log(`WebSocket: Authenticated connection for user ${auth.userId}`);
        } else {
          // Invalid token - allow connection but as anonymous
          console.log('WebSocket: Anonymous connection (invalid token)');
        }
      } else {
        console.log('WebSocket: Anonymous connection (no token)');
      }
      
      clients.set(ws, client);
      
      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connected',
        payload: {
          authenticated: !!client.userId,
          subscribedEvents: Array.from(client.subscribedEvents),
        },
        timestamp: new Date().toISOString(),
      }));
      
      // Handle messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          handleMessage(ws, message);
        } catch (error) {
          console.error('WebSocket: Invalid message received:', error);
        }
      });
      
      // Handle pong (heartbeat response)
      ws.on('pong', () => {
        const c = clients.get(ws);
        if (c) {
          c.lastPing = new Date();
        }
      });
      
      // Handle close
      ws.on('close', () => {
        clients.delete(ws);
        console.log(`WebSocket: Connection closed. Active clients: ${clients.size}`);
      });
      
      // Handle errors
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients.delete(ws);
      });
    });
    
    // Start heartbeat check
    heartbeatInterval = setInterval(() => {
      const now = Date.now();

      clients.forEach((client, ws) => {
        const lastPingAge = now - client.lastPing.getTime();

        if (lastPingAge > CONNECTION_TIMEOUT) {
          // Connection timed out
          console.log('WebSocket: Connection timed out');
          ws.terminate();
          clients.delete(ws);
          return;
        }

        // Send ping
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      });
    }, HEARTBEAT_INTERVAL);

    // Subscribe to log aggregator for streaming
    logUnsubscribe = logAggregator.onLog((plugin, log) => {
      streamLog(plugin, log);
    });

    healthUnsubscribe = logAggregator.onHealth((plugin, health) => {
      streamHealthUpdate(plugin, health);
    });

    console.log(`WebSocket server initialized at ${path}`);
  }
  
  /**
   * Handle incoming messages
   */
  function handleMessage(ws: WebSocket, message: { type: string; payload?: unknown; plugin?: string; token?: string }): void {
    const client = clients.get(ws);
    if (!client) return;

    switch (message.type) {
      case 'subscribe':
        // Subscribe to specific event types
        if (Array.isArray(message.payload)) {
          message.payload.forEach(event => {
            if (typeof event === 'string') {
              client.subscribedEvents.add(event);
            }
          });
        }
        // Also handle plugin subscription for debug
        if (typeof message.plugin === 'string') {
          subscribeToPlugin(client, message.plugin);
        }
        ws.send(JSON.stringify({
          type: 'subscribed',
          payload: Array.from(client.subscribedEvents),
          plugins: Array.from(client.subscribedPlugins),
          timestamp: new Date().toISOString(),
        }));
        break;

      case 'unsubscribe':
        // Unsubscribe from event types
        if (Array.isArray(message.payload)) {
          message.payload.forEach(event => {
            if (typeof event === 'string') {
              client.subscribedEvents.delete(event);
            }
          });
        }
        // Also handle plugin unsubscription for debug
        if (typeof message.plugin === 'string') {
          client.subscribedPlugins.delete(message.plugin);
        }
        break;

      case 'ping':
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: new Date().toISOString(),
        }));
        break;

      // Debug-specific message types
      case 'debug:subscribe':
        if (typeof message.plugin === 'string') {
          subscribeToPlugin(client, message.plugin);
        }
        break;

      case 'debug:unsubscribe':
        if (typeof message.plugin === 'string') {
          client.subscribedPlugins.delete(message.plugin);
        }
        break;

      case 'debug:get_logs':
        if (typeof message.plugin === 'string') {
          sendBufferedLogs(ws, message.plugin);
        }
        break;

      case 'debug:get_health':
        sendHealthStatus(ws, message.plugin);
        break;

      case 'debug:clear':
        if (typeof message.plugin === 'string') {
          logAggregator.clearLogs(message.plugin);
          ws.send(JSON.stringify({
            type: 'debug:cleared',
            plugin: message.plugin,
            timestamp: new Date().toISOString(),
          }));
        }
        break;

      case 'debug:restart':
        if (typeof message.plugin === 'string') {
          // Broadcast restart request - actual restart handled by plugin lifecycle
          broadcast({
            type: 'plugin:restart_requested',
            payload: { plugin: message.plugin, requestedBy: client.userId },
            timestamp: new Date().toISOString(),
          });
        }
        break;

      case 'auth':
        // Re-authenticate with new token
        if (typeof message.token === 'string') {
          validateToken(message.token).then(auth => {
            if (auth) {
              client.userId = auth.userId;
              client.roles = auth.roles;
              ws.send(JSON.stringify({
                type: 'authenticated',
                userId: auth.userId,
                timestamp: new Date().toISOString(),
              }));
            }
          });
        }
        break;

      default:
        console.log('WebSocket: Unknown message type:', message.type);
    }
  }

  /**
   * Subscribe a client to a plugin's logs
   */
  function subscribeToPlugin(client: WebSocketClient, plugin: string): void {
    client.subscribedPlugins.add(plugin);
    client.debugEnabled = true;

    // Send buffered logs immediately
    sendBufferedLogs(client.ws, plugin);

    // Send current health status
    const health = logAggregator.getHealth(plugin);
    if (health) {
      client.ws.send(JSON.stringify({
        type: 'health_update',
        plugin,
        data: {
          plugin: health.plugin,
          status: health.status,
          uptime: health.uptime,
          lastError: health.lastError,
          lastErrorTime: health.lastErrorTime?.toISOString(),
          metrics: health.metrics,
        },
        timestamp: new Date().toISOString(),
      }));
    }
  }

  /**
   * Send buffered logs to a client
   */
  function sendBufferedLogs(ws: WebSocket, plugin: string): void {
    const logs = logAggregator.getLogs(plugin, 100); // Send last 100 logs
    if (logs.length > 0) {
      ws.send(JSON.stringify({
        type: 'logs_batch',
        plugin,
        data: logs,
        timestamp: new Date().toISOString(),
      }));
    }
  }

  /**
   * Send health status to a client
   */
  function sendHealthStatus(ws: WebSocket, plugin?: string): void {
    if (plugin) {
      const health = logAggregator.getHealth(plugin);
      if (health) {
        ws.send(JSON.stringify({
          type: 'health_update',
          plugin,
          data: {
            plugin: health.plugin,
            status: health.status,
            uptime: health.uptime,
            lastError: health.lastError,
            lastErrorTime: health.lastErrorTime?.toISOString(),
            metrics: health.metrics,
          },
          timestamp: new Date().toISOString(),
        }));
      }
    } else {
      // Send all health statuses
      const allHealth = logAggregator.getAllHealth();
      allHealth.forEach(health => {
        ws.send(JSON.stringify({
          type: 'health_update',
          plugin: health.plugin,
          data: {
            plugin: health.plugin,
            status: health.status,
            uptime: health.uptime,
            lastError: health.lastError,
            lastErrorTime: health.lastErrorTime?.toISOString(),
            metrics: health.metrics,
          },
          timestamp: new Date().toISOString(),
        }));
      });
    }
  }

  /**
   * Stream a log entry to subscribed clients
   */
  function streamLog(plugin: string, log: LogEntry): void {
    clients.forEach((client, ws) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (!client.debugEnabled) return;
      if (!client.subscribedPlugins.has(plugin)) return;

      ws.send(JSON.stringify({
        type: 'log',
        plugin,
        data: log,
        timestamp: new Date().toISOString(),
      }));
    });
  }

  /**
   * Stream health update to subscribed clients
   */
  function streamHealthUpdate(plugin: string, health: PluginHealthUpdate): void {
    clients.forEach((client, ws) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (!client.debugEnabled) return;
      if (!client.subscribedPlugins.has(plugin)) return;

      ws.send(JSON.stringify({
        type: 'health_update',
        plugin,
        data: health,
        timestamp: new Date().toISOString(),
      }));
    });
  }
  
  /**
   * Broadcast an event to connected clients
   */
  function broadcast(event: BroadcastEvent): void {
    if (!wss) return;
    
    const message = JSON.stringify({
      type: event.type,
      payload: event.payload,
      timestamp: event.timestamp || new Date().toISOString(),
    });
    
    clients.forEach((client, ws) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      
      // Check if client is subscribed to this event
      if (!client.subscribedEvents.has('*') && !client.subscribedEvents.has(event.type)) {
        return;
      }
      
      // Check role-based filtering
      if (event.targetRoles && event.targetRoles.length > 0) {
        const hasRole = event.targetRoles.some(role => client.roles.includes(role));
        if (!hasRole) return;
      }
      
      // Check user-based filtering
      if (event.targetUsers && event.targetUsers.length > 0) {
        if (!client.userId || !event.targetUsers.includes(client.userId)) {
          return;
        }
      }
      
      ws.send(message);
    });
  }
  
  /**
   * Send to a specific user
   */
  function sendToUser(userId: string, event: Omit<BroadcastEvent, 'targetUsers'>): void {
    broadcast({ ...event, targetUsers: [userId] });
  }
  
  /**
   * Send to users with specific roles
   */
  function sendToRoles(roles: string[], event: Omit<BroadcastEvent, 'targetRoles'>): void {
    broadcast({ ...event, targetRoles: roles });
  }
  
  /**
   * Get connection stats
   */
  function getStats(): {
    totalConnections: number;
    authenticatedConnections: number;
    anonymousConnections: number;
  } {
    let authenticated = 0;
    let anonymous = 0;
    
    clients.forEach(client => {
      if (client.userId) {
        authenticated++;
      } else {
        anonymous++;
      }
    });
    
    return {
      totalConnections: clients.size,
      authenticatedConnections: authenticated,
      anonymousConnections: anonymous,
    };
  }
  
  /**
   * Shutdown WebSocket server
   */
  function shutdown(): void {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    // Unsubscribe from log aggregator
    if (logUnsubscribe) {
      logUnsubscribe();
      logUnsubscribe = null;
    }
    if (healthUnsubscribe) {
      healthUnsubscribe();
      healthUnsubscribe = null;
    }

    // Close all connections
    clients.forEach((_, ws) => {
      ws.close(1000, 'Server shutting down');
    });
    clients.clear();

    if (wss) {
      wss.close();
      wss = null;
    }

    console.log('WebSocket server shut down');
  }
  
  return {
    initialize,
    broadcast,
    sendToUser,
    sendToRoles,
    getStats,
    shutdown,
    logAggregator,
  };
}

export type WebSocketService = ReturnType<typeof createWebSocketService>;
