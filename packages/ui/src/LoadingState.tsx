/**
 * LoadingState Component
 * 
 * Consistent loading indicators with spinner and skeleton variants.
 */

import React from 'react';

export interface LoadingStateProps {
  /** Loading message */
  message?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional className */
  className?: string;
}

export const LoadingSpinner: React.FC<LoadingStateProps> = ({
  message,
  size = 'md',
  className = '',
}) => {
  const sizeClasses = {
    sm: 'w-6 h-6 border-2',
    md: 'w-8 h-8 border-2',
    lg: 'w-12 h-12 border-3',
  };

  return (
    <div className={`flex flex-col items-center justify-center gap-4 ${className}`}>
      <div 
        className={`${sizeClasses[size]} border-accent-blue border-t-transparent rounded-full animate-spin`}
      />
      {message && (
        <p className="text-text-secondary text-sm">{message}</p>
      )}
    </div>
  );
};

export interface SkeletonProps {
  /** Width (CSS value) */
  width?: string;
  /** Height (CSS value) */
  height?: string;
  /** Border radius */
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full';
  /** Additional className */
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = '1rem',
  rounded = 'md',
  className = '',
}) => {
  const roundedClasses = {
    none: '',
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    full: 'rounded-full',
  };

  return (
    <div
      className={`bg-bg-tertiary/50 animate-pulse ${roundedClasses[rounded]} ${className}`}
      style={{ width, height }}
    />
  );
};

export interface SkeletonCardProps {
  /** Number of lines in the card */
  lines?: number;
  /** Additional className */
  className?: string;
}

export const SkeletonCard: React.FC<SkeletonCardProps> = ({
  lines = 3,
  className = '',
}) => {
  return (
    <div className={`p-6 bg-bg-secondary border border-white/10 rounded-2xl ${className}`}>
      <div className="flex items-center gap-4 mb-4">
        <Skeleton width="48px" height="48px" rounded="lg" />
        <div className="flex-1 space-y-2">
          <Skeleton width="60%" height="1rem" />
          <Skeleton width="40%" height="0.75rem" />
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} width={i === lines - 1 ? '80%' : '100%'} height="0.75rem" />
        ))}
      </div>
    </div>
  );
};

export const LoadingState: React.FC<LoadingStateProps> = (props) => {
  return <LoadingSpinner {...props} />;
};
