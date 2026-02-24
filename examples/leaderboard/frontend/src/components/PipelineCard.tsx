import React from 'react';
import { Cpu, Image, Video, MessageSquare, ArrowUpCircle } from 'lucide-react';
import { RegionBadge } from './RegionBadge';
import type { PipelineSummary } from '../types';

const PIPELINE_ICONS: Record<string, React.ElementType> = {
  'text-to-image': Image,
  'live-video-to-video': Video,
  llm: MessageSquare,
  upscale: ArrowUpCircle,
};

const PIPELINE_COLORS: Record<string, string> = {
  'text-to-image': 'bg-violet-500/15 text-violet-400',
  'live-video-to-video': 'bg-blue-500/15 text-blue-400',
  llm: 'bg-emerald-500/15 text-emerald-400',
  upscale: 'bg-amber-500/15 text-amber-400',
};

export interface PipelineCardProps {
  pipeline: PipelineSummary;
  onClick: (pipelineId: string) => void;
}

export const PipelineCard: React.FC<PipelineCardProps> = ({
  pipeline,
  onClick,
}) => {
  const Icon = PIPELINE_ICONS[pipeline.id] || Cpu;
  const iconColor = PIPELINE_COLORS[pipeline.id] || 'bg-muted text-muted-foreground';

  return (
    <button
      onClick={() => onClick(pipeline.id)}
      className="w-full text-left p-5 rounded-2xl bg-card border border-border hover:border-primary/30 transition-all group"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={`p-2 rounded-xl ${iconColor}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
            {pipeline.id}
          </h3>
          <p className="text-xs text-muted-foreground">
            {pipeline.modelCount} model{pipeline.modelCount !== 1 ? 's' : ''}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {pipeline.regions.map((r) => (
          <RegionBadge key={r} region={r} />
        ))}
      </div>
    </button>
  );
};
