/**
 * Real-time Context Provider
 *
 * Provides real-time messaging capabilities throughout the app.
 * Handles connection management, automatic reconnection, and fallback polling.
 */

'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  getAblyClient,
  AblyRealtimeClient,
  ConnectionStatus,
  Channels,
} from '@/lib/realtime/ably';

interface RealtimeContextValue {
  status: ConnectionStatus;
  error: Error | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  client: AblyRealtimeClient | null;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

interface RealtimeProviderProps {
  children: React.ReactNode;
  userId?: string;
  roles?: string[];
  autoConnect?: boolean;
}

export function RealtimeProvider({
  children,
  userId,
  roles = [],
  autoConnect = true,
}: RealtimeProviderProps) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<Error | null>(null);
  const clientRef = useRef<AblyRealtimeClient | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectDelay = useRef(1000);

  // Initialize client
  useEffect(() => {
    if (!clientRef.current) {
      clientRef.current = getAblyClient();
    }
  }, []);

  // Connect to realtime service
  const connect = useCallback(async () => {
    if (!userId) {
      console.warn('[Realtime] Cannot connect without userId');
      return;
    }

    const client = clientRef.current;
    if (!client) return;

    try {
      setError(null);
      await client.connect(userId, roles);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Connection failed');
      setError(error);

      // Attempt reconnection with exponential backoff
      if (reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current++;
        const delay = reconnectDelay.current * Math.pow(2, reconnectAttempts.current - 1);
        console.log(`[Realtime] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`);

        setTimeout(() => {
          connect();
        }, delay);
      } else {
        console.error('[Realtime] Max reconnection attempts reached, switching to polling');
        startFallbackPolling();
      }
    }
  }, [userId, roles]);

  // Disconnect from realtime service
  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    stopFallbackPolling();
  }, []);

  // Fallback polling when realtime connection fails
  const startFallbackPolling = useCallback(() => {
    if (pollingIntervalRef.current) return;

    console.log('[Realtime] Starting fallback polling');

    pollingIntervalRef.current = setInterval(async () => {
      try {
        // Poll notifications endpoint
        const response = await fetch('/api/v1/notifications/poll', {
          credentials: 'include',
        });

        if (response.ok) {
          const data = await response.json();
          if (data.notifications?.length > 0) {
            // Emit to local subscribers via mock publish
            const client = clientRef.current;
            if (client) {
              data.notifications.forEach((notification: unknown) => {
                client.publish(Channels.notifications(), {
                  type: 'notification',
                  payload: notification,
                  timestamp: new Date().toISOString(),
                });
              });
            }
          }
        }
      } catch (err) {
        console.error('[Realtime] Polling error:', err);
      }
    }, 5000); // Poll every 5 seconds
  }, []);

  const stopFallbackPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Subscribe to status changes
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;

    const unsubscribe = client.onStatusChange((newStatus) => {
      setStatus(newStatus);

      if (newStatus === 'connected') {
        reconnectAttempts.current = 0;
        reconnectDelay.current = 1000;
        stopFallbackPolling();
      } else if (newStatus === 'failed' || newStatus === 'suspended') {
        startFallbackPolling();
      }
    });

    return unsubscribe;
  }, [startFallbackPolling, stopFallbackPolling]);

  // Auto-connect when userId is available
  useEffect(() => {
    if (autoConnect && userId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, userId, connect, disconnect]);

  const value: RealtimeContextValue = {
    status,
    error,
    isConnected: status === 'connected',
    connect,
    disconnect,
    client: clientRef.current,
  };

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtimeContext() {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtimeContext must be used within a RealtimeProvider');
  }
  return context;
}

/**
 * Connection status indicator component
 */
export function ConnectionStatusIndicator() {
  const { status, error } = useRealtimeContext();

  const statusColors: Record<ConnectionStatus, string> = {
    connected: 'bg-green-500',
    connecting: 'bg-yellow-500',
    disconnected: 'bg-gray-500',
    suspended: 'bg-orange-500',
    failed: 'bg-red-500',
  };

  const statusLabels: Record<ConnectionStatus, string> = {
    connected: 'Connected',
    connecting: 'Connecting...',
    disconnected: 'Disconnected',
    suspended: 'Reconnecting...',
    failed: 'Connection Failed',
  };

  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${statusColors[status]}`} />
      <span className="text-sm text-muted-foreground">
        {statusLabels[status]}
      </span>
      {error && (
        <span className="text-xs text-red-500" title={error.message}>
          !
        </span>
      )}
    </div>
  );
}
