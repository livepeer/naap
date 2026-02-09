/**
 * useWebSocket Hook (Phase 2e)
 *
 * Provides WebSocket connectivity to base-svc for real-time events.
 * Plugins subscribe to channels and receive messages automatically.
 *
 * @example
 * ```tsx
 * function LiveOrchestrators() {
 *   const { data, connected } = useWebSocket<OrchestratorUpdate>('orchestrator:updates');
 *
 *   return (
 *     <div>
 *       <span>{connected ? 'Live' : 'Disconnected'}</span>
 *       {data && <pre>{JSON.stringify(data)}</pre>}
 *     </div>
 *   );
 * }
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useShell } from './useShell.js';
import { PLUGIN_PORTS } from '../config/ports.js';

export interface UseWebSocketOptions {
  /** Whether to auto-connect (default: true) */
  enabled?: boolean;

  /** Auto-reconnect on disconnect (default: true) */
  reconnect?: boolean;

  /** Reconnect interval in ms (default: 3000) */
  reconnectInterval?: number;

  /** Max reconnect attempts (default: 10) */
  maxReconnectAttempts?: number;

  /** Callback when a message is received */
  onMessage?: (data: unknown) => void;

  /** Callback when connection opens */
  onOpen?: () => void;

  /** Callback when connection closes */
  onClose?: () => void;

  /** Callback when an error occurs */
  onError?: (error: Event) => void;
}

export interface UseWebSocketResult<T = unknown> {
  /** Latest received data */
  data: T | null;

  /** Whether the WebSocket is connected */
  connected: boolean;

  /** Connection error if any */
  error: Event | null;

  /** Send a message to the server */
  send: (message: unknown) => void;

  /** Manually close the connection */
  close: () => void;

  /** Manually reconnect */
  reconnect: () => void;
}

/**
 * Hook for subscribing to WebSocket channels from base-svc.
 *
 * @param channel - The channel to subscribe to (e.g., 'orchestrator:updates', 'round:changes')
 * @param options - WebSocket options
 */
export function useWebSocket<T = unknown>(
  channel: string,
  options: UseWebSocketOptions = {}
): UseWebSocketResult<T> {
  const {
    enabled = true,
    reconnect: shouldReconnect = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 10,
    onMessage,
    onOpen,
    onClose,
    onError,
  } = options;

  const shell = useShell();
  const [data, setData] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Event | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const connect = useCallback(() => {
    if (!enabled || !mountedRef.current) return;

    // Determine WebSocket URL — uses same-origin in production, localhost:4000 in dev
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = typeof window !== 'undefined'
      ? window.location.host
      : `localhost:${PLUGIN_PORTS['base'] || 4000}`;
    const wsUrl = `${protocol}//${host}/ws?channel=${encodeURIComponent(channel)}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;

        // Subscribe to the channel
        ws.send(JSON.stringify({ type: 'subscribe', channel }));

        // Send auth token if available
        shell.auth.getToken()
          .then(token => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'auth', token }));
            }
          })
          .catch(() => {
            // Continue without auth
          });

        onOpenRef.current?.();
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;

        try {
          const message = JSON.parse(event.data);

          // Filter messages by channel
          if (message.channel === channel || message.type === 'message') {
            const payload = message.data || message.payload;
            setData(payload as T);
            onMessageRef.current?.(payload);
          }
        } catch {
          // Not JSON, treat as raw data
          setData(event.data as T);
          onMessageRef.current?.(event.data);
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        wsRef.current = null;
        onCloseRef.current?.();

        // Auto-reconnect
        if (shouldReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectTimerRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, reconnectInterval * Math.min(reconnectAttemptsRef.current + 1, 5));
        }
      };

      ws.onerror = (event) => {
        if (!mountedRef.current) return;
        setError(event);
        onErrorRef.current?.(event);
      };
    } catch (err) {
      console.error('WebSocket connection error:', err);
    }
  }, [enabled, channel, shell, shouldReconnect, reconnectInterval, maxReconnectAttempts]);

  // Connect on mount
  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const send = useCallback((message: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        typeof message === 'string' ? message : JSON.stringify(message)
      );
    }
  }, []);

  const close = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const reconnectFn = useCallback(() => {
    close();
    reconnectAttemptsRef.current = 0;
    connect();
  }, [close, connect]);

  return { data, connected, error, send, close, reconnect: reconnectFn };
}
