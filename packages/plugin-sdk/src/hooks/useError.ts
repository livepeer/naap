/**
 * useError Hook
 * 
 * Provides standardized error handling for plugin components.
 * Automatically integrates with notifications and logging.
 */

import { useState, useCallback } from 'react';
import { useNotify } from './useShell.js';
import { useLogger } from './useShell.js';

/**
 * Error with additional context
 */
export interface EnhancedError {
  message: string;
  code?: string;
  status?: number;
  details?: unknown;
  timestamp: Date;
  context?: string;
}

/**
 * Result of useError hook
 */
export interface UseErrorResult {
  /** Current error, if any */
  error: EnhancedError | null;
  
  /** Set an error */
  setError: (error: Error | string | EnhancedError) => void;
  
  /** Clear the current error */
  clearError: () => void;
  
  /** Handle an error (logs and optionally shows notification) */
  handleError: (error: Error | string, options?: ErrorHandlingOptions) => void;
  
  /** Whether there is an active error */
  hasError: boolean;
}

/**
 * Options for error handling
 */
export interface ErrorHandlingOptions {
  /** Show notification to user (default: true) */
  notify?: boolean;
  
  /** Notification message override */
  message?: string;
  
  /** Log the error (default: true) */
  log?: boolean;
  
  /** Additional context for logging */
  context?: string;
  
  /** Whether this is a fatal error */
  fatal?: boolean;
}

/**
 * Hook for standardized error handling in plugin components.
 * 
 * Provides utilities to:
 * - Set and clear errors
 * - Automatically log errors
 * - Show user notifications
 * - Track error state
 * 
 * @param context - Optional context string for error logging
 * @returns Error handling utilities
 * 
 * @example
 * ```typescript
 * function DataFetcher() {
 *   const { error, handleError, clearError, hasError } = useError('DataFetcher');
 *   const [data, setData] = useState(null);
 *   
 *   const fetchData = async () => {
 *     try {
 *       clearError();
 *       const response = await api.get('/data');
 *       setData(response.data);
 *     } catch (err) {
 *       handleError(err, { message: 'Failed to load data' });
 *     }
 *   };
 *   
 *   if (hasError) {
 *     return <ErrorDisplay error={error} onRetry={fetchData} />;
 *   }
 *   
 *   return <div>{data}</div>;
 * }
 * ```
 * 
 * @example
 * ```typescript
 * // With custom error handling
 * function Form() {
 *   const { handleError } = useError('Form');
 *   
 *   const onSubmit = async (values: FormData) => {
 *     try {
 *       await api.post('/submit', values);
 *     } catch (err) {
 *       handleError(err, {
 *         message: 'Submission failed. Please try again.',
 *         notify: true,
 *         log: true,
 *         context: 'form-submission'
 *       });
 *     }
 *   };
 * }
 * ```
 */
export function useError(context?: string): UseErrorResult {
  const [error, setErrorState] = useState<EnhancedError | null>(null);
  const notify = useNotify();
  const logger = useLogger(context);

  /**
   * Set an error
   */
  const setError = useCallback((err: Error | string | EnhancedError) => {
    let enhancedError: EnhancedError;

    if (typeof err === 'string') {
      enhancedError = {
        message: err,
        timestamp: new Date(),
        context,
      };
    } else if (err instanceof Error) {
      enhancedError = {
        message: err.message,
        timestamp: new Date(),
        context,
        details: err,
      };
    } else {
      enhancedError = {
        ...err,
        timestamp: err.timestamp || new Date(),
        context: err.context || context,
      };
    }

    setErrorState(enhancedError);
  }, [context]);

  /**
   * Clear the current error
   */
  const clearError = useCallback(() => {
    setErrorState(null);
  }, []);

  /**
   * Handle an error with logging and optional notification
   */
  const handleError = useCallback((
    err: Error | string,
    options: ErrorHandlingOptions = {}
  ) => {
    const {
      notify: showNotification = true,
      message: customMessage,
      log: shouldLog = true,
      context: errorContext,
      fatal = false,
    } = options;

    // Extract error details
    let errorMessage: string;
    let errorDetails: unknown;

    if (typeof err === 'string') {
      errorMessage = err;
    } else if (err instanceof Error) {
      errorMessage = err.message;
      errorDetails = err;
    } else {
      errorMessage = 'An unknown error occurred';
      errorDetails = err;
    }

    // Create enhanced error
    const enhancedError: EnhancedError = {
      message: customMessage || errorMessage,
      timestamp: new Date(),
      context: errorContext || context,
      details: errorDetails,
    };

    // Check if this is an API error with status
    if (errorDetails && typeof errorDetails === 'object' && 'status' in errorDetails) {
      enhancedError.status = (errorDetails as any).status;
      enhancedError.code = (errorDetails as any).code;
    }

    // Set error state
    setErrorState(enhancedError);

    // Log the error
    if (shouldLog) {
      if (fatal) {
        logger.error(enhancedError.message, err instanceof Error ? err : undefined, {
          context: enhancedError.context,
          details: enhancedError.details,
          fatal: true,
        });
      } else {
        logger.warn(enhancedError.message, {
          context: enhancedError.context,
          details: enhancedError.details,
        });
      }
    }

    // Show notification to user
    if (showNotification) {
      if (fatal) {
        notify.error(customMessage || errorMessage, {
          duration: 0, // Persistent for fatal errors
        });
      } else {
        notify.error(customMessage || errorMessage);
      }
    }
  }, [context, notify, logger, setErrorState]);

  return {
    error,
    setError,
    clearError,
    handleError,
    hasError: error !== null,
  };
}

/**
 * Hook to wrap an async operation with error handling.
 * 
 * @param operation - The async operation to wrap
 * @param options - Error handling options
 * @returns Wrapped operation with automatic error handling
 * 
 * @example
 * ```typescript
 * function DataLoader() {
 *   const { error, hasError } = useError();
 *   
 *   const fetchData = useErrorHandler(async () => {
 *     const response = await api.get('/data');
 *     return response.data;
 *   }, { message: 'Failed to load data' });
 *   
 *   const onClick = async () => {
 *     const data = await fetchData();
 *     if (data) {
 *       console.log('Loaded:', data);
 *     }
 *   };
 * }
 * ```
 */
export function useErrorHandler<T extends (...args: any[]) => Promise<any>>(
  operation: T,
  options?: ErrorHandlingOptions
): T {
  const { handleError } = useError();

  return useCallback(((...args: any[]) => {
    return operation(...args).catch((error) => {
      handleError(error, options);
      return null;
    });
  }) as T, [operation, handleError, options]);
}
