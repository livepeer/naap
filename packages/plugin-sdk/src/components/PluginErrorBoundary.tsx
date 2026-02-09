/**
 * Plugin Error Boundary
 * 
 * A React error boundary component for plugins to catch and handle errors gracefully.
 * Prevents plugin errors from crashing the entire shell application.
 */

import React, { Component, type ReactNode, type ErrorInfo } from 'react';

/**
 * Error information passed to the fallback component
 */
export interface PluginErrorInfo {
  /** The error that was caught */
  error: Error;
  /** React error info with component stack */
  errorInfo: ErrorInfo | null;
  /** Function to reset the error state and retry */
  resetError: () => void;
}

/**
 * Props for PluginErrorBoundary
 */
export interface PluginErrorBoundaryProps {
  /** Child components to render */
  children: ReactNode;
  
  /** 
   * Custom fallback UI to render when an error occurs.
   * If not provided, a default error UI is shown.
   */
  fallback?: ReactNode | ((errorInfo: PluginErrorInfo) => ReactNode);
  
  /** 
   * Callback when an error is caught.
   * Use for logging or analytics.
   */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  
  /** Plugin name for error context */
  pluginName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Default error fallback component
 */
function DefaultErrorFallback({ error, errorInfo, resetError, pluginName }: {
  error: Error;
  errorInfo: ErrorInfo | null;
  resetError: () => void;
  pluginName?: string;
}) {
  const [showDetails, setShowDetails] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const copyErrorDetails = () => {
    const details = `
Plugin: ${pluginName || 'Unknown'}
Error: ${error.message}
Stack: ${error.stack || 'No stack trace available'}
Component Stack: ${errorInfo?.componentStack || 'No component stack available'}
Timestamp: ${new Date().toISOString()}
    `.trim();

    navigator.clipboard.writeText(details).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex items-center justify-center min-h-[400px] p-6">
      <div className="max-w-lg w-full">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
          {/* Error Icon */}
          <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-red-100 dark:bg-red-900/40 rounded-full">
            <svg
              className="w-6 h-6 text-red-600 dark:text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>

          {/* Error Title */}
          <h3 className="text-lg font-semibold text-center text-gray-900 dark:text-gray-100 mb-2">
            {pluginName ? `${pluginName} encountered an error` : 'Something went wrong'}
          </h3>

          {/* Error Message */}
          <p className="text-sm text-center text-gray-700 dark:text-gray-300 mb-4">
            {error.message || 'An unexpected error occurred'}
          </p>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-4">
            <button
              onClick={resetError}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-lg text-sm font-medium transition-colors"
            >
              {showDetails ? 'Hide' : 'Show'} Details
            </button>
          </div>

          {/* Error Details */}
          {showDetails && (
            <div className="mt-4 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Error Details
                </h4>
                <button
                  onClick={copyErrorDetails}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre className="text-xs text-gray-800 dark:text-gray-200 overflow-auto max-h-48 whitespace-pre-wrap break-words">
                {error.stack || error.message}
              </pre>
              {errorInfo?.componentStack && (
                <>
                  <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mt-3 mb-1">
                    Component Stack
                  </h4>
                  <pre className="text-xs text-gray-800 dark:text-gray-200 overflow-auto max-h-32 whitespace-pre-wrap">
                    {errorInfo.componentStack}
                  </pre>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Error boundary component for plugins.
 * 
 * Catches JavaScript errors anywhere in the child component tree,
 * logs the error, and displays a fallback UI.
 * 
 * @example
 * ```tsx
 * // Basic usage
 * <PluginErrorBoundary>
 *   <MyPluginContent />
 * </PluginErrorBoundary>
 * 
 * // With custom fallback
 * <PluginErrorBoundary
 *   fallback={({ error, resetError }) => (
 *     <div>
 *       <p>Error: {error.message}</p>
 *       <button onClick={resetError}>Retry</button>
 *     </div>
 *   )}
 * >
 *   <MyPluginContent />
 * </PluginErrorBoundary>
 * 
 * // With error logging
 * <PluginErrorBoundary
 *   pluginName="my-plugin"
 *   onError={(error, info) => {
 *     console.error('Plugin error:', error);
 *     analytics.track('plugin_error', { error: error.message });
 *   }}
 * >
 *   <MyPluginContent />
 * </PluginErrorBoundary>
 * ```
 */
export class PluginErrorBoundary extends Component<PluginErrorBoundaryProps, State> {
  constructor(props: PluginErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('PluginErrorBoundary caught an error:', error);
      console.error('Component stack:', errorInfo.componentStack);
    }

    // Call onError callback if provided
    this.props.onError?.(error, errorInfo);
  }

  override render(): ReactNode {
    const { hasError, error, errorInfo } = this.state;
    const { children, fallback, pluginName } = this.props;

    if (hasError && error) {
      const errorInfo_: PluginErrorInfo = {
        error,
        errorInfo,
        resetError: this.resetError,
      };

      // Custom fallback
      if (fallback) {
        if (typeof fallback === 'function') {
          return fallback(errorInfo_);
        }
        return fallback;
      }

      // Default fallback
      return (
        <DefaultErrorFallback
          error={error}
          errorInfo={errorInfo}
          resetError={this.resetError}
          pluginName={pluginName}
        />
      );
    }

    return children;
  }

  resetError = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };
}

export default PluginErrorBoundary;
