/**
 * React Hooks for Real-time Features
 *
 * Provides easy-to-use hooks for subscribing to real-time events.
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getAblyClient,
  AblyRealtimeClient,
  ConnectionStatus,
  RealtimeMessage,
  LogEntry,
  PluginHealthUpdate,
  Channels,
} from './ably';

/**
 * Hook for managing real-time connection
 */
export function useRealtime(userId?: string, roles?: string[]) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<Error | null>(null);
  const clientRef = useRef<AblyRealtimeClient | null>(null);

  useEffect(() => {
    if (!userId) return;

    const client = getAblyClient();
    clientRef.current = client;

    // Subscribe to status changes
    const unsubscribe = client.onStatusChange(setStatus);

    // Connect
    client.connect(userId, roles).catch(setError);

    return () => {
      unsubscribe();
      // Don't disconnect here as other hooks may be using the client
    };
  }, [userId, roles]);

  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect();
    }
  }, []);

  return { status, error, disconnect, client: clientRef.current };
}

/**
 * Hook for subscribing to a channel
 */
export function useChannel<T = unknown>(
  channelName: string | null,
  onMessage?: (message: RealtimeMessage) => void
) {
  const [messages, setMessages] = useState<RealtimeMessage[]>([]);
  const [lastMessage, setLastMessage] = useState<RealtimeMessage | null>(null);

  useEffect(() => {
    if (!channelName) return;

    const client = getAblyClient();
    if (client.status !== 'connected') return;

    const handleMessage = (message: RealtimeMessage) => {
      setLastMessage(message);
      setMessages(prev => [...prev, message]);
      onMessage?.(message);
    };

    let unsubscribe: (() => void) | null = null;

    client.subscribe(channelName, handleMessage).then(unsub => {
      unsubscribe = unsub;
    });

    return () => {
      unsubscribe?.();
    };
  }, [channelName, onMessage]);

  const publish = useCallback(
    async (type: string, payload: T) => {
      if (!channelName) return;

      const client = getAblyClient();
      await client.publish(channelName, {
        type,
        payload,
        timestamp: new Date().toISOString(),
      });
    },
    [channelName]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setLastMessage(null);
  }, []);

  return { messages, lastMessage, publish, clearMessages };
}

/**
 * Hook for plugin debug logs
 */
export function useDebugLogs(pluginName: string | null) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [health, setHealth] = useState<PluginHealthUpdate | null>(null);

  const channelName = pluginName ? Channels.pluginLogs(pluginName) : null;

  useEffect(() => {
    if (!channelName) {
      setLogs([]);
      setHealth(null);
      return;
    }

    const client = getAblyClient();
    if (client.status !== 'connected') return;

    let logUnsub: (() => void) | null = null;
    let healthUnsub: (() => void) | null = null;

    // Subscribe to logs
    client
      .subscribe(channelName, message => {
        if (message.type === 'log') {
          setLogs(prev => [...prev.slice(-999), message.payload as LogEntry]);
        } else if (message.type === 'logs_batch') {
          const batch = message.payload as LogEntry[];
          setLogs(prev => [...batch, ...prev].slice(0, 1000));
        }
      })
      .then(unsub => {
        logUnsub = unsub;
      });

    // Subscribe to health updates
    client
      .subscribe(Channels.pluginHealth(), message => {
        if (message.type === 'health_update') {
          const update = message.payload as PluginHealthUpdate;
          if (update.plugin === pluginName) {
            setHealth(update);
          }
        }
      })
      .then(unsub => {
        healthUnsub = unsub;
      });

    return () => {
      logUnsub?.();
      healthUnsub?.();
    };
  }, [channelName, pluginName]);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  return { logs, health, clearLogs };
}

/**
 * Hook for notifications
 */
export function useNotifications() {
  const [notifications, setNotifications] = useState<RealtimeMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const { lastMessage } = useChannel(Channels.notifications());

  useEffect(() => {
    if (lastMessage && lastMessage.type === 'notification') {
      setNotifications(prev => [lastMessage, ...prev].slice(0, 100));
      setUnreadCount(prev => prev + 1);
    }
  }, [lastMessage]);

  const markAllRead = useCallback(() => {
    setUnreadCount(0);
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
    setUnreadCount(0);
  }, []);

  return {
    notifications,
    unreadCount,
    markAllRead,
    clearNotifications,
  };
}

/**
 * Hook for user-specific messages
 */
export function useUserChannel(userId: string | null) {
  const channelName = userId ? Channels.user(userId) : null;
  return useChannel(channelName);
}

/**
 * Hook for team messages
 */
export function useTeamChannel(teamId: string | null) {
  const channelName = teamId ? Channels.team(teamId) : null;
  return useChannel(channelName);
}

/**
 * Hook for system events
 */
export function useSystemEvents() {
  const [events, setEvents] = useState<RealtimeMessage[]>([]);

  const { lastMessage } = useChannel(Channels.system());

  useEffect(() => {
    if (lastMessage) {
      setEvents(prev => [lastMessage, ...prev].slice(0, 100));
    }
  }, [lastMessage]);

  return { events };
}
