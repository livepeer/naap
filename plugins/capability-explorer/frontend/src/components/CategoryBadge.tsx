import React from 'react';
import type { CapabilityCategory } from '../lib/types';
import { PIPELINE_COLORS, CATEGORY_SHORT_LABELS } from '../lib/constants';

interface CategoryBadgeProps {
  category: CapabilityCategory;
  className?: string;
}

export const CategoryBadge: React.FC<CategoryBadgeProps> = ({ category, className = '' }) => {
  const color = PIPELINE_COLORS[category] || '#6366f1';
  const label = CATEGORY_SHORT_LABELS[category] || category;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${className}`}
      style={{
        backgroundColor: `${color}20`,
        color: color,
        border: `1px solid ${color}40`,
      }}
    >
      {label}
    </span>
  );
};
