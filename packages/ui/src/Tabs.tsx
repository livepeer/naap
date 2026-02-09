/**
 * Tabs Component
 * 
 * A horizontal tab navigation component.
 */

import React from 'react';
import { LucideIcon } from 'lucide-react';

export interface Tab<T extends string = string> {
  id: T;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
  badge?: string | number;
}

export interface TabsProps<T extends string = string> {
  /** Available tabs */
  tabs: Tab<T>[];
  /** Currently active tab */
  activeTab: T;
  /** Called when active tab changes */
  onChange: (tabId: T) => void;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional className */
  className?: string;
  /** Tab content */
  children?: React.ReactNode;
}

export function Tabs<T extends string = string>({
  tabs,
  activeTab,
  onChange,
  size = 'md',
  className = '',
  children,
}: TabsProps<T>) {
  const sizeClasses = {
    sm: 'px-3 py-2 text-xs gap-1.5',
    md: 'px-4 py-3 text-sm gap-2',
    lg: 'px-5 py-3.5 text-base gap-2',
  };

  const iconSizes = {
    sm: 14,
    md: 16,
    lg: 18,
  };

  return (
    <div className={className}>
      {/* Tab List */}
      <div className="flex border-b border-white/10" role="tablist">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-disabled={tab.disabled}
              disabled={tab.disabled}
              onClick={() => !tab.disabled && onChange(tab.id)}
              className={`
                flex items-center ${sizeClasses[size]}
                font-medium transition-all border-b-2 -mb-px
                ${isActive
                  ? 'text-accent-blue border-accent-blue'
                  : 'text-text-secondary border-transparent hover:text-text-primary hover:border-white/20'
                }
                ${tab.disabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              {Icon && <Icon size={iconSizes[size]} />}
              {tab.label}
              {tab.badge !== undefined && (
                <span className={`
                  ml-1.5 px-1.5 py-0.5 rounded-full text-xs
                  ${isActive ? 'bg-accent-blue/20 text-accent-blue' : 'bg-bg-tertiary text-text-secondary'}
                `}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {children && (
        <div role="tabpanel" className="pt-4">
          {children}
        </div>
      )}
    </div>
  );
}
