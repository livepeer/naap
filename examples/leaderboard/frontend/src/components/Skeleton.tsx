import React from 'react';

export const CardSkeleton: React.FC<{ className?: string }> = ({
  className = '',
}) => (
  <div
    className={`p-5 rounded-2xl bg-card border border-border animate-pulse ${className}`}
  >
    <div className="flex items-center gap-2 mb-4">
      <div className="w-7 h-7 rounded-lg bg-muted" />
      <div className="w-24 h-3 rounded bg-muted" />
    </div>
    <div className="space-y-3">
      <div className="w-32 h-8 rounded bg-muted" />
      <div className="w-20 h-4 rounded bg-muted" />
    </div>
  </div>
);

export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="rounded-2xl bg-card border border-border overflow-hidden animate-pulse">
    <div className="p-4 border-b border-border">
      <div className="w-40 h-4 rounded bg-muted" />
    </div>
    <div className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="p-4 flex items-center gap-4">
          <div className="w-6 h-4 rounded bg-muted" />
          <div className="w-32 h-4 rounded bg-muted" />
          <div className="flex-1" />
          <div className="w-16 h-4 rounded bg-muted" />
          <div className="w-16 h-4 rounded bg-muted" />
          <div className="w-16 h-4 rounded bg-muted" />
        </div>
      ))}
    </div>
  </div>
);

export const PipelineCardSkeleton: React.FC = () => (
  <div className="p-5 rounded-2xl bg-card border border-border animate-pulse">
    <div className="flex items-center gap-3 mb-4">
      <div className="w-10 h-10 rounded-xl bg-muted" />
      <div className="space-y-2 flex-1">
        <div className="w-32 h-4 rounded bg-muted" />
        <div className="w-20 h-3 rounded bg-muted" />
      </div>
    </div>
    <div className="flex gap-2">
      <div className="w-12 h-5 rounded bg-muted" />
      <div className="w-12 h-5 rounded bg-muted" />
    </div>
  </div>
);
