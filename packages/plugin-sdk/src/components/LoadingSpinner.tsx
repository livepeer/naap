/**
 * LoadingSpinner Component
 * 
 * A reusable loading spinner component for plugin UIs.
 * Provides consistent loading states across all plugins.
 */

import * as React from 'react';

/**
 * Loading spinner props
 */
export interface LoadingSpinnerProps {
  /** Size of the spinner: 'small' | 'medium' | 'large' (default: 'medium') */
  size?: 'small' | 'medium' | 'large';
  
  /** Optional message to display below spinner */
  message?: string;
  
  /** Whether to show as fullscreen overlay (default: false) */
  fullscreen?: boolean;
  
  /** Custom class name */
  className?: string;
  
  /** Custom color (CSS color value) */
  color?: string;
}

/**
 * A simple, accessible loading spinner component.
 * 
 * @example
 * ```typescript
 * function MyComponent() {
 *   const [loading, setLoading] = useState(true);
 *   
 *   if (loading) {
 *     return <LoadingSpinner message="Loading data..." />;
 *   }
 *   
 *   return <div>Content</div>;
 * }
 * ```
 * 
 * @example
 * ```typescript
 * // Fullscreen overlay
 * function App() {
 *   const [loading, setLoading] = useState(true);
 *   
 *   return (
 *     <>
 *       {loading && <LoadingSpinner fullscreen message="Initializing..." />}
 *       <Content />
 *     </>
 *   );
 * }
 * ```
 * 
 * @example
 * ```typescript
 * // Different sizes
 * <LoadingSpinner size="small" />
 * <LoadingSpinner size="medium" />
 * <LoadingSpinner size="large" />
 * ```
 */
export function LoadingSpinner({
  size = 'medium',
  message,
  fullscreen = false,
  className = '',
  color,
}: LoadingSpinnerProps): React.ReactElement {
  const sizeClasses = {
    small: 'w-4 h-4 border-2',
    medium: 'w-8 h-8 border-3',
    large: 'w-12 h-12 border-4',
  };

  const sizeClass = sizeClasses[size];
  const spinnerColor = color || 'currentColor';

  const spinner = (
    <div
      className={`inline-block ${sizeClass} border-solid rounded-full animate-spin ${className}`}
      style={{
        borderColor: `${spinnerColor} transparent transparent transparent`,
      }}
      role="status"
      aria-label={message || 'Loading'}
    >
      <span className="sr-only">{message || 'Loading...'}</span>
    </div>
  );

  if (fullscreen) {
    return (
      <div
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        role="alert"
        aria-busy="true"
      >
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-xl flex flex-col items-center gap-4">
          {spinner}
          {message && (
            <p className="text-gray-700 dark:text-gray-300 text-sm font-medium">
              {message}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (message) {
    return (
      <div className="flex flex-col items-center gap-3" role="status" aria-busy="true">
        {spinner}
        <p className="text-gray-600 dark:text-gray-400 text-sm">{message}</p>
      </div>
    );
  }

  return spinner;
}

/**
 * Inline loading state component for buttons and smaller UI elements.
 * 
 * @example
 * ```typescript
 * function SubmitButton() {
 *   const [loading, setLoading] = useState(false);
 *   
 *   return (
 *     <button disabled={loading}>
 *       {loading ? <InlineSpinner /> : 'Submit'}
 *     </button>
 *   );
 * }
 * ```
 */
export function InlineSpinner({ className = '' }: { className?: string }): React.ReactElement {
  return (
    <div
      className={`inline-block w-4 h-4 border-2 border-solid border-current border-t-transparent rounded-full animate-spin ${className}`}
      role="status"
      aria-label="Loading"
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
}

/**
 * Loading overlay for specific sections or cards.
 * 
 * @example
 * ```typescript
 * function DataCard() {
 *   const [loading, setLoading] = useState(true);
 *   
 *   return (
 *     <div className="relative">
 *       {loading && <LoadingOverlay />}
 *       <div className={loading ? 'opacity-50' : ''}>
 *         Content here
 *       </div>
 *     </div>
 *   );
 * }
 * ```
 */
export function LoadingOverlay({
  message,
  className = '',
}: {
  message?: string;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={`absolute inset-0 bg-white dark:bg-gray-900 bg-opacity-75 dark:bg-opacity-75 flex items-center justify-center z-10 ${className}`}
      role="status"
      aria-busy="true"
    >
      <div className="flex flex-col items-center gap-3">
        <LoadingSpinner size="medium" />
        {message && (
          <p className="text-gray-700 dark:text-gray-300 text-sm font-medium">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
