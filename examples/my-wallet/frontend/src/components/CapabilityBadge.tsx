/**
 * Colored pill badges for orchestrator capability categories
 */

import React from 'react';
import { Cpu, Video, Bot, Layers, HelpCircle } from 'lucide-react';

const CATEGORY_CONFIG: Record<string, { label: string; colorClass: string; icon: React.FC<{ className?: string }> }> = {
  transcoding: {
    label: 'Transcoding',
    colorClass: 'text-accent-teal bg-accent-teal/10 border-accent-teal/30',
    icon: Video,
  },
  realtime_ai: {
    label: 'Realtime AI',
    colorClass: 'text-accent-purple bg-accent-purple/10 border-accent-purple/30',
    icon: Cpu,
  },
  ai_batch: {
    label: 'AI Batch',
    colorClass: 'text-accent-blue bg-accent-blue/10 border-accent-blue/30',
    icon: Layers,
  },
  agent: {
    label: 'Agent',
    colorClass: 'text-accent-amber bg-accent-amber/10 border-accent-amber/30',
    icon: Bot,
  },
  other: {
    label: 'Other',
    colorClass: 'text-text-muted bg-bg-tertiary border-white/10',
    icon: HelpCircle,
  },
};

interface CapabilityBadgeProps {
  category: string;
  size?: 'sm' | 'md';
}

export const CapabilityBadge: React.FC<CapabilityBadgeProps> = ({ category, size = 'sm' }) => {
  const config = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.other;
  const Icon = config.icon;
  const sizeClass = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium ${config.colorClass} ${sizeClass}`}
    >
      <Icon className={size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
      {config.label}
    </span>
  );
};

interface CapabilityBadgeListProps {
  categories: string[];
  size?: 'sm' | 'md';
}

export const CapabilityBadgeList: React.FC<CapabilityBadgeListProps> = ({ categories, size = 'sm' }) => {
  if (!categories.length) return null;

  const unique = [...new Set(categories)];

  return (
    <div className="flex flex-wrap gap-1">
      {unique.map((cat) => (
        <CapabilityBadge key={cat} category={cat} size={size} />
      ))}
    </div>
  );
};
