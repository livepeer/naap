/**
 * usePluginEvent Hook
 *
 * Type-safe event handling hook for plugin-to-plugin communication.
 * Provides emit/listen functionality with automatic cleanup on unmount.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   // Listen for theme changes
 *   usePluginEvent('theme:change', (data) => {
 *     console.log('Theme changed to:', data.mode);
 *   });
 *
 *   // Emit events
 *   const { emit } = usePluginEvent();
 *   emit('my-plugin:data-updated', { id: '123' });
 * }
 * ```
 */

import { useEffect, useCallback, useRef } from 'react';
import { useShell } from './useShell.js';
import type { PluginEventMap, EventRequestOptions } from '../types/services.js';

/**
 * Options for usePluginEvent hook
 */
export interface UsePluginEventOptions {
  /**
   * Whether to enable debug logging (default: true in development)
   */
  debug?: boolean;

  /**
   * Context name for debug logging
   */
  debugContext?: string;
}

/**
 * Result type for usePluginEvent hook
 */
export interface UsePluginEventResult {
  /**
   * Emit an event (supports both typed and generic events)
   */
  emit: <T = unknown>(event: string, data?: T) => void;

  /**
   * Make a request and wait for response
   */
  request: <TReq = unknown, TRes = unknown>(
    event: string,
    data?: TReq,
    options?: EventRequestOptions
  ) => Promise<TRes>;

  /**
   * Register a request handler
   */
  handleRequest: <TReq = unknown, TRes = unknown>(
    event: string,
    handler: (data: TReq) => TRes | Promise<TRes>
  ) => () => void;
}

/**
 * Hook for subscribing to a specific event with auto-cleanup.
 *
 * @param event - The event name to listen for
 * @param callback - Handler function called when event is emitted
 * @param options - Hook options
 *
 * @example
 * ```tsx
 * // Listen for auth events
 * usePluginEvent('auth:login', (data) => {
 *   console.log('User logged in:', data.userId);
 * });
 *
 * // Listen for custom plugin events
 * usePluginEvent('my-plugin:item-created', (data) => {
 *   refetch();
 * });
 * ```
 */
export function usePluginEvent<K extends keyof PluginEventMap>(
  event: K,
  callback: (data: PluginEventMap[K]) => void,
  options?: UsePluginEventOptions
): UsePluginEventResult;

export function usePluginEvent<T = unknown>(
  event: string,
  callback: (data: T) => void,
  options?: UsePluginEventOptions
): UsePluginEventResult;

/**
 * Hook for event bus access without subscribing to a specific event.
 *
 * @param options - Hook options
 * @returns Event utilities (emit, request, handleRequest)
 *
 * @example
 * ```tsx
 * function NotificationSender() {
 *   const { emit } = usePluginEvent();
 *
 *   const notify = () => {
 *     emit('notification:show', {
 *       id: 'my-notification',
 *       type: 'success',
 *       message: 'Operation completed!'
 *     });
 *   };
 *
 *   return <button onClick={notify}>Notify</button>;
 * }
 * ```
 */
export function usePluginEvent(options?: UsePluginEventOptions): UsePluginEventResult;

export function usePluginEvent<T = unknown>(
  eventOrOptions?: string | UsePluginEventOptions,
  callback?: (data: T) => void,
  options?: UsePluginEventOptions
): UsePluginEventResult {
  const shell = useShell();
  const eventBus = shell.eventBus;

  // Determine if first arg is event name or options
  const event = typeof eventOrOptions === 'string' ? eventOrOptions : undefined;
  const hookOptions = typeof eventOrOptions === 'object' ? eventOrOptions : options;

  const { debug, debugContext } = hookOptions || {};
  const shouldDebug = debug ?? process.env.NODE_ENV === 'development';
  const context = debugContext || 'usePluginEvent';

  // Store callback in ref to avoid re-subscribing on callback change
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  // Store registered handlers for cleanup
  const handlersRef = useRef<Array<() => void>>([]);

  // Debug logging helper
  const log = useCallback(
    (action: string, eventName: string, data?: unknown) => {
      if (shouldDebug) {
        console.debug(`[${context}] ${action}: ${eventName}`, data !== undefined ? data : '');
      }
    },
    [shouldDebug, context]
  );

  // Subscribe to event if provided
  useEffect(() => {
    if (!event || !callbackRef.current) return;

    log('subscribe', event);

    const handler = (data: T) => {
      log('received', event, data);
      callbackRef.current?.(data);
    };

    const unsubscribe = eventBus.on(event, handler);

    return () => {
      log('unsubscribe', event);
      unsubscribe();
    };
  }, [event, eventBus, log]);

  // Cleanup all registered handlers on unmount
  useEffect(() => {
    return () => {
      handlersRef.current.forEach((cleanup) => cleanup());
      handlersRef.current = [];
    };
  }, []);

  // Memoized emit function
  const emit = useCallback(
    <E = unknown>(eventName: string, data?: E) => {
      log('emit', eventName, data);
      eventBus.emit(eventName, data);
    },
    [eventBus, log]
  );

  // Memoized request function
  const request = useCallback(
    async <TReq = unknown, TRes = unknown>(
      eventName: string,
      data?: TReq,
      requestOptions?: EventRequestOptions
    ): Promise<TRes> => {
      log('request', eventName, data);
      try {
        const result = await eventBus.request<TReq, TRes>(eventName, data, requestOptions);
        log('request:success', eventName, result);
        return result;
      } catch (error) {
        log('request:error', eventName, error);
        throw error;
      }
    },
    [eventBus, log]
  );

  // Memoized handleRequest function
  const handleRequest = useCallback(
    <TReq = unknown, TRes = unknown>(
      eventName: string,
      handler: (data: TReq) => TRes | Promise<TRes>
    ): (() => void) => {
      log('handleRequest:register', eventName);

      const wrappedHandler = async (data: TReq): Promise<TRes> => {
        log('handleRequest:received', eventName, data);
        const result = await handler(data);
        log('handleRequest:response', eventName, result);
        return result;
      };

      const unsubscribe = eventBus.handleRequest(eventName, wrappedHandler);

      // Track for cleanup on unmount
      handlersRef.current.push(unsubscribe);

      return () => {
        log('handleRequest:unregister', eventName);
        unsubscribe();
        handlersRef.current = handlersRef.current.filter((h) => h !== unsubscribe);
      };
    },
    [eventBus, log]
  );

  return { emit, request, handleRequest };
}

/**
 * Hook for making event requests (shorthand for request pattern)
 *
 * @param event - The event name
 * @param options - Request options
 * @returns A function to make the request
 *
 * @example
 * ```tsx
 * function UserProfile() {
 *   const getProfile = useEventRequest<{ id: string }, UserData>('user:get-profile');
 *
 *   const [profile, setProfile] = useState<UserData | null>(null);
 *
 *   useEffect(() => {
 *     getProfile({ id: '123' }).then(setProfile);
 *   }, []);
 * }
 * ```
 */
export function useEventRequest<TReq = unknown, TRes = unknown>(
  event: string,
  options?: EventRequestOptions
): (data?: TReq) => Promise<TRes> {
  const { request } = usePluginEvent();

  return useCallback(
    (data?: TReq) => request<TReq, TRes>(event, data, options),
    [request, event, options]
  );
}

/**
 * Hook for handling event requests (shorthand for handler pattern)
 *
 * @param event - The event name to handle
 * @param handler - The request handler
 *
 * @example
 * ```tsx
 * function UserDataProvider() {
 *   // Automatically registers and cleans up on unmount
 *   useEventHandler<{ id: string }, UserData>(
 *     'user:get-profile',
 *     async (data) => {
 *       const user = await fetchUser(data.id);
 *       return user;
 *     }
 *   );
 * }
 * ```
 */
export function useEventHandler<TReq = unknown, TRes = unknown>(
  event: string,
  handler: (data: TReq) => TRes | Promise<TRes>
): void {
  const { handleRequest } = usePluginEvent();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unsubscribe = handleRequest<TReq, TRes>(event, (data) => handlerRef.current(data));
    return unsubscribe;
  }, [event, handleRequest]);
}
