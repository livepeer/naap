/**
 * EmptyState Component
 * 
 * A consistent empty state display for lists and pages.
 */

import React from 'react';
import { LucideIcon, Inbox } from 'lucide-react';

export interface EmptyStateProps {
  /** Icon to display */
  icon?: LucideIcon;
  /** Main title */
  title: string;
  /** Description text */
  description?: string;
  /** Action button */
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Additional className */
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className = '',
}) => {
  return (
    <div className={`flex flex-col items-center justify-center py-16 text-center ${className}`}>
      <div className="w-16 h-16 rounded-2xl bg-bg-tertiary/50 flex items-center justify-center mb-4">
        <Icon size={32} className="text-text-secondary opacity-50" />
      </div>
      
      <h3 className="text-lg font-bold text-text-primary mb-2">
        {title}
      </h3>
      
      {description && (
        <p className="text-text-secondary text-sm max-w-md mb-4">
          {description}
        </p>
      )}
      
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 bg-accent-blue text-white text-sm font-medium rounded-lg hover:bg-accent-blue/90 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
};
